// Tests für Mah Jong (Wunsch), Phönix, Hund und Drache auf Spielebene
const test = require('node:test');
const assert = require('node:assert');
const T = require('../public/tichu-core.js');
const { Game } = require('../game.js');

const deck = T.createDeck();
const SUIT = { j: 'jade', s: 'sword', p: 'pagoda', t: 'star' };
const id = x => ({ MJ: 'mahjong', DOG: 'dog', PH: 'phoenix', DR: 'dragon' }[x] || SUIT[x[0]] + '-' + x.slice(1));
const cards = str => (str ? str.split(' ').map(x => deck.find(c => c.id === id(x))) : []);
const ids = str => str.split(' ').map(id);

// Spiel direkt in der Spielphase mit festen Händen aufsetzen
function setup(h0, h1, h2, h3, turn = 0) {
  const g = new Game(s => 'P' + s, () => {});
  g.startRound();
  g.hands = [h0, h1, h2, h3].map(cards);
  g.phase = 'play';
  g.turn = turn;
  return g;
}
const ok = r => assert.strictEqual(r, undefined, r);
const err = (r, re) => assert.match(String(r), re);
// Stich sofort abschließen statt 2,5 s zu warten
function close(g) { clearTimeout(g.closing.timer); g.closing = null; g.finishTrick(); }

test('Mah Jong: Wunsch wird gesetzt, erzwungen und durch echte Karte erfüllt', () => {
  const g = setup('MJ j2 s3', 'j8 s9 p4', 'j10 s11', 't12 t13');
  ok(g.play(0, ids('MJ'), 8));
  assert.strictEqual(g.wish, 8);
  // P1 hat die 8 und kann sie spielen -> Passen verboten, andere Karte verboten
  err(g.pass(1), /Wunsch/);
  err(g.play(1, ids('s9')), /Wunsch/);
  ok(g.play(1, ids('j8')));
  assert.strictEqual(g.wish, null, 'Wunsch erfüllt');
});

test('Mah Jong: Wunsch bleibt bestehen, wenn niemand die Karte hat', () => {
  const g = setup('MJ j2', 's3 p4', 'j10 s11', 't12 t13');
  ok(g.play(0, ids('MJ'), 8));
  ok(g.pass(1));
  ok(g.play(2, ids('j10')));
  assert.strictEqual(g.wish, 8);
});

test('Mah Jong: ohne Wunsch und in einer Straße', () => {
  const g = setup('MJ j2 s3 p4 t5 j9', 'j8 s9', 'j10 s11', 't12 t13');
  ok(g.play(0, ids('MJ j2 s3 p4 t5'), 9));
  assert.strictEqual(g.trick.top.type, 'straight');
  assert.strictEqual(g.wish, 9, 'Wunsch auch beim Mah Jong in der Straße');
  const g2 = setup('MJ j2', 'j8 s9', 'j10 s11', 't12 t13');
  ok(g2.play(0, ids('MJ'), null));
  assert.strictEqual(g2.wish, null);
});

test('Wunsch: Phönix erfüllt den Wunsch nicht, gilt aber als Joker in der Kombination', () => {
  const g = setup('MJ j2', 'PH s9', 'j10 s11', 't12 t13');
  ok(g.play(0, ids('MJ'), 8));
  ok(g.play(1, ids('PH'))); // P1 hat keine echte 8 -> darf frei spielen
  assert.strictEqual(g.wish, 8, 'Phönix ist keine 8');
});

test('Wunsch: kann nicht erfüllt werden, wenn die 8 zu niedrig ist', () => {
  const g = setup('j10 j2', 'j8 s9', 'j11 s12', 't12 t13');
  g.wish = 8;
  ok(g.play(0, ids('j10')));
  ok(g.pass(1)); // 8 sticht die 10 nicht -> Passen erlaubt
});

test('Wunsch: muss notfalls mit Bombe erfüllt werden', () => {
  const g = setup('j14 j2', 'j8 s8 p8 t8 s3', 'j11', 't12');
  g.wish = 8;
  ok(g.play(0, ids('j14')));
  err(g.pass(1), /Wunsch/);
  ok(g.play(1, ids('j8 s8 p8 t8')));
  assert.strictEqual(g.wish, null);
});

test('Wunsch: beim Ausspielen muss die gewünschte Karte dabei sein (auch kein Hund)', () => {
  const g = setup('DOG j8 s3', 'j9', 'j11', 't12');
  g.wish = 8;
  err(g.play(0, ids('DOG')), /Wunsch/);
  err(g.play(0, ids('s3')), /Wunsch/);
  ok(g.play(0, ids('j8')));
});

test('Phönix: Einzelkarte ½ über der letzten, schlägt As, nicht den Drachen', () => {
  const g = setup('s14 j2', 'PH s3', 'DR j4', 't12 t13');
  ok(g.play(0, ids('s14')));
  ok(g.play(1, ids('PH')));
  assert.strictEqual(g.trick.top.rank, 14.5);
  ok(g.play(2, ids('DR')));
  const g2 = setup('DR j2', 'PH s3', 'j4', 't12');
  ok(g2.play(0, ids('DR')));
  err(g2.play(1, ids('PH')), /Ungültig|sticht/);
});

test('Phönix: angespielt Wert 1½, jede 2 sticht ihn', () => {
  const g = setup('PH j5', 's2 s3', 'j4', 't12');
  ok(g.play(0, ids('PH')));
  assert.strictEqual(g.trick.top.rank, 1.5);
  ok(g.play(1, ids('s2')));
});

test('Phönix als Joker in Paar, Full House, Straße, Paarfolge – aber keine Bombe', () => {
  const g = setup('PH j7 s9 p9 t9 j3', 's2', 'j4', 't12');
  ok(g.play(0, ids('s9 p9 t9 j7 PH')));
  assert.strictEqual(g.trick.top.type, 'fullhouse');
  assert.strictEqual(T.analyze(cards('j7 s7 p7 PH')), null, 'kein Vierling mit Phönix');
  assert.strictEqual(T.analyze(cards('j3 j4 j5 j6 PH')).type, 'straight', 'keine Farbbombe mit Phönix');
  assert.strictEqual(T.analyze(cards('j5 s5 j6 PH')).type, 'pairs');
});

test('Hund: gibt Ausspiel an Partner, nur beim Ausspielen', () => {
  const g = setup('DOG j5', 's2 s3', 'j4 j9', 't12 t13');
  ok(g.play(0, ids('DOG')));
  assert.strictEqual(g.turn, 2, 'Partner spielt aus');
  assert.strictEqual(g.trick, null);
  const g2 = setup('j5 j6', 'DOG s3', 'j4', 't12');
  ok(g2.play(0, ids('j5')));
  err(g2.play(1, ids('DOG')), /Hund|sticht/);
});

test('Hund: ist der Partner fertig, erbt der Spieler zu dessen Rechten', () => {
  const g = setup('DOG j5', 's2 s3', '', 't12 t13');
  g.finished = [2];
  ok(g.play(0, ids('DOG')));
  assert.strictEqual(g.turn, 3);
});

test('Drache: Stich wird an einen Gegner verschenkt, nicht an den Partner', () => {
  const g = setup('DR j5', 's2 s3', 'j4 j9', 't12 t13');
  ok(g.play(0, ids('DR')));
  ok(g.pass(1)); ok(g.pass(2)); ok(g.pass(3));
  close(g);
  assert.strictEqual(g.phase, 'dragon');
  err(g.giveDragon(0, 2), /Gegner/);
  ok(g.giveDragon(0, 3));
  assert.ok(g.tricks[3].some(c => c.special === 'dragon'));
  assert.strictEqual(g.phase, 'play');
  assert.strictEqual(g.turn, 0, 'Drachenspieler spielt wieder aus');
});

test('Drache: gebombter Drache wird nicht verschenkt', () => {
  const g = setup('DR j5', 'j9 s9 p9 t9 s3', 'j4', 't12');
  ok(g.play(0, ids('DR')));
  ok(g.play(1, ids('j9 s9 p9 t9')));
  // alle anderen haben nur noch 1 Karte und werden automatisch übersprungen
  assert.ok(g.closing);
  close(g);
  assert.strictEqual(g.phase, 'play');
  assert.ok(g.tricks[1].some(c => c.special === 'dragon'));
});

test('Drache als letzte Karte des Dritten: Stich wird vor der Wertung verschenkt', () => {
  const g = setup('DR', 's2 s3', '', '');
  g.finished = [2, 3];
  ok(g.play(0, ids('DR')));
  assert.strictEqual(g.phase, 'dragon');
  ok(g.giveDragon(0, 1));
  assert.strictEqual(g.phase, 'roundEnd');
});

test('Autoskip: wer zu wenige Karten und keine Bombe hat, wird übersprungen', () => {
  const g = setup('j3 s3 p3 j6 s6 t9', 's2 s4', 'j10 s10 p10 t5 j5', 't12');
  ok(g.play(0, ids('j3 s3 p3 j6 s6')));     // Full House (5 Karten)
  assert.strictEqual(g.turn, 2, 'P1 (2 Karten) übersprungen, P2 ist dran');
  assert.ok(g.trick.passed[1]);
  assert.match(g.logs.at(-1).text, /übersprungen/);
});

test('Autoskip: mit passender Bombe wird nicht übersprungen', () => {
  const g = setup('j3 s4 p5 t6 j7 s9', 'j8 s8 p8 t8', 'j10', 't12');
  ok(g.play(0, ids('j3 s4 p5 t6 j7')));     // Straße (5 Karten)
  assert.strictEqual(g.turn, 1, 'P1 hat nur 4 Karten, aber eine Bombe');
});

test('Autoskip: alle übersprungen -> Stich wird abgeschlossen', () => {
  const g = setup('j3 s3 p3 j6 s6 t9', 's2', 'j4', 't12');
  ok(g.play(0, ids('j3 s3 p3 j6 s6')));
  assert.ok(g.closing, 'alle anderen übersprungen');
  clearTimeout(g.closing.timer);
});

test('Autoskip: ab 4 Karten nie überspringen, auch ohne Bombe', () => {
  const g = setup('j3 s4 p5 t6 j7 s9', 'j8 s10 p12 t2', 'j10', 't12');
  ok(g.play(0, ids('j3 s4 p5 t6 j7')));     // Straße (5 Karten)
  assert.strictEqual(g.turn, 1, 'P1 hat 4 Karten (keine Bombe) und muss selbst passen');
});

test('Feste Mischung: gleicher Startwert = gleiche Blätter, anderer = andere', () => {
  const deal = seed => {
    const g = new Game(s => 'P' + s, () => {}, { seed });
    g.startRound();
    const r1 = g.fullHands.map(h => h.map(c => c.id).join());
    g.startRound();
    return r1.concat(g.fullHands.map(h => h.map(c => c.id).join())).join('|');
  };
  assert.strictEqual(deal(4711), deal(4711));
  assert.notStrictEqual(deal(4711), deal(4712));
});
