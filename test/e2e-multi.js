// End-to-End-Test mit zwei Menschen und zwei Bots:
// Abstimmung (Neustart/Abbruch), Verbindungsabbruch, Bot-Ersatz, Rückkehr, Verlassen.
// Aufruf: node test/e2e-multi.js
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

const PORT = 3998;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT } });
srv.stderr.on('data', d => process.stderr.write('[server] ' + d));
const sleep = ms => new Promise(r => setTimeout(r, ms));
function fail(msg) { console.error('FEHLER:', msg); srv.kill(); process.exit(1); }
function check(cond, msg) { if (!cond) fail(msg); console.log('✓', msg); }

function player(name, token) {
  return new Promise(resolve => {
    const ws = new WebSocket('ws://localhost:' + PORT);
    const p = { ws, state: null, token, msgs: [], send: o => ws.send(JSON.stringify(o)) };
    ws.on('message', raw => {
      const m = JSON.parse(raw);
      p.msgs.push(m.t);
      if (m.t === 'joined') { p.token = m.token; resolve(p); }
      if (m.t === 'state') p.state = m.state;
    });
    ws.on('open', () => p.send({ t: 'join', room: 'MULTI', name, token }));
  });
}

(async () => {
  await sleep(800);
  const A = await player('Anna');
  const B = await player('Ben');
  await sleep(200);
  A.send({ t: 'addBot', seat: 2 }); A.send({ t: 'addBot', seat: 3 });
  await sleep(200);
  A.send({ t: 'start' });
  await sleep(300);
  check(A.state.game && A.state.game.phase === 'grand', 'Spiel gestartet');

  // Neustart-Abstimmung: braucht Bens Zustimmung
  A.send({ t: 'voteStart', kind: 'restart' });
  await sleep(200);
  check(B.state.vote && B.state.vote.kind === 'restart' && B.state.vote.eligible.length === 2, 'Ben sieht die Abstimmung (2 Stimmberechtigte)');
  check(A.state.game !== null, 'ohne Bens Zustimmung läuft das Spiel weiter');
  B.send({ t: 'voteNo' });
  await sleep(200);
  check(!A.state.vote && A.state.game, 'Ben lehnt ab -> Spiel geht weiter');

  A.send({ t: 'voteStart', kind: 'restart' });
  await sleep(100);
  B.send({ t: 'voteYes' });
  await sleep(200);
  check(A.state.game && A.state.game.round === 1 && !A.state.vote, 'Neustart nach Zustimmung');

  // Verbindungsabbruch von Ben -> offline -> Bot einsetzen
  const benToken = B.token;
  B.ws.close();
  await sleep(300);
  check(A.state.seats[1].online === false, 'Ben wird als offline angezeigt');
  A.send({ t: 'replaceOffline', seat: 1 });
  await sleep(300);
  check(A.state.seats[1].bot && A.state.seats[1].sub, 'Bot vertritt Ben');

  // Abbruch geht jetzt sofort (Anna ist die einzige verbundene Spielerin)
  // – vorher prüfen wir die Rückkehr von Ben
  const B2 = await player('Ben', benToken);
  await sleep(300);
  check(!A.state.seats[1].bot && A.state.seats[1].name === 'Ben' && B2.state.you === 1, 'Ben kehrt zurück und übernimmt wieder vom Bot');

  // Abbruch mit Zustimmung
  B2.send({ t: 'voteStart', kind: 'abort' });
  await sleep(100);
  A.send({ t: 'voteYes' });
  await sleep(200);
  check(A.state.game === null, 'Abbruch nach Zustimmung -> Warteraum');

  // Erneut starten, dann verlässt Anna den Tisch -> Bot spielt für sie
  A.send({ t: 'start' });
  await sleep(300);
  A.send({ t: 'leaveTable' });
  await sleep(300);
  check(A.msgs.includes('left'), 'Anna bekommt die Bestätigung "verlassen"');
  check(B2.state.seats[0].bot && B2.state.seats[0].sub, 'Bot spielt für Anna weiter');

  // Ben allein mit Bots: Abstimmung geht sofort durch
  B2.send({ t: 'voteStart', kind: 'abort' });
  await sleep(300);
  check(B2.state.game === null, 'allein mit Bots: Abbruch sofort');

  console.log('OK');
  srv.kill();
  process.exit(0);
})().catch(e => fail(e.stack));
