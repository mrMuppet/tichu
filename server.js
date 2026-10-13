// Tichu-Server: statische Dateien + WebSocket-Räume
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Game } = require('./game.js');
const bot = require('./bot.js');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const BOT_DELAY_MS = 900;
const BOT_NAMES = ['Bot Wu', 'Bot Li', 'Bot Chen', 'Bot Mei'];
const TURN_MS = 30000;      // Zeitlimit pro Spielzug
const EXCHANGE_MS = 60000;  // Zeitlimit fürs Schupfen

function cleanSettings(raw, prev) {
  const s = Object.assign({ target: 1000, timeLimit: false }, prev);
  if (raw && typeof raw === 'object') {
    if ([500, 1000].includes(Number(raw.target))) s.target = Number(raw.target);
    if ('timeLimit' in raw) s.timeLimit = !!raw.timeLimit;
  }
  return s;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Nicht gefunden'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---------- Räume ----------

const rooms = new Map();

class Room {
  constructor(code, settings) {
    this.code = code;
    this.settings = cleanSettings(settings);
    this.timer = null;      // Zeitlimit: { key, deadline, handle }
    this.seats = [null, null, null, null]; // { token, name, bot }
    this.clients = new Map();             // token -> { name, ws, seat }
    this.game = null;
    this.botTimer = null;
    this.lastActivity = Date.now();
    this.chat = [];
  }

  seatName(s) { return this.seats[s] ? this.seats[s].name : `Platz ${s + 1}`; }
  isBot(s) { return !!(this.seats[s] && this.seats[s].bot); }
  inGame() { return this.game && this.game.phase !== 'lobby'; }

  join(ws, name, token) {
    name = String(name || '').trim().slice(0, 20) || 'Spieler';
    let client = token && this.clients.get(token);
    if (!client) {
      // Wiedereinstieg über den Namen, falls der Platz verwaist ist
      const s = this.seats.findIndex(x => x && !x.bot && x.name.toLowerCase() === name.toLowerCase() &&
        !(this.clients.get(x.token) && this.clients.get(x.token).ws));
      if (s >= 0) {
        token = this.seats[s].token;
        client = this.clients.get(token) || { name, seat: s };
      } else {
        token = crypto.randomBytes(12).toString('hex');
        client = { name, seat: null };
        if (!this.inGame()) {
          const free = this.seats.findIndex(x => !x);
          if (free >= 0) { this.seats[free] = { token, name }; client.seat = free; }
        }
      }
      this.clients.set(token, client);
    }
    if (client.ws && client.ws !== ws) {
      try { client.ws.send(JSON.stringify({ t: 'kicked' })); client.ws.close(); } catch (e) { /* egal */ }
    }
    client.ws = ws;
    if (!this.inGame() && client.seat === null) {
      const free = this.seats.findIndex(x => !x);
      if (free >= 0) { this.seats[free] = { token, name }; client.seat = free; }
    }
    if (!this.inGame() && client.seat !== null && this.seats[client.seat]) {
      client.name = name;
      this.seats[client.seat].name = name;
    }
    ws.room = this;
    ws.token = token;
    ws.send(JSON.stringify({ t: 'joined', token, room: this.code }));
    this.broadcast();
  }

  leave(ws) {
    const client = this.clients.get(ws.token);
    if (client && client.ws === ws) client.ws = null;
    if (client && !this.inGame() && client.seat !== null) {
      // In der Lobby wird der Platz freigegeben
      this.seats[client.seat] = null;
      client.seat = null;
    }
    this.broadcast();
  }

  handle(ws, msg) {
    this.lastActivity = Date.now();
    const client = this.clients.get(ws.token);
    if (!client) return;
    const seat = client.seat;
    const g = this.game;
    let err;
    switch (msg.t) {
      case 'chat': {
        const text = String(msg.text || '').trim().slice(0, 300);
        if (text) {
          this.chat.push({ name: client.name, text, ts: Date.now() });
          if (this.chat.length > 100) this.chat.shift();
        }
        break;
      }
      case 'sit': {
        if (this.inGame()) { err = 'Das Spiel läuft bereits.'; break; }
        const s = Number(msg.seat);
        if (!(s >= 0 && s < 4)) break;
        if (this.seats[s] && !this.seats[s].bot) { err = 'Platz ist besetzt.'; break; }
        if (client.seat !== null) this.seats[client.seat] = null;
        this.seats[s] = { token: ws.token, name: client.name };
        client.seat = s;
        break;
      }
      case 'stand': {
        if (this.inGame() || client.seat === null) break;
        this.seats[client.seat] = null;
        client.seat = null;
        break;
      }
      case 'addBot': {
        if (this.inGame()) break;
        const s = Number(msg.seat);
        if (s >= 0 && s < 4 && !this.seats[s]) this.seats[s] = { bot: true, name: BOT_NAMES[s] };
        break;
      }
      case 'removeBot': {
        if (this.inGame()) break;
        const s = Number(msg.seat);
        if (this.isBot(s)) this.seats[s] = null;
        break;
      }
      case 'settings': {
        if (this.inGame() || seat === null) break;
        this.settings = cleanSettings(msg.settings, this.settings);
        break;
      }
      case 'start': {
        if (seat === null) { err = 'Setz dich zuerst an einen Platz.'; break; }
        if (this.inGame()) break;
        if (this.seats.some(x => !x)) { err = 'Es müssen alle 4 Plätze besetzt sein.'; break; }
        if (this.game) this.game.destroy();
        this.game = new Game(s => this.seatName(s), () => this.broadcast(), this.settings);
        this.game.startRound();
        break;
      }
      case 'newGame': {
        if (!g || g.phase !== 'gameOver') break;
        g.destroy();
        this.game = null;
        break;
      }
      default: {
        if (!g || seat === null) { err = 'Du spielst nicht mit.'; break; }
        err = this.gameAction(seat, msg);
      }
    }
    if (err) ws.send(JSON.stringify({ t: 'error', msg: err }));
    this.broadcast();
  }

  gameAction(seat, msg) {
    const g = this.game;
    switch (msg.t) {
      case 'grand': return g.grand(seat, !!msg.call);
      case 'tichu': return g.callTichu(seat);
      case 'exchange': return g.submitExchange(seat, msg.ex);
      case 'play': return g.play(seat, msg.ids, msg.wish);
      case 'pass': return g.pass(seat);
      case 'dragon': return g.giveDragon(seat, msg.to);
      case 'ready': {
        const e = g.setReady(seat);
        if (!e && g.allReady(s => this.isBot(s))) g.startRound();
        return e;
      }
    }
    return 'Unbekannte Aktion.';
  }

  scheduleBots() {
    clearTimeout(this.botTimer);
    const g = this.game;
    if (!g || !this.seats.some(s => s && s.bot)) return;
    for (let s = 0; s < 4; s++) {
      if (!this.isBot(s)) continue;
      const action = bot.decide(g, s);
      if (!action) continue;
      this.botTimer = setTimeout(() => {
        if (this.game !== g) return;
        const a = bot.decide(g, s); // Zustand kann sich geändert haben
        if (!a) return this.broadcast();
        let e;
        switch (a.type) {
          case 'grand': e = g.grand(s, a.call); break;
          case 'exchange': e = g.submitExchange(s, a.ex); break;
          case 'dragon': e = g.giveDragon(s, a.to); break;
          case 'play': e = g.play(s, a.ids, a.wish); break;
          case 'pass': e = g.pass(s); break;
        }
        if (e) {
          console.error(`Bot ${s} Fehler: ${e}`, JSON.stringify(a));
          if (a.type === 'play' && g.turn === s) g.pass(s);
        }
        this.broadcast();
      }, a_delay(action));
      return;
    }
  }

  // Zeitlimit: wer muss gerade handeln? Ändert sich der Schlüssel, startet die Uhr neu.
  syncTimer() {
    const g = this.game;
    let key = null, ms = 0;
    if (g && this.settings.timeLimit) {
      const humanPending = pred => [0, 1, 2, 3].some(s => !this.isBot(s) && pred(s));
      if (g.phase === 'grand' && humanPending(s => !g.grandDecided[s])) { key = 'g' + g.round; ms = TURN_MS; }
      else if (g.phase === 'exchange' && humanPending(s => !g.exchange[s])) { key = 'x' + g.round; ms = EXCHANGE_MS; }
      else if (g.phase === 'play' && g.turn !== null && !g.closing && !this.isBot(g.turn)) {
        key = `p${g.round}:${g.turn}:${g.moves}`; ms = TURN_MS;
      } else if (g.phase === 'dragon' && !this.isBot(g.dragonPending.winner)) { key = 'd' + g.round + ':' + g.moves; ms = TURN_MS; }
    }
    if (this.timer && this.timer.key === key) return;
    if (this.timer) clearTimeout(this.timer.handle);
    this.timer = null;
    if (!key) return;
    const handle = setTimeout(() => this.onTimeout(key), ms);
    this.timer = { key, deadline: Date.now() + ms, total: ms, handle };
  }

  onTimeout(key) {
    const g = this.game;
    if (!this.timer || this.timer.key !== key || !g) return;
    this.timer = null;
    for (let s = 0; s < 4; s++) {
      if (this.isBot(s)) continue;
      const before = g.moves;
      let a = bot.timeoutAction(g, s);
      if (!a) continue;
      if (g.phase === 'grand') a = { type: 'grand', call: false };
      let e;
      switch (a.type) {
        case 'grand': e = g.grand(s, false); break;
        case 'exchange': e = g.submitExchange(s, a.ex); break;
        case 'dragon': e = g.giveDragon(s, a.to); break;
        case 'play': e = g.play(s, a.ids, null); break;
        case 'pass': e = g.pass(s); break;
      }
      if (!e) g.log(`⏱ Zeit abgelaufen für ${this.seatName(s)} – automatischer Zug.`);
      else console.error('Timeout-Aktion fehlgeschlagen', e, a, before);
      if (g.phase === 'play' || g.phase === 'dragon') break; // nur ein Zug
    }
    this.broadcast();
  }

  broadcast() {
    this.syncTimer();
    for (const [token, client] of this.clients) {
      if (!client.ws || client.ws.readyState !== 1) continue;
      client.ws.send(JSON.stringify({ t: 'state', state: this.viewFor(token, client) }));
    }
    this.scheduleBots();
  }

  viewFor(token, client) {
    const seat = client.seat;
    const seats = this.seats.map((s, i) => s ? {
      name: s.name, bot: !!s.bot,
      online: !!s.bot || !!(this.clients.get(s.token) && this.clients.get(s.token).ws),
    } : null);
    const spectators = [...this.clients.values()].filter(c => c.seat === null && c.ws).map(c => c.name);
    const timer = this.timer ? { ms: Math.max(0, this.timer.deadline - Date.now()), total: this.timer.total } : null;
    return {
      room: this.code, you: seat, seats, settings: this.settings, timer, spectators, chat: this.chat.slice(-50),
      game: this.game ? this.game.view(seat) : null,
    };
  }
}

function a_delay(action) {
  return action.type === 'grand' || action.type === 'exchange' ? 400 : BOT_DELAY_MS;
}

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

// ---------- WebSocket ----------

const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', data => {
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'join') {
      if (ws.room) ws.room.leave(ws);
      let code = String(msg.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      if (!code) code = makeCode();
      let room = rooms.get(code);
      if (!room) { room = new Room(code, msg.settings); rooms.set(code, room); }
      room.join(ws, msg.name, msg.token);
      return;
    }
    if (ws.room) {
      try { ws.room.handle(ws, msg); }
      catch (e) { console.error(e); ws.send(JSON.stringify({ t: 'error', msg: 'Serverfehler: ' + e.message })); }
    }
  });
  ws.on('close', () => { if (ws.room) ws.room.leave(ws); });
});

// Tote Verbindungen erkennen, verwaiste Räume aufräumen
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const [code, room] of rooms) {
    const anyone = [...room.clients.values()].some(c => c.ws);
    if (!anyone && now - room.lastActivity > 6 * 3600 * 1000) {
      if (room.game) room.game.destroy();
      clearTimeout(room.botTimer);
      if (room.timer) clearTimeout(room.timer.handle);
      rooms.delete(code);
    }
  }
}, 30000);

server.listen(PORT, () => console.log(`Tichu läuft auf http://localhost:${PORT}`));
