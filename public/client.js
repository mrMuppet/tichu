/* global Tichu */
(function () {
  'use strict';
  const T = Tichu;
  const $ = sel => document.querySelector(sel);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* egal */ } },
  };

  let ws = null;
  let room = null;          // aktueller Tisch-Code
  let S = null;             // letzter Zustand vom Server
  let selected = new Set(); // ausgewählte Karten-IDs
  let exSlots = { left: null, partner: null, right: null };
  let wishValue = '';
  let sortBySuit = store.get('tichu.sortSuit') === '1';
  let wasMyTurn = false;
  let modalKey = null;
  let showHistory = false;

  // ---------- Verbindung ----------

  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    ws.onopen = () => {
      $('#conn').classList.add('hidden');
      if (room !== null) sendJoin();
    };
    ws.onclose = () => {
      if (room !== null) $('#conn').classList.remove('hidden');
      setTimeout(connect, 1500);
    };
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.t === 'joined') {
        room = msg.room;
        store.set('tichu.token.' + room, msg.token);
        history.replaceState(null, '', '?room=' + room);
        $('#start').classList.add('hidden');
        $('#game').classList.remove('hidden');
        $('#room-code').textContent = room;
      } else if (msg.t === 'state') {
        S = msg.state;
        render();
      } else if (msg.t === 'error') {
        toast(msg.msg);
      } else if (msg.t === 'kicked') {
        room = null;
        toast('Du hast diesen Tisch in einem anderen Fenster geöffnet.');
      }
    };
  }

  function send(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  function sendJoin() {
    send({ t: 'join', room, name: store.get('tichu.name') || 'Spieler', token: store.get('tichu.token.' + room) });
  }

  function startJoin(code) {
    const name = $('#name-input').value.trim();
    if (!name) { toast('Bitte gib deinen Namen ein.'); $('#name-input').focus(); return; }
    store.set('tichu.name', name);
    room = code;
    if (ws && ws.readyState === 1) sendJoin();
  }

  // ---------- Hilfen ----------

  let toastTimer;
  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  function beep() {
    try {
      const ctx = beep.ctx || (beep.ctx = new (window.AudioContext || window.webkitAudioContext)());
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 660; g.gain.value = 0.06;
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.12);
    } catch (e) { /* egal */ }
  }

  const SUIT_SYM = { jade: '◆', sword: '⚔', pagoda: '▲', star: '★' };
  const SPECIAL = {
    mahjong: { sym: '🐦', r: '1', name: 'Mah Jong' },
    dog: { sym: '🐕', r: '', name: 'Hund' },
    phoenix: { sym: '🔥', r: '', name: 'Phönix' },
    dragon: { sym: '🐉', r: '', name: 'Drache' },
  };

  function cardHTML(c, extra) {
    extra = extra || '';
    if (c.special) {
      const sp = SPECIAL[c.special];
      return `<div class="card sp-${c.special} ${extra}" data-id="${c.id}" title="${sp.name}">` +
        (sp.r ? `<span class="r">${sp.r}</span>` : '') +
        `<span class="sym">${sp.sym}</span><span class="sname">${sp.name}</span></div>`;
    }
    const r = T.rankLabel(c.rank);
    return `<div class="card s-${c.suit} ${extra}" data-id="${c.id}"><span class="r">${r}</span>` +
      `<span class="sym">${SUIT_SYM[c.suit]}</span><span class="r2">${r}</span></div>`;
  }

  const me = () => (S && S.you !== null ? S.you : null);
  const base = () => (me() !== null ? me() : 0);
  const posOf = seat => ['bottom', 'right', 'top', 'left'][(seat - base() + 4) % 4];
  const nameOf = seat => (S.seats[seat] ? S.seats[seat].name : `Platz ${seat + 1}`);
  const team = seat => seat % 2;

  function sortedHand(hand) {
    if (!sortBySuit) return hand;
    const order = { jade: 1, sword: 2, pagoda: 3, star: 4 };
    return hand.slice().sort((a, b) => {
      const oa = a.special ? (a.special === 'dragon' ? 9 : 0) : order[a.suit];
      const ob = b.special ? (b.special === 'dragon' ? 9 : 0) : order[b.suit];
      return oa - ob || T.sortValue(a) - T.sortValue(b);
    });
  }

  // ---------- Darstellung ----------

  function render() {
    const g = S.game;
    // Auswahl bereinigen
    const handIds = new Set(g && g.hand ? g.hand.map(c => c.id) : []);
    for (const id of [...selected]) if (!handIds.has(id)) selected.delete(id);
    if (!g || g.phase !== 'exchange' || (g.myExchange)) exSlots = { left: null, partner: null, right: null };
    for (const k in exSlots) if (exSlots[k] && !handIds.has(exSlots[k])) exSlots[k] = null;

    renderScore();
    renderSeats();
    renderCenter();
    renderActions();
    renderHand();
    renderLog();
    renderModal();

    const myTurn = g && g.phase === 'play' && g.turn === me() && me() !== null;
    if (myTurn && !wasMyTurn) { beep(); }
    wasMyTurn = myTurn;
    document.title = myTurn ? '● Du bist dran – Tichu' : 'Tichu Online';
  }

  function renderScore() {
    const g = S.game;
    const scores = g ? g.scores : [0, 0];
    const t = me() !== null ? team(me()) : -1;
    $('#scoreboard').innerHTML = [0, 1].map(i =>
      `<div class="team ${i === t ? 'mine' : ''}"><span class="team-dot team-${i}" style="width:9px;height:9px;border-radius:50%;display:inline-block"></span>` +
      `<span class="names">${esc(nameOf(i))} & ${esc(nameOf(i + 2))}</span><span class="pts">${scores[i]}</span></div>`
    ).join('<span>:</span>');
  }

  function renderSeats() {
    const g = S.game;
    for (let seat = 0; seat < 4; seat++) {
      const el = $('#seat-' + posOf(seat));
      const info = S.seats[seat];
      if (!g || g.phase === 'lobby') { el.classList.add('hidden'); continue; }
      el.classList.remove('hidden');
      const count = g.counts[seat];
      const badges = [];
      if (g.tichu[seat] === 'small') badges.push('<span class="badge tichu">TICHU</span>');
      if (g.tichu[seat] === 'grand') badges.push('<span class="badge grand">GROSSES TICHU</span>');
      const place = g.finished.indexOf(seat);
      if (place >= 0) badges.push(`<span class="badge place">${place + 1}. Platz</span>`);
      if (info && !info.online) badges.push('<span class="badge off">offline</span>');
      const meta = [];
      if (g.phase === 'grand') meta.push(g.grandDecided[seat] ? '✓ entschieden' : 'überlegt…');
      else if (g.phase === 'exchange') meta.push(g.exchanged[seat] ? '✓ geschupft' : 'schupft…');
      else if (g.phase === 'roundEnd') meta.push(g.ready[seat] || (info && info.bot) ? '✓ bereit' : 'wartet…');
      else meta.push(`${count} Karten`);
      meta.push(`Stiche: ${g.trickPoints[seat]} P.`);
      const turn = g.turn === seat || (g.phase === 'dragon' && g.dragonWinner === seat);
      el.classList.toggle('turn', turn);
      const isMe = seat === me();
      el.innerHTML =
        `<div class="name"><span class="team-dot team-${team(seat)}"></span>${esc(nameOf(seat))}${isMe ? ' (du)' : ''}${info && info.bot ? ' 🤖' : ''}</div>` +
        (badges.length ? `<div class="meta">${badges.join('')}</div>` : '') +
        (!isMe ? `<div class="backs">${'<div class="back"></div>'.repeat(Math.min(count, 14))}</div>` : '') +
        `<div class="meta">${meta.join(' · ')}</div>`;
    }
  }

  function renderCenter() {
    const g = S.game;
    const status = $('#status'), trick = $('#trick');
    if (!g) { status.innerHTML = ''; trick.innerHTML = lobbyHTML(); return; }

    const parts = [];
    if (g.wish) parts.push(`<span class="wish">Wunsch: ${T.rankLabel(g.wish)}</span>`);
    if (g.phase === 'grand') parts.push('Großes Tichu ansagen? (8 Karten sichtbar)');
    else if (g.phase === 'exchange') parts.push('Schupfen: Gib jedem Mitspieler eine Karte.');
    else if (g.phase === 'play') {
      if (g.closing) {
        parts.push(`Stich geht an <b>${esc(nameOf(g.closing.winner))}</b> – Bomben noch möglich!` +
          `<div class="closing-bar"><div style="width:100%;transition:width ${g.closing.ms}ms linear" id="cbar"></div></div>`);
      } else if (g.turn !== null) {
        parts.push(g.turn === me() ? '<b>Du bist am Zug.</b>' : `${esc(nameOf(g.turn))} ist am Zug.`);
      }
    } else if (g.phase === 'dragon') {
      parts.push(`${esc(nameOf(g.dragonWinner))} verschenkt den Drachen-Stich…`);
    } else if (g.phase === 'roundEnd') parts.push('Runde beendet.');
    else if (g.phase === 'gameOver') parts.push('Spiel beendet.');
    status.innerHTML = parts.join(' ');
    const bar = document.getElementById('cbar');
    if (bar) requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = '0%'; }));

    let html = '';
    if (g.trick) {
      const plays = g.trick.plays.slice(-4);
      html = plays.map((p, i) => {
        const old = i < plays.length - 1;
        return `<div class="play ${old ? 'old' : ''}"><div class="who">${esc(nameOf(p.seat))}${old ? '' : ' – ' + esc(p.desc)}</div>` +
          `<div class="cards">${p.cards.map(c => cardHTML(c)).join('')}</div></div>`;
      }).join('');
    } else if (g.lastTrick && g.phase === 'play') {
      const p = g.lastTrick.plays[g.lastTrick.plays.length - 1];
      html = `<div class="play last-trick"><div class="who">letzter Stich: ${esc(nameOf(p.seat))}</div>` +
        `<div class="cards">${p.cards.map(c => cardHTML(c)).join('')}</div></div>`;
    }
    trick.innerHTML = html;
  }

  function lobbyHTML() {
    const link = location.origin + '/?room=' + S.room;
    const slots = [0, 1, 2, 3].map(s => {
      const info = S.seats[s];
      const label = `Platz ${s + 1} · Team ${s % 2 === 0 ? 'A' : 'B'}`;
      let body, btns = '';
      if (info) {
        body = `<b>${esc(info.name)}</b>${info.bot ? ' 🤖' : ''}${s === me() ? ' (du)' : ''}${!info.online ? ' <span class="badge off">offline</span>' : ''}`;
        if (info.bot) btns = `<button class="small" data-act="removeBot" data-seat="${s}">Bot entfernen</button>`;
      } else {
        body = '<i>frei</i>';
        btns = `<button class="small" data-act="sit" data-seat="${s}">Hier sitzen</button>` +
          `<button class="small" data-act="addBot" data-seat="${s}">Bot hinzufügen</button>`;
      }
      return `<div class="slot"><span class="label">${label}</span><div>${body}</div><div class="btns">${btns}</div></div>`;
    });
    const full = S.seats.every(Boolean);
    const spect = S.spectators.length ? `<div class="hint">Zuschauer: ${S.spectators.map(esc).join(', ')}</div>` : '';
    return `<div class="lobby"><h2>Warteraum – Tisch ${esc(S.room)}</h2>` +
      `<div class="share"><input readonly value="${esc(link)}" onclick="this.select()"><button class="small" data-act="copy">Kopieren</button></div>` +
      `<div class="hint">Partner sitzen sich gegenüber: Plätze 1 & 3 gegen 2 & 4.</div>` +
      `<div class="seats">${slots[0]}${slots[1]}${slots[3]}${slots[2]}</div>${spect}` +
      `<button class="primary" data-act="start" ${full && me() !== null ? '' : 'disabled'}>Spiel starten</button>` +
      (!full ? '<div class="hint">Warte auf 4 Spieler (oder fülle mit Bots auf).</div>' : '') +
      `</div>`;
  }

  function selectedCards() {
    const hand = S.game && S.game.hand ? S.game.hand : [];
    return hand.filter(c => selected.has(c.id));
  }

  function renderActions() {
    const g = S.game;
    const el = $('#actions');
    if (!g || me() === null || !g.hand) { el.innerHTML = me() === null && g ? '<span class="hint">Du schaust zu.</span>' : ''; return; }
    const tichuBtn = g.canTichu ? '<button class="danger" data-act="tichu">Tichu!</button>' : '';
    const sortBtn = `<button class="small" data-act="sort" title="Sortierung">${sortBySuit ? '↕ Farbe' : '↕ Wert'}</button>`;

    if (g.phase === 'grand') {
      el.innerHTML = g.grandDecided[me()]
        ? `<span class="hint">Warte auf die anderen…</span> ${tichuBtn}`
        : '<button class="danger" data-act="grand1">Großes Tichu! (200)</button><button class="primary" data-act="grand0">Weiter – kein großes Tichu</button>';
      return;
    }
    if (g.phase === 'exchange') {
      if (g.myExchange) {
        el.innerHTML = `<span class="hint">Geschupft. Warte auf die anderen…</span> ${tichuBtn}`;
        return;
      }
      const L = (me() + 3) % 4, P = (me() + 2) % 4, R = (me() + 1) % 4;
      const slot = (k, seat, label) => {
        const id = exSlots[k];
        const card = id && g.hand.find(c => c.id === id);
        return `<div class="ex-slot"><div class="drop" data-slot="${k}">${card ? cardHTML(card) : ''}</div>${label}: ${esc(nameOf(seat))}</div>`;
      };
      const done = exSlots.left && exSlots.partner && exSlots.right;
      el.innerHTML = `<div class="ex-slots">${slot('left', L, 'Links')}${slot('partner', P, 'Partner')}${slot('right', R, 'Rechts')}</div>` +
        `<button class="primary" data-act="exchange" ${done ? '' : 'disabled'}>Schupfen</button>${tichuBtn}` +
        `<span class="hint">Karte anklicken → nächster freier Platz.</span>`;
      return;
    }
    if (g.phase === 'play') {
      const cards = selectedCards();
      const top = g.trick ? g.trick.top : null;
      const myTurn = g.turn === me() && !g.closing;
      const combo = cards.length ? T.analyze(cards, top) : null;
      let canPlay = false, hint = '', cls = '';
      if (cards.length) {
        if (!combo) { hint = 'Keine gültige Kombination'; cls = 'bad'; }
        else if (!T.beats(combo, top)) { hint = T.describe(combo) + ' – sticht nicht'; cls = 'bad'; }
        else if (!myTurn && !(T.isBomb(combo) && top)) { hint = T.describe(combo) + ' – nicht am Zug'; cls = 'bad'; }
        else if (combo.type === 'dog' && top) { hint = 'Hund nur beim Ausspielen'; cls = 'bad'; }
        else if (myTurn && g.mustFulfill && !T.containsRank(cards, g.wish)) { hint = `Du musst die ${T.rankLabel(g.wish)} spielen!`; cls = 'bad'; }
        else { hint = T.describe(combo); cls = 'good'; canPlay = true; }
      } else if (myTurn && g.mustFulfill) {
        hint = `Wunsch: Du musst eine ${T.rankLabel(g.wish)} spielen!`; cls = 'bad';
      } else if (myTurn) {
        hint = top ? 'Wähle Karten oder passe.' : 'Du spielst aus.';
      }
      const isBombPlay = canPlay && T.isBomb(combo) && !myTurn;
      const hasMJ = cards.some(c => c.special === 'mahjong');
      let wishSel = '';
      if (hasMJ && canPlay) {
        const opts = ['<option value="">kein Wunsch</option>'];
        for (let r = 2; r <= 14; r++) opts.push(`<option value="${r}" ${String(r) === wishValue ? 'selected' : ''}>${T.rankLabel(r)}</option>`);
        wishSel = `<label class="hint">Wunsch: <select id="wish-select">${opts.join('')}</select></label>`;
      }
      const canPass = myTurn && !!g.trick && !g.mustFulfill;
      el.innerHTML =
        `<button class="primary" data-act="play" ${canPlay ? '' : 'disabled'}>${isBombPlay ? '💣 Bombe!' : 'Spielen'}</button>` +
        `<button data-act="pass" ${canPass ? '' : 'disabled'}>Passen</button>${wishSel}${tichuBtn}${sortBtn}` +
        (hint ? `<span class="hint ${cls}">${esc(hint)}</span>` : '');
      return;
    }
    el.innerHTML = sortBtn;
  }

  function renderHand() {
    const g = S.game;
    const el = $('#hand');
    if (!g || !g.hand) { el.innerHTML = ''; return; }
    const inSlots = new Set(Object.values(exSlots).filter(Boolean));
    const receivedIds = new Set(g.received && g.phase === 'play' && g.hand.length === 14
      ?Object.values(g.received).map(c => c.id) : []);
    const waiting = !(g.phase === 'play' || (g.phase === 'exchange' && !g.myExchange));
    el.classList.toggle('waiting', waiting);
    el.innerHTML = sortedHand(g.hand).filter(c => !inSlots.has(c.id))
      .map(c => cardHTML(c, (selected.has(c.id) ? 'sel ' : '') + (receivedIds.has(c.id) ? 'new' : ''))).join('');
  }

  function renderLog() {
    const g = S.game;
    const entries = (g ? g.logs.map(l => ({ ts: l.ts, html: esc(l.text), chat: false })) : [])
      .concat(S.chat.map(c => ({ ts: c.ts, html: `<b>${esc(c.name)}:</b> ${esc(c.text)}`, chat: true })))
      .sort((a, b) => a.ts - b.ts).slice(-120);
    const log = $('#log');
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.innerHTML = entries.map(e => `<div class="entry ${e.chat ? 'chat' : ''}">${e.html}</div>`).join('');
    if (atBottom) log.scrollTop = log.scrollHeight;
  }

  function historyTable(g) {
    if (!g.history.length) return '<p class="hint">Noch keine Runde gespielt.</p>';
    return `<table><tr><th>Runde</th><th>${esc(nameOf(0))} & ${esc(nameOf(2))}</th><th>${esc(nameOf(1))} & ${esc(nameOf(3))}</th></tr>` +
      g.history.map(h => `<tr><td>${h.round}</td><td>${h.total[0]} <small>(${h.scores[0]})</small></td><td>${h.total[1]} <small>(${h.scores[1]})</small></td></tr>`).join('') +
      '</table>';
  }

  function renderModal() {
    const g = S.game;
    let key = null, html = '';
    if (g && g.phase === 'dragon' && g.dragonWinner === me()) {
      key = 'dragon';
      const a = (me() + 1) % 4, b = (me() + 3) % 4;
      html = `<h2>🐉 Drachen-Stich verschenken</h2><p style="text-align:center">An welchen Gegner geht der Stich?</p>` +
        `<div class="btn-row"><button class="primary" data-act="dragon" data-seat="${b}">${esc(nameOf(b))} (links, ${g.counts[b]} Karten)</button>` +
        `<button class="primary" data-act="dragon" data-seat="${a}">${esc(nameOf(a))} (rechts, ${g.counts[a]} Karten)</button></div>`;
    } else if (g && (g.phase === 'roundEnd' || g.phase === 'gameOver') && g.result) {
      const r = g.result;
      const over = g.phase === 'gameOver';
      key = 'result' + g.round + (over ? 'o' : '') + (g.ready[me()] ? 'r' : '');
      const order = r.finished.map((s, i) => `${i + 1}. ${esc(nameOf(s))}`).join(', ');
      html = `<h2>${over ? '🏆 ' + esc(nameOf(g.winner)) + ' & ' + esc(nameOf(g.winner + 2)) + ' gewinnen!' : 'Runde ' + g.round + ' beendet'}</h2>` +
        `<table><tr><th></th><th>${esc(nameOf(0))} & ${esc(nameOf(2))}</th><th>${esc(nameOf(1))} & ${esc(nameOf(3))}</th></tr>` +
        `<tr><td>Karten</td><td>${r.cardPts[0]}</td><td>${r.cardPts[1]}</td></tr>` +
        `<tr><td>Tichu</td><td>${r.tichuPts[0]}</td><td>${r.tichuPts[1]}</td></tr>` +
        `<tr><th>Runde</th><th>${r.total[0]}</th><th>${r.total[1]}</th></tr>` +
        `<tr><th>Gesamt</th><th>${g.scores[0]}</th><th>${g.scores[1]}</th></tr></table>` +
        `<p class="hint">Reihenfolge: ${order}</p><ul class="notes">${r.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` +
        (me() === null ? '' : over
          ? '<div class="btn-row"><button class="primary" data-act="newGame">Zurück zum Warteraum</button></div>'
          : (g.ready[me()] ? '<p class="hint" style="text-align:center">Warte auf die anderen…</p>'
            : '<div class="btn-row"><button class="primary" data-act="ready">Nächste Runde</button></div>'));
    } else if (showHistory && g) {
      key = 'history' + g.history.length;
      html = `<h2>Punkteverlauf</h2>${historyTable(g)}<div class="btn-row"><button data-act="closeHistory">Schließen</button></div>`;
    }
    const ov = $('#overlay');
    if (!key) { ov.classList.add('hidden'); modalKey = null; return; }
    ov.classList.remove('hidden');
    if (key !== modalKey) { $('#modal').innerHTML = html; modalKey = key; }
  }

  // ---------- Eingaben ----------

  function onHandClick(id) {
    const g = S.game;
    if (!g || !g.hand) return;
    if (g.phase === 'exchange' && !g.myExchange) {
      const k = ['left', 'partner', 'right'].find(k => !exSlots[k]);
      if (k) exSlots[k] = id;
      render();
      return;
    }
    if (g.phase !== 'play') return;
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    render();
  }

  function onAction(act, el) {
    const g = S && S.game;
    switch (act) {
      case 'sit': send({ t: 'sit', seat: Number(el.dataset.seat) }); break;
      case 'addBot': send({ t: 'addBot', seat: Number(el.dataset.seat) }); break;
      case 'removeBot': send({ t: 'removeBot', seat: Number(el.dataset.seat) }); break;
      case 'start': send({ t: 'start' }); break;
      case 'copy': copyLink(); break;
      case 'grand1': if (confirm('Wirklich GROSSES TICHU ansagen? (±200 Punkte)')) send({ t: 'grand', call: true }); break;
      case 'grand0': send({ t: 'grand', call: false }); break;
      case 'tichu': if (confirm('Tichu ansagen? (±100 Punkte)')) send({ t: 'tichu' }); break;
      case 'exchange': send({ t: 'exchange', ex: exSlots }); break;
      case 'play': {
        const ids = [...selected];
        const hasMJ = selectedCards().some(c => c.special === 'mahjong');
        send({ t: 'play', ids, wish: hasMJ && wishValue ? Number(wishValue) : null });
        selected.clear();
        wishValue = '';
        break;
      }
      case 'pass': selected.clear(); send({ t: 'pass' }); break;
      case 'dragon': send({ t: 'dragon', to: Number(el.dataset.seat) }); break;
      case 'ready': send({ t: 'ready' }); break;
      case 'newGame': send({ t: 'newGame' }); break;
      case 'sort':
        sortBySuit = !sortBySuit;
        store.set('tichu.sortSuit', sortBySuit ? '1' : '0');
        render();
        break;
      case 'closeHistory': showHistory = false; render(); break;
    }
    void g;
  }

  function copyLink() {
    const link = location.origin + '/?room=' + room;
    if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => toast('Link kopiert: ' + link), () => prompt('Link:', link));
    else prompt('Link:', link);
  }

  document.addEventListener('click', ev => {
    const card = ev.target.closest('#hand .card');
    if (card) return onHandClick(card.dataset.id);
    const drop = ev.target.closest('.drop[data-slot]');
    if (drop) { exSlots[drop.dataset.slot] = null; render(); return; }
    const btn = ev.target.closest('[data-act]');
    if (btn && !btn.disabled) onAction(btn.dataset.act, btn);
  });

  document.addEventListener('change', ev => {
    if (ev.target.id === 'wish-select') wishValue = ev.target.value;
  });

  // Rechtsklick/Doppelklick auf Hand = Auswahl leeren
  $('#hand').addEventListener('contextmenu', ev => { ev.preventDefault(); selected.clear(); render(); });

  document.addEventListener('keydown', ev => {
    if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT') return;
    if (ev.key === 'Enter') { const b = document.querySelector('[data-act="play"]'); if (b && !b.disabled) b.click(); }
    if (ev.key === ' ') { ev.preventDefault(); const b = document.querySelector('[data-act="pass"]'); if (b && !b.disabled) b.click(); }
    if (ev.key === 'Escape') { selected.clear(); render(); }
  });

  $('#create-btn').onclick = () => startJoin('');
  $('#join-btn').onclick = () => {
    const code = $('#room-input').value.trim().toUpperCase();
    if (!code) { toast('Bitte Tisch-Code eingeben.'); return; }
    startJoin(code);
  };
  $('#room-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('#join-btn').click(); });
  $('#name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') ($('#room-input').value.trim() ? $('#join-btn') : $('#create-btn')).click();
  });
  $('#copy-link').onclick = copyLink;
  $('#side-toggle').onclick = () => $('#side').classList.toggle('open');
  $('#history-btn').onclick = () => { showHistory = !showHistory; if (S) render(); };
  $('#chat-form').onsubmit = ev => {
    ev.preventDefault();
    const input = $('#chat-input');
    if (input.value.trim()) send({ t: 'chat', text: input.value });
    input.value = '';
  };

  // Start: Name & Tisch aus URL/Speicher übernehmen
  const params = new URLSearchParams(location.search);
  const savedName = store.get('tichu.name');
  if (savedName) $('#name-input').value = savedName;
  const urlRoom = (params.get('room') || '').toUpperCase();
  if (urlRoom) {
    $('#room-input').value = urlRoom;
    // Bekannter Tisch mit gespeichertem Namen: direkt wieder einsteigen
    if (savedName && store.get('tichu.token.' + urlRoom)) room = urlRoom;
  }
  connect();
})();
