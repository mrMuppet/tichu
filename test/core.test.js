const test = require('node:test');
const assert = require('node:assert');
const T = require('../public/tichu-core.js');
const { Game } = require('../game.js');
const bot = require('../bot.js');

const deck = T.createDeck();
const byId = id => deck.find(c => c.id === id);
// Kurzschreibweise: "j5" = Jade 5, "s14" = Schwert As, MJ, DOG, PH, DR
function cards(str) {
  const map = { j: 'jade', s: 'sword', p: 'pagoda', t: 'star' };
  return str.split(' ').map(x => {
    if (x === 'MJ') return byId('mahjong');
    if (x === 'DOG') return byId('dog');
    if (x === 'PH') return byId('phoenix');
    if (x === 'DR') return byId('dragon');
    return byId(map[x[0]] + '-' + x.slice(1));
  });
}
const an = (s, top) => T.analyze(cards(s), top);

test('Deck hat 56 Karten und 100 Punkte', () => {
  assert.strictEqual(deck.length, 56);
  assert.strictEqual(T.sumPoints(deck), 100);
});

test('Einzelkarten, Phönix, Drache', () => {
  assert.deepStrictEqual(an('j7'), { type: 'single', rank: 7, len: 1 });
  assert.strictEqual(an('PH').rank, 1.5);
  assert.strictEqual(an('PH', { type: 'single', rank: 14, len: 1 }).rank, 14.5);
  assert.strictEqual(an('PH', { type: 'single', rank: 15, len: 1 }), null);
  assert.ok(T.beats(an('DR'), an('PH', an('s14'))));
  assert.ok(T.beats(an('j2'), an('PH')));
  assert.ok(!T.beats(an('j2'), an('PH', an('j2'))));
  assert.strictEqual(an('DOG').type, 'dog');
});

test('Paare, Drillinge, Full House', () => {
  assert.strictEqual(an('j7 s7').type, 'pair');
  assert.strictEqual(an('j7 PH').type, 'pair');
  assert.strictEqual(an('j7 s8'), null);
  assert.strictEqual(an('j7 s7 PH').type, 'triple');
  assert.deepStrictEqual(an('j7 s7 p7 j9 s9'), { type: 'fullhouse', rank: 7, len: 5 });
  assert.deepStrictEqual(an('j7 s7 j9 s9 PH'), { type: 'fullhouse', rank: 9, len: 5 });
  assert.deepStrictEqual(an('j7 s7 p7 j9 PH'), { type: 'fullhouse', rank: 7, len: 5 });
  assert.strictEqual(an('j7 s7 p7 t7 PH'), null);
});

test('Straßen und Paarfolgen', () => {
  assert.deepStrictEqual(an('MJ j2 s3 p4 t5'), { type: 'straight', rank: 5, len: 5 });
  assert.deepStrictEqual(an('j2 s3 PH t5 j6'), { type: 'straight', rank: 6, len: 5 });
  assert.deepStrictEqual(an('j10 s11 p12 t13 PH'), { type: 'straight', rank: 14, len: 5 });
  assert.deepStrictEqual(an('j10 s11 p12 t13 j14 PH'), { type: 'straight', rank: 14, len: 6 });
  assert.strictEqual(an('j2 s3 p4 t5'), null);
  assert.deepStrictEqual(an('j5 s5 j6 s6'), { type: 'pairs', rank: 6, len: 4 });
  assert.deepStrictEqual(an('j5 s5 j6 PH j7 s7'), { type: 'pairs', rank: 7, len: 6 });
  assert.strictEqual(an('j5 s5 j7 s7'), null);
  assert.ok(!T.beats(an('j3 s4 p5 t6 j7 s8'), an('j2 s3 p4 t5 j6')), 'andere Länge');
});

test('Bomben', () => {
  assert.strictEqual(an('j9 s9 p9 t9').type, 'bomb4');
  assert.strictEqual(an('j3 j4 j5 j6 j7').type, 'bombSF');
  assert.strictEqual(an('j3 j4 j5 j6 PH').type, 'straight');
  assert.ok(T.beats(an('j2 s2 p2 t2'), an('DR')));
  assert.ok(T.beats(an('j3 j4 j5 j6 j7'), an('j14 s14 p14 t14')));
  assert.ok(T.beats(an('s2 s3 s4 s5 s6 s7'), an('j9 j10 j11 j12 j13')));
  assert.ok(!T.beats(an('j14 s14 p14 t14'), an('j3 j4 j5 j6 j7')));
});

test('Wunschzwang', () => {
  const hand = cards('j8 s3 p13');
  assert.ok(T.mustFulfillWish(hand, null, 8));
  assert.ok(T.mustFulfillWish(hand, an('j5'), 8));
  assert.ok(!T.mustFulfillWish(hand, an('j9'), 8));
  assert.ok(!T.mustFulfillWish(hand, an('j5 s5'), 8));
  // Wunsch muss notfalls per Bombe erfüllt werden
  assert.ok(T.mustFulfillWish(cards('j8 s8 p8 t8 s3'), an('DR'), 8));
});

function simulate(seed) {
  let changes = 0;
  const g = new Game(s => 'P' + s, () => { changes++; });
  g.startRound();
  let steps = 0;
  while (g.phase !== 'gameOver' && steps < 20000) {
    steps++;
    if (g.closing) { clearTimeout(g.closing.timer); g.closing = null; g.finishTrick(); continue; }
    if (g.phase === 'roundEnd') {
      // Kartenpunkte einer Runde: immer 100 oder Doppelsieg 200
      const cp = g.result.cardPts;
      assert.ok(cp[0] + cp[1] === 100 || cp[0] + cp[1] === 200, 'Punkte ' + cp);
      g.startRound();
      continue;
    }
    let acted = false;
    for (let s = 0; s < 4 && !acted; s++) {
      const a = bot.decide(g, s);
      if (!a) continue;
      let e;
      if (a.type === 'grand') e = g.grand(s, Math.random() < 0.05);
      if (a.type === 'exchange') e = g.submitExchange(s, a.ex);
      if (a.type === 'dragon') e = g.giveDragon(s, a.to);
      if (a.type === 'play') e = g.play(s, a.ids, a.wish);
      if (a.type === 'pass') e = g.pass(s);
      assert.strictEqual(e, undefined, `Bot-Fehler: ${e} ${JSON.stringify(a)}`);
      acted = true;
    }
    if (!acted && g.phase === 'exchange') {
      for (let s = 0; s < 4; s++) if (!g.tichu[s] && Math.random() < 0.1) g.callTichu(s);
    }
    assert.ok(acted, 'Kein Spieler kann handeln in Phase ' + g.phase);
    // Kartenzahl bleibt 56
    if (g.hands && g.phase !== 'grand') {
      const total = g.hands.reduce((n, h) => n + h.length, 0) + g.tricks.reduce((n, t) => n + t.length, 0) +
        (g.trick ? g.trick.plays.reduce((n, p) => n + p.cards.length, 0) : 0) +
        (g.phase === 'exchange' ? g.exchange.filter(Boolean).length * 3 : 0);
      assert.strictEqual(total, 56, 'Kartenanzahl');
    }
  }
  assert.strictEqual(g.phase, 'gameOver');
  return g;
}

test('Komplette Bot-Partien laufen fehlerfrei durch', () => {
  for (let i = 0; i < 30; i++) {
    const g = simulate(i);
    assert.ok(Math.max(...g.scores) >= 1000);
  }
});
