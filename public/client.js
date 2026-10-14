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
  let exActive = null;      // gewähltes Schupf-Feld (Spieler)
  let exPick = null;        // gewählte Karte fürs Schupfen
  let bigHand = store.get('tichu.bigHand') === '1';
  let timerEnd = null, warned = false;
  let wishValue = '';
  let sortBySuit = store.get('tichu.sortSuit') === '1';
  let sortDesc = store.get('tichu.sortDesc') === '1';
  let grayOut = store.get('tichu.grayOut') !== '0';   // unspielbare Karten ausgrauen
  let bombChoice = false;                              // Auswahl bei mehreren Bomben offen
  let receivedTimer = null;
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
        const prev = S && S.game;
        S = msg.state;
        playSounds(prev, S.game);
        if (prev && prev.phase === 'exchange' && S.game && S.game.phase === 'play' && S.game.received) showReceived(S.game.received);
        const newEnd = S.timer ? Date.now() + S.timer.ms : null;
        if (!newEnd || !timerEnd || Math.abs(newEnd - timerEnd) > 1500) warned = false;
        timerEnd = newEnd;
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

  let newSettings = null; // nur beim Erstellen eines Tisches
  function sendJoin() {
    send({ t: 'join', room, name: store.get('tichu.name') || 'Spieler', token: store.get('tichu.token.' + room), settings: newSettings });
    newSettings = null;
  }

  function startJoin(code) {
    const name = $('#name-input').value.trim();
    if (!name) { toast('Bitte gib deinen Namen ein.'); $('#name-input').focus(); return; }
    store.set('tichu.name', name);
    room = code;
    if (!code) {
      newSettings = {
        target: Number(document.querySelector('input[name=target]:checked').value),
        timeLimit: document.querySelector('input[name=timelimit]:checked').value === '1',
      };
      store.set('tichu.settings', JSON.stringify(newSettings));
    }
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

  // Klänge passend zu Spielereignissen
  function playSounds(p, g) {
    if (!p || !g || p.round !== g.round) return;
    const total = x => x.counts.reduce((a, b) => a + b, 0);
    if (g.tichu.some((t, s) => t && !p.tichu[s])) Sfx.play('tichu');
    if (total(g) < total(p) && g.phase !== 'exchange') {
      const top = g.trick && g.trick.top;
      const last = !g.trick && g.lastTrick && g.lastTrick.plays[g.lastTrick.plays.length - 1];
      if (last && last.cards.some(c => c.special === 'dog')) Sfx.play('dog');
      else if (top && (top.type === 'bomb4' || top.type === 'bombSF')) Sfx.play('bomb');
      else if (top && top.type === 'single' && top.rank === 15) Sfx.play('dragon');
      else Sfx.play('play');
    }
    const passes = x => (x.trick && x.trick.passed ? x.trick.passed.filter(Boolean).length : 0);
    if (g.trick && p.trick && g.trick.plays.length === p.trick.plays.length && passes(g) > passes(p)) Sfx.play('pass');
    if (p.trick && !g.trick && g.phase === 'play' && total(g) === total(p)) Sfx.play('collect');
    if ((g.phase === 'roundEnd' || g.phase === 'gameOver') && p.phase !== g.phase) Sfx.play('roundEnd');
  }

  const SUIT_SYM = { jade: '◆', sword: '⚔', pagoda: '▲', star: '★' };

  function cardHTML(c, extra) {
    return CardArt.cardHTML(c, extra);
  }

  const me = () => (S && S.you !== null ? S.you : null);
  const base = () => (me() !== null ? me() : 0);
  const posOf = seat => ['bottom', 'right', 'top', 'left'][(seat - base() + 4) % 4];
  const nameOf = seat => (S.seats[seat] ? S.seats[seat].name : `Platz ${seat + 1}`);
  const team = seat => seat % 2;

  function sortedHand(hand) {
    const list = sortHand(hand);
    return sortDesc ? list.slice().reverse() : list;
  }

  function sortHand(hand) {
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
    if (!g || g.phase !== 'exchange' || (g.myExchange)) { exSlots = { left: null, partner: null, right: null }; exActive = null; exPick = null; }
    if (exPick && !handIds.has(exPick)) exPick = null;
    for (const k in exSlots) if (exSlots[k] && !handIds.has(exSlots[k])) exSlots[k] = null;

    renderScore();
    renderTopbar();
    renderSeats();
    renderCenter();
    renderActions();
    renderHand();
    renderLog();
    renderModal();

    const myTurn = g && g.phase === 'play' && g.turn === me() && me() !== null;
    if (myTurn && !wasMyTurn) Sfx.play('turn');
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
    const st = S.settings || {};
    $('#settings-info').textContent = `bis ${st.target || 1000}` + (st.timeLimit ? ' · ⏱ 30 s' : '');
  }

  function renderTopbar() {
    const g = S.game;
    const active = g && ['grand', 'exchange', 'play', 'dragon'].includes(g.phase);
    $('#pause-btn').classList.toggle('hidden', !(active && me() !== null && !S.paused));
    $('#menu').innerHTML =
      `<div class="menu-row"><span>Sortierung</span><div class="seg">` +
      `<button class="small ${!sortBySuit ? 'on' : ''}" data-act="sortVal">Wert</button>` +
      `<button class="small ${sortBySuit ? 'on' : ''}" data-act="sortSuit">Farbe</button></div></div>` +
      `<div class="menu-row"><span>Reihenfolge</span><div class="seg">` +
      `<button class="small ${!sortDesc ? 'on' : ''}" data-act="sortAsc">↑ aufsteigend</button>` +
      `<button class="small ${sortDesc ? 'on' : ''}" data-act="sortDesc">↓ absteigend</button></div></div>` +
      `<div class="menu-row"><span>Handkarten</span><div class="seg">` +
      `<button class="small ${!bigHand ? 'on' : ''}" data-act="handSmall">Normal</button>` +
      `<button class="small ${bigHand ? 'on' : ''}" data-act="handBig">Groß</button></div></div>` +
      `<div class="menu-note">„Groß“: Karussell mit großen Karten zum Durchwischen.</div>` +
      `<div class="menu-row"><span>Unspielbare Karten</span><div class="seg">` +
      `<button class="small ${grayOut ? 'on' : ''}" data-act="grayOn">grau</button>` +
      `<button class="small ${!grayOut ? 'on' : ''}" data-act="grayOff">normal</button></div></div>` +
      `<div class="menu-row"><span>Kartendesign</span><div class="seg">` +
      `<button class="small ${CardArt.style === 'modern' ? 'on' : ''}" data-act="styleModern">Modern</button>` +
      `<button class="small ${CardArt.style === 'classic' ? 'on' : ''}" data-act="styleClassic">Klassisch</button></div></div>` +
      `<div class="menu-row"><span>Töne</span><div class="seg">` +
      `<button class="small ${!Sfx.muted ? 'on' : ''}" data-act="soundOn">an</button>` +
      `<button class="small ${Sfx.muted ? 'on' : ''}" data-act="soundOff">aus</button></div></div>`;
  }

  // Kleiner Kartenfächer mit der Anzahl der Handkarten
  function fanHTML(n) {
    if (!n) return '<div class="fan empty"><span class="fan-count">0</span></div>';
    const step = 7; // fester Winkel pro Karte: der Fächer wächst mit der Anzahl
    let backs = '';
    for (let i = 0; i < n; i++) {
      const a = (i - (n - 1) / 2) * step;
      backs += `<div class="back" style="transform:translateX(-50%) rotate(${a.toFixed(1)}deg)"></div>`;
    }
    return `<div class="fan" title="${n} Karten">${backs}<span class="fan-count">${n}</span></div>`;
  }

  // Wer muss gerade handeln?
  function actingSeat(g) {
    if (g.phase === 'play' && !g.closing) return g.turn;
    if (g.phase === 'dragon') return g.dragonWinner;
    return null;
  }

  function renderSeats() {
    const g = S.game;
    const acting = g ? actingSeat(g) : null;
    for (let seat = 0; seat < 4; seat++) {
      const el = $('#seat-' + posOf(seat));
      const info = S.seats[seat];
      if (!g || g.phase === 'lobby') { el.classList.add('hidden'); continue; }
      el.classList.remove('hidden');
      const count = g.counts[seat];
      const badges = [];
      const isMe = seat === me();
      const passed = !!(g.trick && g.trick.passed && g.trick.passed[seat]);
      const leading = !!(g.trick && g.trick.lastSeat === seat);
      if (acting === seat) badges.push(`<span class="badge turn-badge">${isMe ? 'DU BIST DRAN' : 'AM ZUG'} <span data-cd></span></span>`);
      if (leading) badges.push('<span class="badge lead">🃏 liegt vorne</span>');
      if (passed) badges.push('<span class="badge passed">✋ gepasst</span>');
      if (g.tichu[seat] === 'small') badges.push('<span class="badge tichu">TICHU</span>');
      if (g.tichu[seat] === 'grand') badges.push('<span class="badge grand">GROSSES TICHU</span>');
      const place = g.finished.indexOf(seat);
      if (place >= 0) badges.push(`<span class="badge place">${place + 1}. Platz</span>`);
      if (info && !info.online) badges.push('<span class="badge off">offline</span>');
      const meta = [];
      if (g.phase === 'grand') meta.push(g.grandDecided[seat] ? '✓ entschieden' : 'überlegt…');
      else if (g.phase === 'exchange') meta.push(g.exchanged[seat] ? '✓ geschupft' : 'schupft…');
      else if (g.phase === 'roundEnd') meta.push(g.ready[seat] || (info && info.bot) ? '✓ bereit' : 'wartet…');
      else if (isMe) meta.push(`${count} Karten`);
      meta.push(`Stiche: ${g.trickPoints[seat]} P.`);
      el.classList.toggle('turn', acting === seat);
      el.classList.toggle('passed', passed);
      el.classList.toggle('leading', leading);
      el.innerHTML =
        `<div class="name"><span class="team-dot team-${team(seat)}"></span>${esc(nameOf(seat))}${isMe ? ' (du)' : ''}${info && info.bot ? ' 🤖' : ''}</div>` +
        (badges.length ? `<div class="meta">${badges.join('')}</div>` : '') +
        (!isMe ? fanHTML(count) : '') +
        `<div class="meta">${meta.join(' · ')}</div>`;
    }
    // Pfeil zum Spieler, der am Zug ist
    const arrow = $('#turn-arrow');
    arrow.className = g && acting !== null && acting !== undefined ? 'at-' + posOf(acting) : 'hidden';
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
        parts.push(g.turn === me() ? '<b class="my-turn">Du bist am Zug!</b>' : `<b>${esc(nameOf(g.turn))}</b> ist am Zug.`);
      }
    } else if (g.phase === 'dragon') {
      parts.push(`${esc(nameOf(g.dragonWinner))} verschenkt den Drachen-Stich…`);
    } else if (g.phase === 'roundEnd') parts.push('Runde beendet.');
    else if (g.phase === 'gameOver') parts.push('Spiel beendet.');
    if (S.timer && (g.phase === 'grand' || g.phase === 'exchange')) parts.push('<span class="countdown-inline"><span data-cd></span></span>');
    status.innerHTML = parts.join(' ');
    const bar = document.getElementById('cbar');
    if (bar) requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = '0%'; }));

    let html = '';
    if (g.trick) {
      const plays = g.trick.plays.slice(-3);
      html = plays.map((p, i) => {
        const old = i < plays.length - 1;
        return `<div class="play p-${posOf(p.seat)} ${old ? 'old' : 'current'}" style="z-index:${i + 1}">` +
          `<div class="cards">${p.cards.map(c => cardHTML(c)).join('')}</div>` +
          (old ? '' : `<div class="desc">${esc(p.desc)}</div>`) + `</div>`;
      }).join('');
    } else if (g.lastTrick && g.phase === 'play') {
      const p = g.lastTrick.plays[g.lastTrick.plays.length - 1];
      html = `<div class="play p-${posOf(p.seat)} last-trick">` +
        `<div class="cards">${p.cards.map(c => cardHTML(c)).join('')}</div><div class="desc">letzter Stich</div></div>`;
    }
    trick.innerHTML = html;
  }

  function lobbyHTML() {
    const link = location.origin + '/?room=' + S.room;
    const st = S.settings || { target: 1000, timeLimit: false };
    const canEdit = me() !== null;
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
    const seg = (key, val, options) => `<div class="seg">${options.map(([v, l]) =>
      `<button class="small ${String(val) === String(v) ? 'on' : ''}" data-act="setting" data-key="${key}" data-val="${v}" ${canEdit ? '' : 'disabled'}>${l}</button>`).join('')}</div>`;
    const full = S.seats.every(Boolean);
    const spect = S.spectators.length ? `<div class="hint">Zuschauer: ${S.spectators.map(esc).join(', ')}</div>` : '';
    return `<div class="lobby"><h2>Warteraum – Tisch ${esc(S.room)}</h2>` +
      `<div class="share"><input readonly value="${esc(link)}" onclick="this.select()"><button class="small" data-act="copy">Kopieren</button></div>` +
      `<div class="lobby-opts"><div class="opt-row"><span>Spiel bis</span>${seg('target', st.target, [[500, '500'], [1000, '1000']])}</div>` +
      `<div class="opt-row"><span>Zeitlimit</span>${seg('timeLimit', st.timeLimit ? 1 : 0, [[0, 'ohne'], [1, '30 s pro Zug']])}</div></div>` +
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

  // Fenster: was die anderen mir geschupft haben (5 Sekunden)
  function showReceived(rec) {
    const L = (me() + 3) % 4, P = (me() + 2) % 4, R = (me() + 1) % 4;
    const item = (seat, label) => rec[seat]
      ? `<div class="rec-item">${cardHTML(rec[seat])}<span>${label}</span><b>${esc(nameOf(seat))}</b></div>` : '';
    const el = $('#received');
    el.innerHTML = `<div class="rec-title">Geschupft bekommen</div><div class="rec-cards">${item(L, 'von links')}${item(P, 'vom Partner')}${item(R, 'von rechts')}</div><div class="rec-bar"><div></div></div>`;
    el.classList.remove('hidden');
    requestAnimationFrame(() => requestAnimationFrame(() => { const b = el.querySelector('.rec-bar div'); if (b) b.style.width = '0%'; }));
    clearTimeout(receivedTimer);
    receivedTimer = setTimeout(() => el.classList.add('hidden'), 5000);
  }

  // Karten, die in mindestens einem gültigen Zug vorkommen (null = alle spielbar)
  let playCache = { key: null, ids: null };
  function playableIds(g) {
    const myTurn = g.phase === 'play' && g.turn === me() && !g.closing;
    if (!myTurn) return null;
    const top = g.trick ? g.trick.top : null;
    if (!top && !g.mustFulfill) return null;
    const key = g.hand.map(c => c.id).join() + '|' + JSON.stringify(top) + '|' + (g.mustFulfill ? g.wish : '');
    if (playCache.key !== key) {
      const ids = new Set();
      for (const p of T.legalPlays(g.hand, top, g.mustFulfill ? g.wish : null)) p.cards.forEach(c => ids.add(c.id));
      playCache = { key, ids };
    }
    return playCache.ids;
  }

  // Bomben auf der Hand und welche davon gerade spielbar sind
  let bombAllCache = { key: null, list: [] };
  function bombInfo(g) {
    const handKey = g.hand.map(c => c.id).join();
    if (bombAllCache.key !== handKey) {
      const seen = new Set(), list = [];
      for (const p of T.legalPlays(g.hand, null).filter(p => T.isBomb(p.combo))) {
        const d = T.describe(p.combo);
        if (!seen.has(d)) { seen.add(d); list.push(p); }
      }
      list.sort((a, b) => (T.beats(a.combo, b.combo) ? 1 : -1));
      bombAllCache = { key: handKey, list };
    }
    const all = bombAllCache.list;
    const top = g.trick ? g.trick.top : null;
    const myTurn = g.turn === me() && !g.closing;
    let playable = [];
    if (g.phase === 'play' && (myTurn || top)) {
      playable = all.filter(p => T.beats(p.combo, top));
      if (myTurn && g.mustFulfill) playable = playable.filter(p => T.containsRank(p.cards, g.wish));
    }
    return { all, playable };
  }

  function playBomb(p) {
    bombChoice = false;
    selected.clear();
    send({ t: 'play', ids: p.cards.map(c => c.id), wish: null });
  }

  function renderActions() {
    const g = S.game;
    const el = $('#actions');
    if (!g || me() === null || !g.hand) { el.innerHTML = me() === null && g ? '<span class="hint">Du schaust zu.</span>' : ''; return; }
    const tichuBtn = g.canTichu ? '<button class="danger" data-act="tichu">Tichu!</button>' : '';
    const handBtn = '', sortBtn = '';

    if (g.phase === 'grand') {
      el.innerHTML = g.grandDecided[me()]
        ? `<span class="hint">Warte auf die anderen…</span> ${tichuBtn}${handBtn}`
        : `<button class="danger" data-act="grand1">Großes Tichu! (200)</button><button class="primary" data-act="grand0">Weiter – kein großes Tichu</button>${handBtn}`;
      return;
    }
    if (g.phase === 'exchange') {
      if (g.myExchange) {
        el.innerHTML = `<span class="hint">Geschupft. Warte auf die anderen…</span> ${tichuBtn}${handBtn}`;
        return;
      }
      const L = (me() + 3) % 4, P = (me() + 2) % 4, R = (me() + 1) % 4;
      const seatOf = { left: L, partner: P, right: R };
      const slot = (k, label) => {
        const id = exSlots[k];
        const card = id && g.hand.find(c => c.id === id);
        return `<div class="ex-slot ${exActive === k ? 'active' : ''}" data-slot="${k}"><div class="drop">${card ? cardHTML(card) : '<span class="plus">+</span>'}</div>` +
          `<span class="ex-label">${label}</span><b>${esc(nameOf(seatOf[k]))}</b></div>`;
      };
      const done = exSlots.left && exSlots.partner && exSlots.right;
      let hint = 'Tippe zuerst auf einen Spieler oder auf eine Karte – die Reihenfolge bestimmst du.';
      if (exActive) hint = `Wähle jetzt die Karte für ${nameOf(seatOf[exActive])}.`;
      else if (exPick) hint = 'Wähle jetzt den Spieler, der diese Karte bekommt.';
      else if (done) hint = 'Alles verteilt. Zum Ändern auf eine Karte im Feld tippen.';
      el.innerHTML = `<div class="ex-slots">${slot('left', 'Links')}${slot('partner', 'Partner')}${slot('right', 'Rechts')}</div>` +
        `<div class="ex-side"><button class="primary" data-act="exchange" ${done ? '' : 'disabled'}>Schupfen</button>${tichuBtn}${handBtn}</div>` +
        `<span class="hint ex-hint">${esc(hint)}</span>`;
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
        hint = top ? '' : 'Du spielst aus.';
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
      const bombs = bombInfo(g);
      if (!bombs.playable.length) bombChoice = false;
      const bombBtn = bombs.all.length
        ? `<button class="bomb-btn" data-act="bomb" ${bombs.playable.length ? '' : 'disabled'} title="Bombe spielen">💣 Bombe</button>` : '';
      let sub = `${wishSel}<span class="hint ${cls}">${esc(hint)}</span>`;
      if (bombChoice) {
        sub = bombs.playable.map((b, i) => `<button class="small bomb-btn" data-act="bombPick" data-i="${i}">💣 ${esc(T.describe(b.combo))}</button>`).join('') +
          '<button class="small" data-act="bombCancel">✕</button>';
      }
      el.innerHTML =
        `<div class="act-row"><div class="act-slot">${tichuBtn}</div>` +
        `<button class="primary act-main" data-act="play" ${canPlay ? '' : 'disabled'}>${isBombPlay ? '💣 Bombe!' : 'Spielen'}</button>` +
        `<button class="act-main" data-act="pass" ${canPass ? '' : 'disabled'}>Passen</button>` +
        `<div class="act-slot">${bombBtn}</div></div>` +
        `<div class="act-sub">${sub}</div>`;
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
    el.classList.toggle('big', bigHand);
    const scroll = el.scrollLeft;
    const isSel = id => (g.phase === 'exchange' ? exPick === id : selected.has(id));
    // Große Ansicht: ausgewählte Karten liegen in einer eigenen Reihe über dem Karussell
    const picked = bigHand ? sortedHand(g.hand).filter(c => !inSlots.has(c.id) && isSel(c.id)) : [];
    const tray = $('#hand-picked');
    tray.classList.toggle('hidden', !bigHand);
    tray.innerHTML = picked.length
      ? `<span class="tray-label">Ausgewählt:</span><div class="cards">${picked.map(c => cardHTML(c)).join('')}</div><span class="tray-label">antippen = zurück</span>`
      : '<span class="tray-label">Angetippte Karten erscheinen hier.</span>';
    const playable = grayOut ? playableIds(g) : null;
    const dim = id => (playable && !playable.has(id) ? ' unplayable' : '');
    el.innerHTML = sortedHand(g.hand).filter(c => !inSlots.has(c.id) && !(bigHand && isSel(c.id)))
      .map(c => cardHTML(c, (isSel(c.id) ? 'sel ' : '') + (receivedIds.has(c.id) ? 'new' : '') + dim(c.id))).join('');
    el.scrollLeft = scroll;
    const mini = $('#hand-mini');
    mini.classList.toggle('hidden', !bigHand);
    if (bigHand) {
      mini.innerHTML = sortedHand(g.hand).filter(c => !inSlots.has(c.id))
        .map(c => `<span class="chip ${c.special ? 'sp' : 's-' + c.suit} ${isSel(c.id) ? 'sel' : ''}${dim(c.id)}" data-jump="${c.id}">${chipLabel(c)}</span>`).join('');
    }
    carousel();
  }

  function chipLabel(c) {
    if (c.special) return { mahjong: '🐦1', dog: '🐕', phoenix: '🔥', dragon: '🐉' }[c.special];
    return T.rankLabel(c.rank) + SUIT_SYM[c.suit];
  }

  // Karte im Karussell in die Mitte holen
  function jumpTo(id) {
    const hand = $('#hand');
    const card = hand.querySelector(`.card[data-id="${id}"]`);
    if (!card) { onHandClick(id); return; } // ausgewählt -> zurücklegen
    hand.scrollTo({ left: card.offsetLeft - hand.clientWidth / 2 + card.offsetWidth / 2, behavior: 'smooth' });
  }

  // Karussell-Effekt: Karten in der Mitte groß, zum Rand hin kleiner
  function carousel() {
    const el = $('#hand');
    const cards = el.querySelectorAll('.card');
    if (!bigHand) { cards.forEach(c => c.style.removeProperty('--s')); return; }
    const box = el.getBoundingClientRect();
    const mid = box.left + box.width / 2;
    const visible = new Set();
    cards.forEach(c => {
      const r = c.getBoundingClientRect();
      const d = Math.min(1, Math.abs(r.left + r.width / 2 - mid) / (box.width / 2));
      c.style.setProperty('--s', (1 - 0.25 * d).toFixed(3));
      if (r.right > box.left + 8 && r.left < box.right - 8) visible.add(c.dataset.id);
    });
    document.querySelectorAll('#hand-mini .chip').forEach(ch => ch.classList.toggle('vis', visible.has(ch.dataset.jump)));
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
    if (g && S.paused) {
      key = 'paused';
      html = `<h2>⏸ Spiel pausiert</h2><p style="text-align:center">Pausiert von <b>${esc(S.paused.by)}</b>.</p>` +
        (me() !== null ? '<div class="btn-row"><button class="primary" data-act="resume">▶ Weiter spielen</button></div>' : '');
    } else if (g && g.phase === 'dragon' && g.dragonWinner === me()) {
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
      if (exActive) { exSlots[exActive] = id; exActive = null; exPick = null; }
      else exPick = exPick === id ? null : id;
      render();
      return;
    }
    if (g.phase !== 'play') return;
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    render();
  }

  function onSlotClick(k) {
    if (exPick) { exSlots[k] = exPick; exPick = null; exActive = null; }
    else if (exSlots[k]) { exSlots[k] = null; exActive = k; }
    else exActive = exActive === k ? null : k;
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
      case 'sortVal': case 'sortSuit':
        sortBySuit = act === 'sortSuit';
        store.set('tichu.sortSuit', sortBySuit ? '1' : '0');
        render();
        break;
      case 'sortAsc': case 'sortDesc':
        sortDesc = act === 'sortDesc';
        store.set('tichu.sortDesc', sortDesc ? '1' : '0');
        render();
        break;
      case 'handSmall': case 'handBig':
        bigHand = act === 'handBig';
        store.set('tichu.bigHand', bigHand ? '1' : '0');
        render();
        break;
      case 'grayOn': case 'grayOff':
        grayOut = act === 'grayOn';
        store.set('tichu.grayOut', grayOut ? '1' : '0');
        render();
        break;
      case 'bomb': {
        const b = bombInfo(S.game).playable;
        if (b.length === 1) playBomb(b[0]);
        else if (b.length > 1) { bombChoice = true; render(); }
        break;
      }
      case 'bombPick': {
        const b = bombInfo(S.game).playable[Number(el.dataset.i)];
        if (b) playBomb(b);
        break;
      }
      case 'bombCancel': bombChoice = false; render(); break;
      case 'styleModern': case 'styleClassic':
        CardArt.setStyle(act === 'styleClassic' ? 'classic' : 'modern');
        modalKey = null;
        render();
        break;
      case 'soundOn': case 'soundOff':
        Sfx.setMuted(act === 'soundOff');
        if (act === 'soundOn') Sfx.play('turn');
        render();
        break;
      case 'pause': send({ t: 'pause' }); break;
      case 'resume': send({ t: 'resume' }); break;
      case 'closeHistory': showHistory = false; render(); break;
      case 'setting': {
        const k = el.dataset.key, v = Number(el.dataset.val);
        send({ t: 'settings', settings: k === 'timeLimit' ? { timeLimit: !!v } : { [k]: v } });
        break;
      }
    }
    void g;
  }

  function copyLink() {
    const link = location.origin + '/?room=' + room;
    if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => toast('Link kopiert: ' + link), () => prompt('Link:', link));
    else prompt('Link:', link);
  }

  document.addEventListener('click', ev => {
    const card = ev.target.closest('#hand .card, #hand-picked .card');
    if (card) return onHandClick(card.dataset.id);
    if (ev.target.closest('#received')) { $('#received').classList.add('hidden'); return; }
    const chip = ev.target.closest('#hand-mini .chip');
    if (chip) { jumpTo(chip.dataset.jump); return; }
    const slot = ev.target.closest('.ex-slot[data-slot]');
    if (slot) { onSlotClick(slot.dataset.slot); return; }
    const btn = ev.target.closest('[data-act]');
    if (btn && !btn.disabled) onAction(btn.dataset.act, btn);
  });

  document.addEventListener('change', ev => {
    if (ev.target.id === 'wish-select') wishValue = ev.target.value;
  });

  $('#hand').addEventListener('scroll', () => requestAnimationFrame(carousel), { passive: true });
  (function dragScroll() {
    const hand = $('#hand');
    let drag = null, suppressClick = false, raf = null;
    hand.addEventListener('pointerdown', ev => {
      if (!bigHand || ev.pointerType === 'touch' || ev.button !== 0) return;
      cancelAnimationFrame(raf);
      drag = { x: ev.clientX, left: hand.scrollLeft, lastX: ev.clientX, lastT: performance.now(), v: 0, moved: false };
    });
    window.addEventListener('pointermove', ev => {
      if (!drag) return;
      const dx = ev.clientX - drag.x;
      if (Math.abs(dx) > 6) drag.moved = true;
      if (!drag.moved) return;
      hand.classList.add('dragging');
      hand.scrollLeft = drag.left - dx;
      const now = performance.now();
      drag.v = (ev.clientX - drag.lastX) / Math.max(1, now - drag.lastT);
      drag.lastX = ev.clientX; drag.lastT = now;
    });
    window.addEventListener('pointerup', () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      hand.classList.remove('dragging');
      if (!d.moved) return;
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 50);
      // Schwung auslaufen lassen
      let v = d.v * 16;
      const step = () => {
        if (Math.abs(v) < 0.5) return;
        hand.scrollLeft -= v;
        v *= 0.92;
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    });
    hand.addEventListener('click', ev => {
      if (suppressClick) { ev.stopPropagation(); ev.preventDefault(); }
    }, true);
  })();

  $('#hand').addEventListener('wheel', ev => {
    if (!bigHand || Math.abs(ev.deltaY) <= Math.abs(ev.deltaX)) return;
    ev.preventDefault();
    $('#hand').scrollLeft += ev.deltaY;
  }, { passive: false });
  window.addEventListener('resize', () => carousel());

  // Countdown für das Zeitlimit
  setInterval(() => {
    const left = timerEnd ? Math.max(0, Math.ceil((timerEnd - Date.now()) / 1000)) : null;
    document.querySelectorAll('[data-cd]').forEach(n => {
      n.textContent = left === null ? '' : '⏱ ' + left + ' s';
      n.classList.toggle('urgent', left !== null && left <= 10);
    });
    const g = S && S.game;
    const mine = g && me() !== null && ((g.phase === 'play' && g.turn === me() && !g.closing) ||
      (g.phase === 'dragon' && g.dragonWinner === me()) ||
      (g.phase === 'exchange' && !g.myExchange) || (g.phase === 'grand' && !g.grandDecided[me()]));
    if (mine && left !== null && left <= 10 && !warned) { warned = true; Sfx.play('warn'); toast('Noch 10 Sekunden!'); }
  }, 250);

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
  $('#menu-btn').onclick = ev => { ev.stopPropagation(); $('#menu').classList.toggle('hidden'); };
  document.addEventListener('click', ev => {
    if (!ev.target.closest('.menu-wrap')) $('#menu').classList.add('hidden');
  });
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
  try {
    const st = JSON.parse(store.get('tichu.settings') || 'null');
    if (st) {
      const t = document.querySelector(`input[name=target][value="${st.target}"]`); if (t) t.checked = true;
      const l = document.querySelector(`input[name=timelimit][value="${st.timeLimit ? 1 : 0}"]`); if (l) l.checked = true;
    }
  } catch (e) { /* egal */ }
  if (savedName) $('#name-input').value = savedName;
  const urlRoom = (params.get('room') || '').toUpperCase();
  if (urlRoom) {
    $('#room-input').value = urlRoom;
    // Bekannter Tisch mit gespeichertem Namen: direkt wieder einsteigen
    if (savedName && store.get('tichu.token.' + urlRoom)) room = urlRoom;
  }
  CardArt.installSprite();
  connect();
})();
