// Mehrere Einstellungen parallel gegen einen Gegner testen.
//   node arena/tune.js --games 200 --b simple "LEAD=1" "LEAD=1.5" ...
const { execFile } = require('child_process');
const os = require('os');
const path = require('path');
const argv = process.argv.slice(2);
const opts = { games: 200, b: 'simple', a: 'counter', base: '' };
const sets = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) opts[argv[i].slice(2)] = argv[++i];
  else sets.push(argv[i]);
}
if (!sets.length) sets.push('');
let running = 0, idx = 0;
const results = [];
function next() {
  while (running < os.cpus().length && idx < sets.length) {
    const set = [opts.base, sets[idx]].filter(Boolean).join(',');
    const i = idx++;
    running++;
    const args = [path.join(__dirname, 'arena.js'), '--a', opts.a, '--b', opts.b, '--games', String(opts.games), '--jobs', '1'];
    if (opts.seed) args.push('--seed', String(opts.seed));
    if (set) args.push('--set', set);
    execFile(process.execPath, args, { maxBuffer: 1e7 }, (err, out) => {
      running--;
      const m = out.match(/A − B\): ([+-]?[\d.]+) ± ([\d.]+)/);
      const t = out.match(/A counter.*?Tichu (\d+)\/(\d+) \| Gr\. Tichu (\d+)\/(\d+)/);
      results[i] = `${(sets[i] || '(Standard)').padEnd(40)} ${m ? m[1].padStart(6) + ' ± ' + m[2] : 'FEHLER ' + (err && err.message)}` +
        (t ? `   Tichu ${t[1]}/${t[2]}  Gr ${t[3]}/${t[4]}` : '');
      if (idx >= sets.length && running === 0) console.log(results.join('\n'));
      next();
    });
  }
}
next();
