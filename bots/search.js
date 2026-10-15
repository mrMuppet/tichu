// Such-Bot (Stufe 2): rechnet beim Ausspielen und Folgen voraus.
//
// Ablauf je Zug: Die unbekannten Karten werden mehrfach zufällig auf die anderen Spieler
// verteilt – passend zu allem, was der Bot weiß (Kartenzahlen, gespielte Karten, selbst
// geschupfte Karten, Wunsch-Zwänge). Für jede Kandidaten-Aktion (die besten Züge laut
// Kartenzähler plus Passen) wird die Runde in jeder dieser Welten mit dem Kartenzähler als
// Spielstrategie für alle vier Plätze zu Ende gespielt. Gewählt wird die Aktion mit dem besten
// durchschnittlichen Rundenergebnis für das eigene Team.
//
// Der Bot liest nur, was observe() aus bots/counter.js liefert (eigene Hand, öffentliche
// Information, eigene Schupf-Karten); verdeckte Karten anderer Spieler sieht er nie.
// Ansagen, Schupfen, Drache und Bomben außer der Reihe übernimmt der Kartenzähler.
const T = require('../public/tichu-core.js');
const { Game, team } = require('../game.js');
const counter = require('./counter.js');

// Stellschrauben (arena.js --set ändert sie)
const P = {
  TOP: 4,          // so viele Züge laut Kartenzähler (plus Passen) werden durchgerechnet
  WORLDS: 24,      // höchstens so viele ausgedachte Kartenverteilungen je Zug
  MS: 300,         // Zeitbudget je Zug in Millisekunden
  MARGIN: 5,       // Vorsprung (Punkte), den ein anderer Zug vor der Wahl des Kartenzählers braucht
};

// ---------- Wissen über Wunsch-Zwänge ----------

// Wer bei offenem Wunsch einen Zug ohne den Wunschwert gemacht oder gepasst hat, konnte den
// Wunsch damals nicht erfüllen – mit seiner heutigen (kleineren) Hand also erst recht nicht.
// Solche Beobachtungen werden je Partie und Runde gesammelt (öffentliche Information).
const memory = new WeakMap();

function wishConstraints(game) {
  let m = memory.get(game);
  if (!m || m.round !== game.round || m.wish !== game.wish) {
    m = { round: game.round, wish: game.wish, list: new Map() };
    memory.set(game, m);
  }
  if (!game.wish || !game.trick) return m.list;
  const w = game.wish;
  const plays = game.trick.plays;
  // Der Mah Jong liegt immer zuerst im Stich; der Wunsch gilt erst für die Züge danach
  const from = plays[0].cards.some(c => c.special === 'mahjong') ? 1 : 0;
  const add = (seat, top) => {
    const key = seat + ':' + (top ? top.type + top.len + '-' + top.rank : 'lead');
    if (!m.list.has(key)) m.list.set(key, { seat, top });
  };
  for (let i = from; i < plays.length; i++) {
    const p = plays[i];
    // Bomben können außer der Reihe gekommen sein (dann galt der Zwang nicht)
    if (T.isBomb(p.combo) || T.containsRank(p.cards, w)) continue;
    add(p.seat, i ? plays[i - 1].combo : null);
  }
  for (let s = 0; s < 4; s++) if (game.trick.passed[s]) add(s, game.trick.top);
  return m.list;
}

// ---------- Ausgedachte Kartenverteilungen ----------

function shuffleInPlace(a, rnd) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

// Kleiner reproduzierbarer Zufall (mulberry32), damit Arena-Ergebnisse wiederholbar sind
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Verteilt die unbekannten Karten auf die anderen Plätze. Rückgabe: hands[4] (eigene Hand echt).
function sampleHands(o, constraints, rnd) {
  const g = o.game;
  const base = [[], [], [], []];
  base[o.seat] = o.hand.slice();
  for (const c of o.unseen) if (o.knownAt.has(c.id)) base[o.knownAt.get(c.id)].push(c);
  const others = [0, 1, 2, 3].filter(s => s !== o.seat);
  const need = others.map(s => o.counts[s] - base[s].length);
  const byseat = new Map();
  for (const k of constraints.values()) {
    if (!byseat.has(k.seat)) byseat.set(k.seat, []);
    byseat.get(k.seat).push(k.top);
  }
  const ok = (s, h) => !(byseat.get(s) || []).some(top => T.mustFulfillWish(h, top, g.wish));
  let hands = null;
  for (let tries = 0; tries < 30; tries++) {
    const pool = shuffleInPlace(o.unknown.slice(), rnd);
    hands = base.map(h => h.slice());
    let k = 0;
    others.forEach((s, i) => { for (let j = 0; j < need[i]; j++) hands[s].push(pool[k++]); });
    if (!byseat.size || others.every(s => ok(s, hands[s]))) return hands;
  }
  // Notlösung: Wunschkarten von Spielern, die sie nicht haben können, gegen andere tauschen
  const w = g.wish;
  const known = new Set(o.knownAt.keys());
  for (const s of others) {
    if (ok(s, hands[s])) continue;
    for (let i = 0; i < hands[s].length; i++) {
      const c = hands[s][i];
      if (c.special || c.rank !== w || known.has(c.id)) continue;
      for (const t of others) {
        if (t === s || byseat.has(t)) continue;
        const j = hands[t].findIndex(x => !known.has(x.id) && (x.special || x.rank !== w));
        if (j < 0) continue;
        [hands[s][i], hands[t][j]] = [hands[t][j], hands[s][i]];
        break;
      }
    }
  }
  return hands;
}

// ---------- Rollouts ----------

// Kopie des Spielzustands mit ausgedachten Händen. Ohne Stich-Timer und ohne Protokoll.
function cloneGame(game, seat, hands) {
  const g = Object.create(Game.prototype);
  g.names = () => '';
  g.onChange = () => {};
  g.log = () => {};
  g.armClosing = function () { this.closing.timer = null; };
  g.target = game.target;
  g.scores = game.scores.slice();
  g.history = [];
  g.logs = [];
  g.round = game.round;
  g.moves = 0;
  g.random = Math.random;
  g.phase = game.phase;
  g.hands = hands;
  g.grandDecided = [true, true, true, true];
  g.tichu = game.tichu.slice();
  g.hasPlayed = game.hasPlayed.slice();
  // nur die eigenen Schupf-Karten sind bekannt
  g.exchange = [null, null, null, null];
  g.exchange[seat] = game.exchange[seat];
  g.received = [{}, {}, {}, {}];
  g.tricks = game.tricks.map(t => t.slice());
  const tr = game.trick;
  g.trick = tr ? {
    plays: tr.plays.slice(), top: tr.top, lastSeat: tr.lastSeat, passes: tr.passes, passed: tr.passed.slice(),
  } : null;
  g.lastTrick = null;
  g.wish = game.wish;
  g.turn = game.turn;
  g.finished = game.finished.slice();
  g.closing = null;
  g.dragonPending = game.dragonPending ? { ...game.dragonPending } : null;
  g.result = null;
  g.doubleWin = null;
  g.ready = [false, false, false, false];
  return g;
}

function applyAction(g, s, a) {
  switch (a.type) {
    case 'tichu': return g.callTichu(s);
    case 'dragon': return g.giveDragon(s, a.to);
    case 'play': return g.play(s, a.ids, a.wish);
    case 'pass': return g.pass(s);
  }
  return 'Unbekannte Aktion';
}

// Spielt die Runde mit dem Kartenzähler zu Ende; Rückgabe: Punkte eigenes Team − Gegner
function rollout(g, seat) {
  for (let steps = 0; steps < 2000; steps++) {
    if (g.phase !== 'play' && g.phase !== 'dragon') break;
    if (g.closing) {
      let bombed = false;
      for (let i = 1; i <= 4 && !bombed; i++) {
        const s = (g.closing.winner + i) % 4;
        const a = counter.decide(g, s);
        if (a && a.type === 'play' && !g.play(s, a.ids, a.wish)) bombed = true;
      }
      if (!bombed) { g.closing = null; g.finishTrick(); }
      continue;
    }
    const s = g.phase === 'dragon' ? g.dragonPending.winner : g.turn;
    const a = counter.decide(g, s);
    if (a && !applyAction(g, s, a)) continue;
    // Sollte nicht vorkommen: passen oder irgendeinen legalen Zug machen
    if (g.phase !== 'play' || !g.pass(s)) continue;
    const lp = T.legalPlays(g.hands[s], g.trick ? g.trick.top : null, g.mustFulfill(s) ? g.wish : null);
    if (!lp.length || g.play(s, lp[0].cards.map(c => c.id))) return 0;
  }
  if (!g.result) return 0;
  const t = team(seat);
  return g.result.total[t] - g.result.total[1 - t];
}

// ---------- Entscheidung ----------

function search(game, seat) {
  const { o, ranked } = counter.rankPlays(game, seat);
  // Kandidaten: die besten Züge laut Kartenzähler plus Passen (falls erlaubt)
  const cand = ranked.filter(p => p).slice(0, P.TOP);
  if (ranked.includes(null)) cand.push(null);
  const actions = cand.map(p => p ? counter.playAction(o, p) : { type: 'pass' });
  if (cand.length <= 1) return actions[0] || { type: 'pass' };
  const constraints = wishConstraints(game);
  const sum = new Float64Array(cand.length);
  // Zufall aus dem Spielzustand: gleiche Lage → gleiche Welten (wiederholbare Arena-Läufe)
  const rnd = rng(game.round * 7919 + game.moves * 104729 + seat * 31 + o.hand.length);
  const t0 = Date.now();
  let n = 0;
  // weiter, solange eine weitere Welt (geschätzt) noch ins Zeitbudget passt
  for (let el = 0; n < P.WORLDS && (n === 0 || el * (n + 1) / n <= P.MS); el = Date.now() - t0) {
    const hands = sampleHands(o, constraints, rnd);
    for (let i = 0; i < cand.length; i++) {
      const g = cloneGame(game, seat, hands.slice());
      sum[i] += applyAction(g, seat, actions[i]) ? -1e6 : rollout(g, seat);
    }
    n++;
  }
  let best = 0;
  for (let i = 1; i < cand.length; i++) if (sum[i] > sum[best]) best = i;
  // Die Wahl des Kartenzählers (Index 0) bleibt, wenn der Vorsprung zu klein ist
  if (best !== 0 && (sum[best] - sum[0]) / n < P.MARGIN) best = 0;
  return actions[best];
}

function decide(game, seat) {
  if (game.phase === 'play') wishConstraints(game);
  if (game.phase !== 'play' || game.closing || game.turn !== seat || game.hands[seat].length === 0) {
    return counter.decide(game, seat);
  }
  if (counter.wantsTichu(counter.observe(game, seat))) return { type: 'tichu' };
  return search(game, seat);
}

module.exports = { decide, P, sampleHands, cloneGame, rollout, wishConstraints };
