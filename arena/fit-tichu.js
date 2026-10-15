// Lernt die Tichu-Modelle des Kartenzähler-Bots aus Selbstspiel:
// Merkmale der Hand → ging der Spieler zuerst raus? (logistische Regression)
//   node arena/fit-tichu.js [--rounds 20000]
// Die ausgegebenen Gewichte werden in bots/counter.js (TICHU_W, GRAND_W) eingetragen.
const { Game } = require('../game.js');
const bot = require('../bots/counter.js');

const argv = process.argv.slice(2);
const rounds = Number(argv[argv.indexOf('--rounds') + 1]) || 20000;
bot.P.TICHU_P = 2; bot.P.GRAND_P = 2; // keine Ansagen beim Datensammeln

const apply = (g, s, a) => {
  switch (a.type) {
    case 'grand': return g.grand(s, a.call);
    case 'exchange': return g.submitExchange(s, a.ex);
    case 'dragon': return g.giveDragon(s, a.to);
    case 'play': return g.play(s, a.ids, a.wish);
    case 'pass': return g.pass(s);
  }
};

const tichuData = [], grandData = [];
let done = 0, seed = 1;
while (done < rounds) {
  const g = new Game(s => 'P' + s, () => {}, { seed: seed++, target: 1000 });
  g.startRound();
  let samples = { grand: [0, 1, 2, 3].map(s => bot.grandFeatures(g.hands[s])), tichu: null };
  while (done < rounds) {
    if (g.phase === 'play' && !samples.tichu) {
      samples.tichu = [0, 1, 2, 3].map(s => { const o = bot.observe(g, s); return bot.tichuFeatures(o.hand, o.threats); });
    }
    if (g.phase === 'roundEnd' || g.phase === 'gameOver') {
      const first = g.result.finished[0];
      for (let s = 0; s < 4; s++) {
        grandData.push([samples.grand[s], first === s ? 1 : 0]);
        tichuData.push([samples.tichu[s], first === s ? 1 : 0]);
      }
      done++;
      if (g.phase === 'gameOver') break;
      g.startRound();
      samples = { grand: [0, 1, 2, 3].map(s => bot.grandFeatures(g.hands[s])), tichu: null };
      continue;
    }
    if (g.closing) {
      let b = false;
      for (let i = 1; i <= 4 && !b; i++) {
        const s = (g.closing.winner + i) % 4;
        const a = bot.decide(g, s);
        if (a && a.type === 'play') { apply(g, s, a); b = true; }
      }
      if (!b) { clearTimeout(g.closing.timer); g.closing = null; g.finishTrick(); }
      continue;
    }
    for (let s = 0; s < 4; s++) { const a = bot.decide(g, s); if (a) { apply(g, s, a); break; } }
  }
}

// Logistische Regression per Newton-Verfahren (mit leichter L2-Regularisierung)
function fit(data) {
  const d = data[0][0].length + 1;
  let w = new Array(d).fill(0);
  const X = data.map(([f]) => [1, ...f]), y = data.map(([, l]) => l);
  for (let it = 0; it < 25; it++) {
    const g = new Array(d).fill(0);
    const H = Array.from({ length: d }, () => new Array(d).fill(0));
    for (let n = 0; n < X.length; n++) {
      const x = X[n];
      let z = 0;
      for (let i = 0; i < d; i++) z += w[i] * x[i];
      const p = 1 / (1 + Math.exp(-z));
      for (let i = 0; i < d; i++) {
        g[i] += (p - y[n]) * x[i];
        for (let j = 0; j < d; j++) H[i][j] += p * (1 - p) * x[i] * x[j];
      }
    }
    for (let i = 1; i < d; i++) { g[i] += 1e-3 * w[i]; H[i][i] += 1e-3; }
    // H · delta = g lösen (Gauß-Jordan)
    const A = H.map((row, i) => [...row, g[i]]);
    for (let c = 0; c < d; c++) {
      let piv = c;
      for (let r = c + 1; r < d; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]];
      for (let r = 0; r < d; r++) {
        if (r === c) continue;
        const f = A[r][c] / A[c][c];
        for (let k = c; k <= d; k++) A[r][k] -= f * A[c][k];
      }
    }
    w = w.map((wi, i) => wi - A[i][d] / A[i][i]);
  }
  return w;
}

// Wie gut stimmen vorhergesagte und tatsächliche Quoten überein?
function calibration(data, w) {
  const bins = Array.from({ length: 10 }, () => [0, 0]);
  let ll = 0;
  for (const [f, l] of data) {
    let z = w[0];
    f.forEach((v, i) => { z += w[i + 1] * v; });
    const p = 1 / (1 + Math.exp(-z));
    ll += l ? Math.log(p) : Math.log(1 - p);
    const b = Math.min(9, Math.floor(p * 10));
    bins[b][0]++;
    bins[b][1] += l;
  }
  return {
    ll: (ll / data.length).toFixed(4),
    bins: bins.map((b, i) => b[0] ? `${i * 10}–${i * 10 + 10} %: ${b[0]} Hände, davon ${(100 * b[1] / b[0]).toFixed(0)} % zuerst raus` : null).filter(Boolean),
  };
}

const r4 = w => '[' + w.map(x => Number(x.toFixed(4))).join(', ') + ']';
const tw = fit(tichuData), gw = fit(grandData);
console.log(`${tichuData.length} Hände aus ${done} Runden`);
console.log(`const TICHU_W = ${r4(tw)};`);
console.log(`const GRAND_W = ${r4(gw)};`);
for (const [name, data, w] of [['Tichu', tichuData, tw], ['Großes Tichu', grandData, gw]]) {
  const c = calibration(data, w);
  console.log(`\n${name} (Log-Likelihood ${c.ll}, ohne Modell ${(Math.log(0.25) * 0.25 + Math.log(0.75) * 0.75).toFixed(4)})`);
  for (const b of c.bins) console.log('  ' + b);
}
process.exit(0);
