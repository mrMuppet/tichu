// End-to-End-Test: startet einen Server, spielt als Mensch mit 3 Bots zwei Runden.
// Aufruf: node test/e2e.js
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');
const T = require('../public/tichu-core.js');

const PORT = 3999;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT } });
srv.stderr.on('data', d => process.stderr.write('[server] ' + d));

function fail(msg) { console.error('FEHLER:', msg); srv.kill(); process.exit(1); }
setTimeout(() => fail('Timeout'), 15 * 60 * 1000);

setTimeout(() => {
  const ws = new WebSocket('ws://localhost:' + PORT);
  const send = o => ws.send(JSON.stringify(o));
  let setup = false, lastKey = '', roundsDone = 0;
  ws.on('open', () => send({ t: 'join', room: 'E2E', name: 'Tester' }));
  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    if (msg.t === 'error') fail(msg.msg);
    if (msg.t !== 'state') return;
    const s = msg.state, g = s.game, me = s.you;
    if (!g) {
      if (!setup) { setup = true; [1, 2, 3].forEach(seat => send({ t: 'addBot', seat })); }
      if (s.seats.every(Boolean)) send({ t: 'start' });
      return;
    }
    const key = JSON.stringify([g.phase, g.turn, g.round, g.counts, g.closing && 1, g.trick && g.trick.plays.length, g.ready]);
    if (key === lastKey) return;
    lastKey = key;
    if (g.phase === 'grand' && !g.grandDecided[me]) send({ t: 'grand', call: false });
    else if (g.phase === 'exchange' && !g.myExchange) {
      const h = g.hand;
      send({ t: 'exchange', ex: { left: h[0].id, partner: h[h.length - 1].id, right: h[1].id } });
    } else if (g.phase === 'play' && g.turn === me && !g.closing) {
      const top = g.trick ? g.trick.top : null;
      const plays = T.legalPlays(g.hand, top, g.mustFulfill ? g.wish : null);
      const nb = plays.filter(p => !T.isBomb(p.combo)).sort((a, b) => a.combo.rank - b.combo.rank);
      const choice = nb[0] || (g.mustFulfill ? plays[0] : null);
      if (choice) send({ t: 'play', ids: choice.cards.map(c => c.id), wish: 8 });
      else send({ t: 'pass' });
    } else if (g.phase === 'dragon' && g.dragonWinner === me) send({ t: 'dragon', to: (me + 1) % 4 });
    else if (g.phase === 'roundEnd' && !g.ready[me]) {
      roundsDone++;
      console.log(`Runde ${g.round} fertig: ${g.result.total} → Stand ${g.scores}`, g.result.notes.join(' | '));
      if (roundsDone >= 2) { console.log('OK'); srv.kill(); process.exit(0); }
      send({ t: 'ready' });
    } else if (g.phase === 'gameOver') { console.log('Spielende', g.scores); srv.kill(); process.exit(0); }
  });
}, 800);
