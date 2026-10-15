// Tests für den Such-Bot (bots/search.js) und die Hilfsfunktionen im Kartenzähler
const test = require('node:test');
const assert = require('node:assert');
const T = require('../public/tichu-core.js');
const { Game } = require('../game.js');
const counter = require('../bots/counter.js');
const search = require('../bots/search.js');

// Schnell und unabhängig von der Rechenzeit: feste Zahl an Welten
search.P.WORLDS = 4;
search.P.MS = 1e9;

const deck = T.createDeck();
const SUIT = { j: 'jade', s: 'sword', p: 'pagoda', t: 'star' };
const id = x => ({ MJ: 'mahjong', DOG: 'dog', PH: 'phoenix', DR: 'dragon' }[x] || SUIT[x[0]] + '-' + x.slice(1));
const cards = str => (str ? str.split(' ').map(x => deck.find(c => c.id === id(x))) : []);
const ids = str => str.split(' ').map(id);
const ok = r => assert.strictEqual(r, undefined, r);

function apply(g, s, a) {
  switch (a.type) {
    case 'grand': return g.grand(s, !!a.call);
    case 'tichu': return g.callTichu(s);
    case 'exchange': return g.submitExchange(s, a.ex);
    case 'dragon': return g.giveDragon(s, a.to);
    case 'play': return g.play(s, a.ids, a.wish);
    case 'pass': return g.pass(s);
  }
}

// Ein Schritt im Spiel (wie in arena/arena.js, Stich-Timer manuell schließen)
function step(g, bots) {
  if (g.closing) {
    for (let i = 1; i <= 4; i++) {
      const s = (g.closing.winner + i) % 4;
      const a = bots[s].decide(g, s);
      if (a && a.type === 'play') { ok(apply(g, s, a)); return; }
    }
    clearTimeout(g.closing.timer);
    g.closing = null;
    g.finishTrick();
    return;
  }
  for (let s = 0; s < 4; s++) {
    const a = bots[s].decide(g, s);
    if (a) { ok(apply(g, s, a)); return; }
  }
  throw new Error('Niemand kann handeln');
}

// Runde mit dem Kartenzähler bis zu einer Lage spielen, in der seat am Zug ist
function midGame(seed, moves) {
  const g = new Game(s => 'P' + s, () => {}, { seed });
  g.startRound();
  const bots = [counter, counter, counter, counter];
  while (g.phase !== 'play' || g.moves < moves || g.closing || g.turn === null) {
    if (g.phase === 'roundEnd' || g.phase === 'gameOver') return null;
    step(g, bots);
  }
  return g;
}

test('rankPlays: erster Eintrag ist die Wahl des Kartenzählers', () => {
  let checked = 0;
  for (let seed = 1; seed <= 15; seed++) {
    for (const moves of [0, 5, 12, 20]) {
      const g = midGame(seed, moves);
      if (!g) continue;
      const s = g.turn;
      const a = counter.decide(g, s);
      if (a.type === 'tichu') continue;
      const { ranked } = counter.rankPlays(g, s);
      const first = ranked[0];
      if (a.type === 'pass') assert.strictEqual(first, null);
      else assert.deepStrictEqual(first.cards.map(c => c.id).sort(), a.ids.slice().sort());
      checked++;
    }
  }
  assert.ok(checked > 30);
});

test('Ausgedachte Verteilungen passen zu Kartenzahlen, gespielten und geschupften Karten', () => {
  for (const seed of [3, 8, 21]) {
    const g = midGame(seed, 9);
    const s = g.turn;
    const o = counter.observe(g, s);
    const live = new Set(g.hands.flat().map(c => c.id));
    for (let k = 0; k < 30; k++) {
      const h = search.sampleHands(o, new Map(), Math.random);
      assert.deepStrictEqual(h.map(x => x.length), g.hands.map(x => x.length));
      assert.deepStrictEqual(h[s].map(c => c.id), g.hands[s].map(c => c.id));
      const all = h.flat().map(c => c.id);
      assert.strictEqual(new Set(all).size, all.length, 'keine Karte doppelt');
      for (const cid of all) assert.ok(live.has(cid), 'nur ungespielte Karten');
      for (const [cid, at] of o.knownAt) assert.ok(h[at].some(c => c.id === cid), 'geschupfte Karte beim Empfänger');
    }
  }
});

test('Wunsch-Zwang: wer den Wunsch nicht erfüllt hat, bekommt keine passende Karte', () => {
  const g = new Game(s => 'P' + s, () => {});
  g.startRound();
  g.hands = ['MJ j2 s3', 's9 p4 t6', 'j10 s11 j5', 't12 t13 j7'].map(cards);
  g.phase = 'play';
  g.turn = 0;
  ok(g.play(0, ids('MJ'), 8));
  ok(g.play(1, ids('s9')));  // ohne 8 gespielt -> Platz 1 hat keine 8
  ok(g.pass(2));             // gepasst -> Platz 2 kann keine 8 über die 9 legen
  const k = search.wishConstraints(g);
  assert.deepStrictEqual([...k.values()].map(x => x.seat).sort(), [1, 2]);
  const o = counter.observe(g, 3);
  let eights2 = 0;
  for (let i = 0; i < 300; i++) {
    const h = search.sampleHands(o, k, Math.random);
    assert.ok(!h[1].some(c => c.rank === 8 && !c.special), 'Platz 1 ohne 8');
    assert.ok(!T.mustFulfillWish(h[2], g.trick.top, 8), 'Platz 2 kann den Wunsch nicht erfüllen');
    if (h[2].some(c => c.rank === 8 && !c.special)) eights2++;
  }
  // eine einzelne 8 kann Platz 2 trotzdem haben (sie sticht die 9 nicht)
  assert.ok(eights2 > 0);
});

test('Such-Bot liest keine verdeckten Karten: andere Verteilung, gleiche Entscheidung', () => {
  let checked = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const g = midGame(seed, 6);
    if (!g) continue;
    const s = g.turn;
    const a1 = search.decide(g, s);
    // Unbekannte Karten der anderen neu verteilen (Kartenzahlen und geschupfte Karten bleiben)
    const o = counter.observe(g, s);
    const fake = search.sampleHands(o, search.wishConstraints(g), Math.random);
    const real = g.hands;
    g.hands = fake;
    const a2 = search.decide(g, s);
    g.hands = real;
    assert.deepStrictEqual(a2, a1);
    checked++;
  }
  assert.ok(checked >= 4);
});

test('Such-Bot spielt eine ganze Runde fehlerfrei', () => {
  const g = new Game(s => 'P' + s, () => {}, { seed: 5 });
  g.startRound();
  const bots = [search, counter, search, counter];
  let steps = 0;
  while (g.phase !== 'roundEnd' && g.phase !== 'gameOver') {
    assert.ok(++steps < 5000);
    step(g, bots);
  }
  const cp = g.result.cardPts;
  assert.ok(cp[0] + cp[1] === 100 || cp[0] + cp[1] === 200);
});

test('Regel-Bot: schupft die zwei niedrigsten an die Gegner, die höchste an den Partner, spielt eine Runde', () => {
  const rule = require('../bots/rule.js');
  const g = new Game(s => 'P' + s, () => {}, { seed: 4 });
  g.startRound();
  const bots = [rule, counter, rule, counter];
  while (g.phase === 'grand') step(g, bots);
  const hand = g.hands[0].slice();
  const a = rule.decide(g, 0);
  const order = c => c.special === 'dog' ? 0 : c.special === 'mahjong' ? 1 :
    c.special === 'phoenix' ? 15.5 : c.special === 'dragon' ? 16 : c.rank;
  const sorted = hand.slice().sort((x, y) => order(x) - order(y));
  assert.deepStrictEqual([a.ex.right, a.ex.left].map(i => order(hand.find(c => c.id === i))).sort((x, y) => x - y),
    [order(sorted[0]), order(sorted[1])]);
  assert.strictEqual(order(hand.find(c => c.id === a.ex.partner)), order(sorted[sorted.length - 1]));
  let steps = 0;
  while (g.phase !== 'roundEnd' && g.phase !== 'gameOver') {
    assert.ok(++steps < 5000);
    step(g, bots);
  }
  assert.ok(!g.tichu[0] && !g.tichu[2], 'Regel-Bot sagt nie Tichu');
});

test('Server-Bot: die schnelle Probe will genau dann handeln, wenn der Such-Bot handelt', () => {
  const bot = require('../bot.js');
  const g = new Game(s => 'P' + s, () => {}, { seed: 9 });
  g.startRound();
  let steps = 0, checked = 0;
  while (g.phase !== 'roundEnd' && g.phase !== 'gameOver') {
    assert.ok(++steps < 5000);
    for (let s = 0; s < 4; s++) {
      const want = !!bot.wantsToAct(g, s);
      // am Zug handelt der Such-Bot immer (die teure Suche selbst wird hier nicht aufgerufen)
      if (g.phase === 'play' && !g.closing && g.turn === s && g.hands[s].length) assert.ok(want);
      else assert.strictEqual(want, !!bot.decide(g, s), `Platz ${s}, Phase ${g.phase}`);
      checked++;
    }
    step(g, [counter, counter, counter, counter]);
  }
  assert.ok(checked > 100);
});
