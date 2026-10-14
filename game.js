// Tichu-Spielablauf (serverseitig, maßgeblich)
const T = require('./public/tichu-core.js');

const TRICK_CLOSE_MS = 2500; // Zeit für Bomben nachdem dreimal gepasst wurde
const WIN_SCORE = 1000;

// Zufall; mit TICHU_SEED reproduzierbar (nur zum Testen)
let random = Math.random;
if (process.env.TICHU_SEED) {
  let s = Number(process.env.TICHU_SEED) >>> 0;
  random = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const team = seat => seat % 2;

class Game {
  constructor(names, onChange, settings) {
    this.names = names;          // Funktion seat -> Name
    this.onChange = onChange;    // wird nach asynchronen Änderungen aufgerufen
    this.target = (settings && settings.target) || WIN_SCORE;
    this.moves = 0;              // zählt Züge (für das Zeitlimit)
    this.scores = [0, 0];
    this.history = [];
    this.round = 0;
    this.logs = [];
    this.phase = 'lobby';
  }

  log(text) {
    this.logs.push({ text, ts: Date.now() });
    if (this.logs.length > 200) this.logs.shift();
  }

  name(seat) { return this.names(seat); }

  startRound() {
    this.round++;
    const deck = shuffle(T.createDeck());
    this.fullHands = [0, 1, 2, 3].map(i => deck.slice(i * 14, i * 14 + 14));
    this.hands = this.fullHands.map(h => h.slice(0, 8));
    this.phase = 'grand';
    this.grandDecided = [false, false, false, false];
    this.tichu = [null, null, null, null];
    this.hasPlayed = [false, false, false, false];
    this.exchange = [null, null, null, null];
    this.received = [null, null, null, null];
    this.tricks = [[], [], [], []];
    this.trick = null;
    this.lastTrick = null;
    this.wish = null;
    this.turn = null;
    this.finished = [];
    this.closing = null;
    this.dragonPending = null;
    this.result = null;
    this.ready = [false, false, false, false];
    this.log(`— Runde ${this.round} beginnt. Je 8 Karten verteilt: Großes Tichu?`);
  }

  activeSeats() { return [0, 1, 2, 3].filter(s => this.hands[s].length > 0); }

  nextActive(seat) {
    for (let i = 1; i <= 4; i++) {
      const s = (seat + i) % 4;
      if (this.hands[s].length > 0) return s;
    }
    return null;
  }

  // ---------- Ansagen & Schupfen ----------

  grand(seat, call) {
    if (this.phase !== 'grand') return 'Gerade nicht möglich.';
    if (this.grandDecided[seat]) return 'Du hast schon entschieden.';
    this.grandDecided[seat] = true;
    if (call) {
      this.tichu[seat] = 'grand';
      this.log(`${this.name(seat)} sagt GROSSES TICHU an!`);
    }
    if (this.grandDecided.every(Boolean)) {
      this.hands = this.fullHands.map(h => h.slice());
      this.phase = 'exchange';
      this.log('Alle Karten verteilt. Jetzt wird geschupft.');
    }
  }

  callTichu(seat) {
    if (!['grand', 'exchange', 'play'].includes(this.phase)) return 'Gerade nicht möglich.';
    if (this.phase === 'grand' && !this.grandDecided[seat]) return 'Erst Großes Tichu entscheiden.';
    if (this.tichu[seat]) return 'Du hast bereits angesagt.';
    if (this.hasPlayed[seat]) return 'Tichu nur vor der ersten eigenen Karte.';
    this.tichu[seat] = 'small';
    this.log(`${this.name(seat)} sagt TICHU an!`);
  }

  submitExchange(seat, ex) {
    if (this.phase !== 'exchange') return 'Gerade nicht möglich.';
    if (this.exchange[seat]) return 'Du hast schon geschupft.';
    const ids = [ex && ex.right, ex && ex.partner, ex && ex.left];
    if (ids.some(id => !id) || new Set(ids).size !== 3) return 'Bitte drei verschiedene Karten wählen.';
    const hand = this.hands[seat];
    const cards = ids.map(id => hand.find(c => c.id === id));
    if (cards.some(c => !c)) return 'Karte nicht auf der Hand.';
    this.hands[seat] = hand.filter(c => !ids.includes(c.id));
    this.exchange[seat] = { right: cards[0], partner: cards[1], left: cards[2] };
    if (this.exchange.every(Boolean)) this.finishExchange();
  }

  finishExchange() {
    for (let s = 0; s < 4; s++) this.received[s] = {};
    for (let s = 0; s < 4; s++) {
      const ex = this.exchange[s];
      const targets = { right: (s + 1) % 4, partner: (s + 2) % 4, left: (s + 3) % 4 };
      for (const k of ['right', 'partner', 'left']) {
        const to = targets[k];
        this.hands[to].push(ex[k]);
        this.received[to][s] = ex[k];
      }
    }
    this.phase = 'play';
    this.turn = this.hands.findIndex(h => h.some(c => c.special === 'mahjong'));
    this.log(`Geschupft. ${this.name(this.turn)} hat den Mah Jong und beginnt.`);
  }

  // ---------- Spielzüge ----------

  mustFulfill(seat) {
    if (!this.wish || this.phase !== 'play' || this.turn !== seat || this.closing) return false;
    return T.mustFulfillWish(this.hands[seat], this.trick ? this.trick.top : null, this.wish);
  }

  play(seat, ids, wish) {
    if (this.phase !== 'play') return 'Gerade nicht möglich.';
    if (!Array.isArray(ids) || ids.length === 0) return 'Keine Karten gewählt.';
    const hand = this.hands[seat];
    if (new Set(ids).size !== ids.length) return 'Ungültige Auswahl.';
    const cards = ids.map(id => hand.find(c => c.id === id));
    if (cards.some(c => !c)) return 'Karte nicht auf der Hand.';
    const top = this.trick ? this.trick.top : null;
    const combo = T.analyze(cards, top);
    if (!combo) return 'Ungültige Kombination.';
    const myTurn = this.turn === seat && !this.closing;
    if (!myTurn) {
      if (!T.isBomb(combo)) return 'Du bist nicht am Zug.';
      if (!top) return 'Nur der Ausspieler darf jetzt spielen.';
    }
    if (combo.type === 'dog' && top) return 'Der Hund darf nur ausgespielt werden.';
    if (!T.beats(combo, top)) return 'Diese Kombination sticht nicht.';
    if (myTurn && this.mustFulfill(seat) && !T.containsRank(cards, this.wish)) {
      return `Du musst den Wunsch (${T.rankLabel(this.wish)}) erfüllen!`;
    }

    // Zug ausführen
    if (this.closing) { clearTimeout(this.closing.timer); this.closing = null; }
    this.hands[seat] = hand.filter(c => !ids.includes(c.id));
    this.hasPlayed[seat] = true;
    if (!this.trick) this.trick = { plays: [], top: null, lastSeat: null, passes: 0, passed: [false, false, false, false] };
    this.trick.plays.push({ seat, cards: T.sortCards(cards), combo });
    this.trick.top = combo;
    this.trick.lastSeat = seat;
    this.trick.passes = 0;
    this.trick.passed = [false, false, false, false];
    this.moves++;

    let msg = `${this.name(seat)}: ${T.describe(combo)}`;
    if (!myTurn) msg += ' — BOMBE außer der Reihe!';
    if (this.wish && T.containsRank(cards, this.wish)) {
      msg += ` (Wunsch ${T.rankLabel(this.wish)} erfüllt)`;
      this.wish = null;
    }
    if (cards.some(c => c.special === 'mahjong')) {
      const w = Number(wish);
      if (w >= 2 && w <= 14) {
        this.wish = w;
        msg += ` — wünscht sich: ${T.rankLabel(w)}`;
      }
    }
    this.log(msg);

    if (this.hands[seat].length === 0) {
      this.finished.push(seat);
      this.log(`${this.name(seat)} ist fertig (Platz ${this.finished.length}).`);
    }

    if (combo.type === 'dog') {
      this.tricks[seat].push(...cards);
      this.lastTrick = this.trick;
      this.trick = null;
      if (this.checkRoundEnd()) return;
      const partner = (seat + 2) % 4;
      this.turn = this.hands[partner].length ? partner : this.nextActive(partner);
      this.log(`Der Hund gibt das Ausspiel an ${this.name(this.turn)}.`);
      return;
    }

    if (this.checkRoundEnd()) return;
    this.turn = this.nextActive(seat);
    this.autoSkip();
  }

  pass(seat, reason) {
    if (this.phase !== 'play') return 'Gerade nicht möglich.';
    if (this.closing || this.turn !== seat) return 'Du bist nicht am Zug.';
    if (!this.trick) return 'Du musst ausspielen.';
    if (this.mustFulfill(seat)) return `Du musst den Wunsch (${T.rankLabel(this.wish)}) erfüllen!`;
    this.trick.passes++;
    this.trick.passed[seat] = true;
    this.moves++;
    this.log(reason ? `${this.name(seat)} wird übersprungen (${reason}).` : `${this.name(seat)} passt.`);
    const lastActive = this.hands[this.trick.lastSeat].length > 0;
    const needed = this.activeSeats().length - (lastActive ? 1 : 0);
    if (this.trick.passes >= needed) this.startClosing();
    else {
      this.turn = this.nextActive(seat);
      this.autoSkip();
    }
  }

  // Automatisch überspringen, wer weniger Karten hat als die Kombination braucht.
  // Ab 4 Karten wäre eine Bombe denkbar – dann nie überspringen (verrät nichts über die Hand).
  autoSkip() {
    if (this.phase !== 'play' || this.turn === null || this.closing || !this.trick) return;
    const seat = this.turn, n = this.hands[seat].length;
    if (n >= this.trick.top.len || n >= 4) return;
    this.pass(seat, 'zu wenige Karten');
  }

  startClosing() {
    this.turn = null;
    this.closing = { winner: this.trick.lastSeat };
    this.armClosing(TRICK_CLOSE_MS);
  }

  armClosing(ms) {
    this.closing.until = Date.now() + ms;
    this.closing.timer = setTimeout(() => {
      if (!this.closing) return;
      this.closing = null;
      this.finishTrick();
      this.onChange();
    }, ms);
  }

  // Pause: laufende Stich-Abschluss-Uhr anhalten bzw. fortsetzen
  pause() {
    if (this.closing && this.closing.timer) {
      clearTimeout(this.closing.timer);
      this.closing.timer = null;
      this.closing.remaining = Math.max(0, this.closing.until - Date.now());
    }
  }

  resume() {
    if (this.closing && !this.closing.timer) this.armClosing(this.closing.remaining || TRICK_CLOSE_MS);
  }

  isDragonTrick() {
    const top = this.trick && this.trick.top;
    return !!top && top.type === 'single' && top.rank === 15;
  }

  trickCards() {
    return this.trick.plays.flatMap(p => p.cards);
  }

  finishTrick() {
    const winner = this.trick.lastSeat;
    if (this.isDragonTrick()) {
      this.phase = 'dragon';
      this.dragonPending = { winner, afterRound: false };
      this.turn = null;
      this.log(`${this.name(winner)} gewinnt den Stich mit dem Drachen und muss ihn verschenken.`);
      return;
    }
    const pts = T.sumPoints(this.trickCards());
    this.tricks[winner].push(...this.trickCards());
    this.log(`${this.name(winner)} nimmt den Stich (${pts} Punkte).`);
    this.lastTrick = this.trick;
    this.trick = null;
    this.turn = this.hands[winner].length ? winner : this.nextActive(winner);
  }

  giveDragon(seat, to) {
    if (this.phase !== 'dragon' || !this.dragonPending) return 'Gerade nicht möglich.';
    if (this.dragonPending.winner !== seat) return 'Du verschenkst den Drachen nicht.';
    to = Number(to);
    if (![0, 1, 2, 3].includes(to) || team(to) === team(seat)) return 'Der Drache geht an einen Gegner.';
    const pts = T.sumPoints(this.trickCards());
    this.tricks[to].push(...this.trickCards());
    this.log(`${this.name(seat)} verschenkt den Drachen-Stich (${pts} Punkte) an ${this.name(to)}.`);
    this.lastTrick = this.trick;
    this.trick = null;
    const { afterRound } = this.dragonPending;
    this.dragonPending = null;
    if (afterRound) { this.scoreRound(); return; }
    this.phase = 'play';
    this.turn = this.hands[seat].length ? seat : this.nextActive(seat);
  }

  // ---------- Rundenende ----------

  checkRoundEnd() {
    const active = this.activeSeats();
    const double = this.finished.length >= 2 && team(this.finished[0]) === team(this.finished[1]);
    if (!double && active.length > 1) return false;
    if (this.closing) { clearTimeout(this.closing.timer); this.closing = null; }
    this.turn = null;
    this.doubleWin = double ? team(this.finished[0]) : null;
    if (this.trick && !double) {
      if (this.isDragonTrick()) {
        this.phase = 'dragon';
        this.dragonPending = { winner: this.trick.lastSeat, afterRound: true };
        this.log(`${this.name(this.trick.lastSeat)} muss den Drachen-Stich noch verschenken.`);
        return true;
      }
    }
    if (this.trick) {
      this.tricks[this.trick.lastSeat].push(...this.trickCards());
      this.lastTrick = this.trick;
    }
    this.trick = null;
    this.scoreRound();
    return true;
  }

  scoreRound() {
    const cardPts = [0, 0];
    const tichuPts = [0, 0];
    const notes = [];
    const first = this.finished[0];
    if (this.doubleWin !== null) {
      cardPts[this.doubleWin] = 200;
      notes.push(`Doppelsieg für ${this.teamName(this.doubleWin)}! (+200)`);
    } else {
      const last = this.activeSeats()[0];
      const handPts = T.sumPoints(this.hands[last]);
      const lastTrickPts = T.sumPoints(this.tricks[last]);
      cardPts[1 - team(last)] += handPts;
      cardPts[team(first)] += lastTrickPts;
      for (let s = 0; s < 4; s++) if (s !== last) cardPts[team(s)] += T.sumPoints(this.tricks[s]);
      notes.push(`${this.name(last)} ist Letzte(r): Handkarten (${handPts}) an die Gegner, Stiche (${lastTrickPts}) an ${this.name(first)}.`);
    }
    for (let s = 0; s < 4; s++) {
      if (!this.tichu[s]) continue;
      const v = this.tichu[s] === 'grand' ? 200 : 100;
      const ok = first === s;
      tichuPts[team(s)] += ok ? v : -v;
      notes.push(`${this.tichu[s] === 'grand' ? 'Großes Tichu' : 'Tichu'} von ${this.name(s)} ${ok ? 'geschafft' : 'verloren'} (${ok ? '+' : '−'}${v}).`);
    }
    const total = [cardPts[0] + tichuPts[0], cardPts[1] + tichuPts[1]];
    this.scores[0] += total[0];
    this.scores[1] += total[1];
    this.result = { cardPts, tichuPts, total, notes, finished: this.finished.slice() };
    this.history.push({ round: this.round, total, scores: this.scores.slice() });
    this.log(`Runde ${this.round} beendet: ${total[0]} : ${total[1]} (Stand ${this.scores[0]} : ${this.scores[1]})`);
    this.ready = [false, false, false, false];
    const max = Math.max(...this.scores);
    if (max >= this.target && this.scores[0] !== this.scores[1]) {
      this.phase = 'gameOver';
      const w = this.scores[0] > this.scores[1] ? 0 : 1;
      this.winner = w;
      this.log(`Spielende! ${this.teamName(w)} gewinnt.`);
    } else {
      this.phase = 'roundEnd';
    }
  }

  teamName(t) {
    return `${this.name(t)} & ${this.name(t + 2)}`;
  }

  setReady(seat) {
    if (this.phase !== 'roundEnd') return 'Gerade nicht möglich.';
    this.ready[seat] = true;
  }

  allReady(isBot) {
    return [0, 1, 2, 3].every(s => this.ready[s] || isBot(s));
  }

  destroy() {
    if (this.closing) clearTimeout(this.closing.timer);
    this.closing = null;
  }

  // ---------- Sicht eines Spielers ----------

  view(seat) {
    const v = {
      phase: this.phase, round: this.round, target: this.target, scores: this.scores, history: this.history,
      logs: this.logs.slice(-60), turn: this.turn, wish: this.wish,
      tichu: this.tichu, finished: this.finished,
      counts: this.hands ? this.hands.map(h => h.length) : [0, 0, 0, 0],
      grandDecided: this.grandDecided, exchanged: this.exchange ? this.exchange.map(Boolean) : null,
      ready: this.ready, result: this.result, winner: this.winner,
      trick: this.trick ? { plays: this.trick.plays.map(p => ({ seat: p.seat, cards: p.cards, desc: T.describe(p.combo) })), lastSeat: this.trick.lastSeat, top: this.trick.top, passed: this.trick.passed } : null,
      lastTrick: this.lastTrick ? { plays: this.lastTrick.plays.map(p => ({ seat: p.seat, cards: p.cards })) } : null,
      closing: this.closing ? { winner: this.closing.winner, ms: this.closing.timer ? Math.max(0, this.closing.until - Date.now()) : (this.closing.remaining || 0) } : null,
      dragonWinner: this.dragonPending ? this.dragonPending.winner : null,
      trickPoints: this.tricks ? this.tricks.map(t => T.sumPoints(t)) : [0, 0, 0, 0],
    };
    if (seat !== null && seat !== undefined && this.hands) {
      v.hand = T.sortCards(this.hands[seat]);
      v.myExchange = this.exchange[seat];
      v.received = this.received[seat];
      v.canTichu = !this.tichu[seat] && !this.hasPlayed[seat] &&
        (this.phase === 'exchange' || this.phase === 'play' || (this.phase === 'grand' && this.grandDecided[seat]));
      v.mustFulfill = this.mustFulfill(seat);
    }
    return v;
  }
}

module.exports = { Game, team, TRICK_CLOSE_MS };
