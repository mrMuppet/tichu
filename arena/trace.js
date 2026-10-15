// Zeigt eine Runde Zug für Zug mit allen Händen (zur Fehlersuche an Bots).
//   node arena/trace.js [--seed 7] [--a counter] [--b simple]
const path = require('path');
const T = require('../public/tichu-core.js');
const { Game } = require('../game.js');

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
const A = require(path.join(__dirname, '..', 'bots', (args.a || 'counter') + '.js'));
const B = require(path.join(__dirname, '..', 'bots', (args.b || 'simple') + '.js'));
const bots = [A, B, A, B];
const lbl = s => (s % 2 ? 'B' : 'A') + s;
const show = cards => T.sortCards(cards).map(c => c.special ? { mahjong: 'MJ', dog: 'Hund', phoenix: 'Ph', dragon: 'Dr' }[c.special] : T.rankLabel(c.rank) + { jade: 'j', sword: 'w', pagoda: 'p', star: 's' }[c.suit]).join(' ');

const g = new Game(lbl, () => {}, { seed: Number(args.seed || 7), target: 1 });
g.startRound();
let shown = false;
const apply = (s, a) => {
  switch (a.type) {
    case 'grand': return g.grand(s, a.call);
    case 'tichu': return g.callTichu(s);
    case 'exchange': return g.submitExchange(s, a.ex);
    case 'dragon': return g.giveDragon(s, a.to);
    case 'play': return g.play(s, a.ids, a.wish);
    case 'pass': return g.pass(s);
  }
};
while (g.phase !== 'roundEnd' && g.phase !== 'gameOver') {
  if (g.phase === 'play' && !shown) {
    shown = true;
    for (let s = 0; s < 4; s++) console.log(`${lbl(s)} (${g.hands[s].length}): ${show(g.hands[s])}`);
    console.log('---');
  }
  if (g.closing) {
    let b = false;
    for (let i = 1; i <= 4 && !b; i++) {
      const s = (g.closing.winner + i) % 4;
      const a = bots[s].decide(g, s);
      if (a && a.type === 'play') { apply(s, a); b = true; }
    }
    if (!b) { clearTimeout(g.closing.timer); g.closing = null; g.finishTrick(); }
    continue;
  }
  for (let s = 0; s < 4; s++) {
    const a = bots[s].decide(g, s);
    if (!a) continue;
    if (a.type === 'play' || a.type === 'pass') {
      const hand = show(g.hands[s]);
      const e = apply(s, a);
      if (a.type === 'play') console.log(`${lbl(s)} [${hand}] spielt ${show(a.ids.map(id => T.createDeck().find(c => c.id === id)))}${e ? ' FEHLER ' + e : ''}`);
      else console.log(`${lbl(s)} [${hand}] passt`);
    } else apply(s, a);
    break;
  }
}
for (const l of g.logs) if (/nimmt|Drache|fertig|beendet|Tichu|Hund|Wunsch|Doppelsieg/i.test(l.text)) console.log('  » ' + l.text);
console.log(g.result.notes.join('\n'));
process.exit(0);
