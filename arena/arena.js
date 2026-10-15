// Bot-Arena: Bots spielen ohne Server/Browser gegeneinander.
//
//   node arena/arena.js [--a counter] [--b simple] [--games 200] [--seed 1] [--target 1000] [--set KEY=WERT,...] [--jobs N]
//
// Duplicate-Format: Jede Mischung (Startwert) wird zweimal gespielt, einmal mit Bot A auf
// den Plätzen 0/2 und einmal auf 1/3. So heben sich gute und schlechte Blätter weitgehend auf.
// Die Mischungen werden auf --jobs Worker-Threads verteilt (Standard: alle Prozessorkerne).
const path = require('path');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { Game } = require('../game.js');

// fresh: eigene Modul-Instanz (für Bot gegen sich selbst mit anderen Stellschrauben)
function loadBot(name, fresh) {
  const file = require.resolve(path.join(__dirname, '..', 'bots', name + '.js'));
  if (!fresh) return require(file);
  const cached = require.cache[file];
  delete require.cache[file];
  const mod = require(file);
  if (cached) require.cache[file] = cached; else delete require.cache[file];
  return mod;
}

function apply(g, s, a) {
  switch (a.type) {
    case 'grand': return g.grand(s, !!a.call);
    case 'tichu': return g.callTichu(s);
    case 'exchange': return g.submitExchange(s, a.ex);
    case 'dragon': return g.giveDragon(s, a.to);
    case 'play': return g.play(s, a.ids, a.wish);
    case 'pass': return g.pass(s);
  }
  return 'Unbekannte Aktion ' + a.type;
}

function newStats() {
  return {
    games: 0, wins: 0, rounds: 0, pointDiff: 0, diffSq: 0,
    tichu: { called: 0, made: 0 }, grand: { called: 0, made: 0 },
    firstOut: 0, doubleWins: 0, errors: 0, ms: 0, decisions: 0,
  };
}

// Spielt eine Partie; bots[s] = Bot-Modul für Platz s, label[s] = 'A' oder 'B'.
function playGame(bots, label, seed, target, stats) {
  const g = new Game(s => label[s] + s, () => {}, { seed, target });
  g.startRound();
  let steps = 0;
  const decide = s => {
    const t0 = process.hrtime.bigint();
    const a = bots[s].decide(g, s);
    stats[label[s]].ms += Number(process.hrtime.bigint() - t0) / 1e6;
    stats[label[s]].decisions++;
    return a;
  };
  const act = (s, a) => {
    const e = apply(g, s, a);
    if (e) {
      stats[label[s]].errors++;
      if (stats[label[s]].errors <= 5) console.error(`Fehler Bot ${label[s]} (Platz ${s}): ${e}`, JSON.stringify(a));
      if (a.type === 'play' && g.turn === s && !g.mustFulfill(s) && g.trick) g.pass(s);
      else if (a.type === 'play' || a.type === 'pass') {
        const fb = loadBot('simple').timeoutAction(g, s);
        if (fb) apply(g, s, fb);
      }
    }
  };
  while (g.phase !== 'gameOver') {
    if (++steps > 200000) throw new Error('Partie hängt (Seed ' + seed + ')');
    if (g.phase === 'roundEnd') {
      recordRound(g, label, stats);
      g.startRound();
      continue;
    }
    if (g.closing) {
      // Letzte Gelegenheit für Bomben, bevor der Stich vergeben wird
      let bombed = false;
      for (let i = 1; i <= 4 && !bombed; i++) {
        const s = (g.closing.winner + i) % 4;
        const a = decide(s);
        if (a && a.type === 'play') { act(s, a); bombed = true; }
      }
      if (!bombed) {
        clearTimeout(g.closing.timer);
        g.closing = null;
        g.finishTrick();
      }
      continue;
    }
    let acted = false;
    for (let s = 0; s < 4 && !acted; s++) {
      const a = decide(s);
      if (a) { act(s, a); acted = true; }
    }
    if (!acted) throw new Error(`Niemand kann handeln (Phase ${g.phase}, Seed ${seed})`);
  }
  recordRound(g, label, stats);
  const w = g.winner;
  stats[label[w]].wins++;
  stats.A.games++; stats.B.games++;
  return g;
}

function recordRound(g, label, stats) {
  const r = g.result;
  const tA = label[0] === 'A' ? 0 : 1;
  const d = r.total[tA] - r.total[1 - tA];
  stats.A.rounds++; stats.B.rounds++;
  stats.A.pointDiff += d; stats.A.diffSq += d * d;
  stats.B.pointDiff -= d; stats.B.diffSq += d * d;
  for (let s = 0; s < 4; s++) {
    const st = stats[label[s]];
    if (!g.tichu[s]) continue;
    const k = g.tichu[s] === 'grand' ? st.grand : st.tichu;
    k.called++;
    if (r.finished[0] === s) k.made++;
  }
  if (r.finished.length) stats[label[r.finished[0]]].firstOut++;
  if (g.doubleWin !== null) stats[label[g.doubleWin]].doubleWins++;
}

function loadPair(a, b, set) {
  const A = loadBot(a, true), B = loadBot(b);
  // --set KEY=1.5,OTHER=2 ändert Stellschrauben von Bot A (bots/<name>.js exportiert P)
  if (set) for (const kv of String(set).split(',')) { const [k, v] = kv.split('='); A.P[k] = Number(v); }
  return { A, B };
}

// Eine Mischung im Duplicate-Format (beide Sitzordnungen)
function playMix(A, B, sd, target, stats) {
  playGame([A, B, A, B], ['A', 'B', 'A', 'B'], sd, target, stats);
  playGame([B, A, B, A], ['B', 'A', 'B', 'A'], sd, target, stats);
}

function run({ a = 'counter', b = 'simple', games = 100, seed = 1, target = 1000, quiet = false, set } = {}) {
  const { A, B } = loadPair(a, b, set);
  const stats = { A: newStats(), B: newStats() };
  const t0 = Date.now();
  for (let i = 0; i < games; i++) {
    playMix(A, B, seed + i, target, stats);
    if (!quiet && (i + 1) % 10 === 0) process.stderr.write(`\r${i + 1}/${games} Mischungen`);
  }
  if (!quiet) process.stderr.write('\n');
  return { a, b, stats, seconds: (Date.now() - t0) / 1000 };
}

// Zahlen in verschachtelten Statistik-Objekten aufsummieren
function addStats(into, from) {
  for (const k of Object.keys(from)) {
    if (typeof from[k] === 'number') into[k] += from[k];
    else addStats(into[k], from[k]);
  }
}

// Wie run(), aber die Mischungen werden der Reihe nach an freie Worker-Threads vergeben
function runParallel({ a = 'counter', b = 'simple', games = 100, seed = 1, target = 1000, quiet = false, set, jobs } = {}) {
  const n = Math.max(1, Math.min(jobs || os.cpus().length, games));
  const stats = { A: newStats(), B: newStats() };
  const t0 = Date.now();
  let next = 0, done = 0, running = n;
  return new Promise((resolve, reject) => {
    for (let w = 0; w < n; w++) {
      const worker = new Worker(__filename, { workerData: { a, b, target, set } });
      const feed = () => { if (next < games) worker.postMessage(seed + next++); else worker.terminate(); };
      worker.on('message', st => {
        addStats(stats.A, st.A);
        addStats(stats.B, st.B);
        if (!quiet && ++done % 10 === 0) process.stderr.write(`\r${done}/${games} Mischungen`);
        feed();
      });
      worker.on('error', reject);
      worker.on('exit', () => {
        if (--running) return;
        if (!quiet) process.stderr.write('\n');
        resolve({ a, b, stats, seconds: (Date.now() - t0) / 1000 });
      });
      feed();
    }
  });
}

// Worker-Thread: spielt die zugeteilten Mischungen und meldet die Statistik zurück
if (!isMainThread && workerData && workerData.a) {
  const { a, b, target, set } = workerData;
  const { A, B } = loadPair(a, b, set);
  parentPort.on('message', sd => {
    const stats = { A: newStats(), B: newStats() };
    playMix(A, B, sd, target, stats);
    parentPort.postMessage(stats);
  });
}

function pct(x, n) { return n ? (100 * x / n).toFixed(1) + ' %' : '–'; }

function report({ a, b, stats, seconds }) {
  const { A, B } = stats;
  const n = A.rounds;
  const mean = A.pointDiff / n;
  const sd = Math.sqrt(Math.max(0, A.diffSq / n - mean * mean));
  const se = sd / Math.sqrt(n);
  const lines = [];
  lines.push(`${a} (A) gegen ${b} (B): ${A.games} Partien, ${n} Runden, ${seconds.toFixed(1)} s`);
  lines.push(`Partien gewonnen:  A ${A.wins}  –  B ${B.wins}   (A: ${pct(A.wins, A.games)})`);
  lines.push(`Punkte je Runde (A − B): ${mean >= 0 ? '+' : ''}${mean.toFixed(1)} ± ${(1.96 * se).toFixed(1)} (95 %)`);
  for (const [k, s, name] of [['A', A, a], ['B', B, b]]) {
    lines.push(`${k} ${name.padEnd(10)} zuerst raus ${pct(s.firstOut, n)} | Doppelsiege ${pct(s.doubleWins, n)} | ` +
      `Tichu ${s.tichu.made}/${s.tichu.called} | Gr. Tichu ${s.grand.made}/${s.grand.called} | ` +
      `${(s.ms / Math.max(1, s.decisions)).toFixed(2)} ms/Zug | Fehler ${s.errors}`);
  }
  return lines.join('\n');
}

if (require.main === module && isMainThread) {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i].replace(/^--/, '');
    const v = argv[i + 1];
    args[k] = /^\d+$/.test(v) ? Number(v) : v;
  }
  const done = res => {
    console.log(report(res));
    process.exit(0); // offene Stich-Timer nicht abwarten
  };
  if (args.jobs === 1) done(run(args));
  else runParallel(args).then(done, e => { console.error(e); process.exit(1); });
}

module.exports = { run, runParallel, report, playGame };
