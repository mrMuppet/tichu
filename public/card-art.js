// Kartengestaltung: SVG-Motive (einmal als Sprite eingebunden) und Karten-HTML.
(function () {
  'use strict';

  const r1 = n => Math.round(n * 10) / 10;

  // Facettierter Stern: 10 Dreiecke um die Mitte, abwechselnd hell/dunkel
  function starSymbol() {
    const cx = 50, cy = 53, R = 44, r = 18;
    const pt = (rad, deg) => [cx + rad * Math.cos(deg * Math.PI / 180), cy + rad * Math.sin(deg * Math.PI / 180)];
    const pts = [];
    for (let k = 0; k < 10; k++) pts.push(pt(k % 2 ? r : R, -90 + k * 36));
    let tri = '';
    for (let k = 0; k < 10; k++) {
      const a = pts[k], b = pts[(k + 1) % 10];
      tri += `<path d="M${cx} ${cy}L${r1(a[0])} ${r1(a[1])}L${r1(b[0])} ${r1(b[1])}Z" fill="currentColor" fill-opacity="${k % 2 ? 0.62 : 1}"/>`;
    }
    const outline = pts.map(p => r1(p[0]) + ' ' + r1(p[1])).join(' ');
    return `<symbol id="ic-star" viewBox="0 0 100 100">${tri}<polygon points="${outline}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></symbol>`;
  }

  // Phönix: Vogel mit nach oben ausgebreiteten Flammenflügeln und Schweiffedern
  function phoenixSymbol() {
    let wings = '';
    for (const side of [-1, 1]) {
      const sx = 50 + side * 5, sy = 46;              // Schulter
      for (let i = 0; i < 8; i++) {
        const t = i / 7;                               // 0 = innen oben, 1 = außen unten
        const ex = 50 + side * (14 + 32 * Math.sin(t * Math.PI * 0.55));
        const ey = 8 + 52 * t * t;
        const cx = 50 + side * (6 + 30 * t);
        const cy = sy - 8 - 18 * (1 - t);
        wings += `<path d="M${sx} ${sy}Q${r1(cx)} ${r1(cy)} ${r1(ex)} ${r1(ey)}"/>`;
        // Flammenspitze leicht eingerollt
        wings += `<path d="M${r1(ex)} ${r1(ey)}q${side * 3} 2 ${side * 1} 6" stroke-opacity=".7"/>`;
      }
    }
    let tail = '';
    for (let i = -2; i <= 2; i++) {
      const ex = 50 + i * 11, ey = 94 - Math.abs(i) * 4;
      tail += `<path d="M50 62C${50 + i * 2} 72 ${50 + i * 9} 76 ${ex} ${ey}"/>`;
      tail += `<path d="M${ex} ${ey}q${i >= 0 ? -4 : 4} -2 ${i >= 0 ? -3 : 3} -7" stroke-opacity=".7"/>`;
    }
    return `<symbol id="ic-phoenix" viewBox="0 0 100 100"><g fill="none" stroke="url(#gr-fire)" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">` +
      wings + tail +
      // Körper
      `<path d="M50 34C56 40 57 52 50 64C43 52 44 40 50 34Z" fill="url(#gr-fire)" stroke-width="1.2"/>` +
      // Hals und Kopf mit Schnabel
      `<path d="M50 36C47 30 48 24 52 21C55 19 58 21 58 24L63 25L58 27C57 30 54 31 52 33" fill="url(#gr-fire)" stroke-width="1.2"/>` +
      // Federkrone
      `<path d="M52 20C50 15 52 11 55 9M54 20C55 15 59 13 62 13M50 22C46 18 46 14 48 11" stroke-width="1.6"/>` +
      `</g><circle cx="54.5" cy="23.5" r="1.2" fill="#2b2a2b"/></symbol>`;
  }

  const SYMBOLS = [
    // Jade: gruppierte Rauten als Umriss
    `<symbol id="ic-jade" viewBox="0 0 100 100"><g fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round">
      <path d="M50 12L64 26L50 40L36 26Z"/><path d="M27 35L41 49L27 63L13 49Z"/><path d="M73 35L87 49L73 63L59 49Z"/>
      <path d="M50 58L64 72L50 86L36 72Z"/><path d="M50 43L56 49L50 55L44 49Z" fill="currentColor"/></g></symbol>`,
    // Schwert
    `<symbol id="ic-sword" viewBox="0 0 100 100">
      <path d="M50 4L58 15V63H42V15Z" fill="currentColor"/><path d="M50 9V61" stroke="#000" stroke-opacity=".28" stroke-width="2"/>
      <path d="M50 4L58 15V63H50Z" fill="#000" fill-opacity=".14"/>
      <rect x="31" y="62" width="38" height="7" rx="3" fill="currentColor"/>
      <rect x="46" y="69" width="8" height="17" rx="2" fill="currentColor" fill-opacity=".8"/>
      <circle cx="50" cy="90" r="5.5" fill="none" stroke="currentColor" stroke-width="3"/></symbol>`,
    // Pagode
    `<symbol id="ic-pagoda" viewBox="0 0 100 100"><g fill="currentColor">
      <rect x="49" y="3" width="2" height="10"/><circle cx="50" cy="4" r="2.2"/>
      <path d="M26 25Q38 22 50 12Q62 22 74 25L71 28H29Z"/>
      <rect x="36" y="28" width="28" height="10"/>
      <path d="M18 48Q34 45 50 34Q66 45 82 48L78 52H22Z"/>
      <rect x="30" y="52" width="40" height="12"/>
      <path d="M10 72Q30 69 50 57Q70 69 90 72L85 76H15Z"/>
      <rect x="22" y="76" width="56" height="10"/>
      <rect x="14" y="86" width="72" height="5" rx="1"/></g>
      <g stroke="var(--card-bg, #234)" stroke-width="2.2">
      <path d="M42 30V38M50 30V38M58 30V38M37 54V64M45 54V64M55 54V64M63 54V64M30 78V86M40 78V86M50 78V86M60 78V86M70 78V86"/></g></symbol>`,
    starSymbol(),
    // Drache: geschwungener Körper mit Kopf, Hörnern und Krallen
    `<symbol id="ic-dragon" viewBox="0 0 100 100"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="M64 22C40 18 26 32 34 44C42 56 70 50 70 64C70 78 46 84 30 92" stroke-width="9"/>
      <path d="M64 22C40 18 26 32 34 44C42 56 70 50 70 64C70 78 46 84 30 92" stroke="#000" stroke-opacity=".25" stroke-width="2" stroke-dasharray="3 4"/>
      <path d="M44 20L41 13M36 26L30 21M30 38L23 37M44 50L42 57M60 50L64 44M73 60L80 58M70 74L77 78M56 84L58 91M41 89L40 96" stroke-width="2.5"/>
      <path d="M28 52L18 56L22 60M20 56L14 54M74 34L84 30L82 36" stroke-width="2.2"/></g>
      <path d="M60 14L74 13L84 20L76 23L80 28L70 27L62 30Z" fill="currentColor"/>
      <path d="M66 14L64 5M71 13L74 4M80 20L92 24M78 25L88 32" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <circle cx="72" cy="18" r="1.6" fill="#1e2742"/></symbol>`,
    // Hund im Origami-Stil
    `<symbol id="ic-dog" viewBox="0 0 100 100">
      <polygon points="14,24 22,34 31,46 26,49 17,38" fill="#a87443"/>
      <polygon points="27,45 66,43 69,63 30,64" fill="#b9854f"/>
      <polygon points="27,45 48,44 30,64" fill="#a87443"/>
      <polygon points="48,44 66,43 69,63" fill="#c8955c"/>
      <polygon points="66,43 77,38 75,63 69,63" fill="#d9a46b"/>
      <polygon points="70,46 73,26 80,21 79,40" fill="#c8955c"/>
      <polygon points="80,21 89,29 95,34 86,38 79,40" fill="#e0b07a"/>
      <polygon points="73,26 75,12 81,22" fill="#8a5c33"/>
      <polygon points="95,34 97,37 90,38" fill="#3a2a1c"/>
      <polygon points="68,62 75,62 74,86 70,86" fill="#a87443"/>
      <polygon points="61,63 67,63 66,86 62,86" fill="#8a5c33"/>
      <polygon points="30,62 38,64 36,86 31,86" fill="#a87443"/>
      <polygon points="38,63 45,64 43,86 39,86" fill="#8a5c33"/>
      <circle cx="84" cy="28" r="1.3" fill="#3a2a1c"/></symbol>`,
    phoenixSymbol(),
    // Mah Jong: Schriftzeichen „Spatz“
    `<symbol id="ic-mahjong" viewBox="0 0 100 100">
      <text x="50" y="62" text-anchor="middle" font-size="58" fill="currentColor" font-family="'Noto Serif SC','Songti SC','SimSun','Microsoft YaHei',serif">雀</text>
      <text x="50" y="86" text-anchor="middle" font-size="11.5" letter-spacing="1.5" fill="currentColor" font-family="Jost, system-ui, sans-serif" font-weight="500">MAH JONG</text></symbol>`,
    // kleines Spatz-Symbol für den Index
    `<symbol id="ic-sparrow" viewBox="0 0 100 100"><g fill="currentColor">
      <path d="M20 58C20 38 40 28 60 34C70 26 84 30 88 38C78 36 74 40 72 46C70 66 48 76 30 70L12 80L22 64Z"/>
      </g><circle cx="74" cy="38" r="3" fill="#16295a"/></symbol>`,
    // Pfote für den Hund
    `<symbol id="ic-paw" viewBox="0 0 100 100"><g fill="currentColor">
      <ellipse cx="50" cy="66" rx="22" ry="18"/><ellipse cx="24" cy="40" rx="9" ry="12"/><ellipse cx="41" cy="26" rx="9" ry="12"/>
      <ellipse cx="59" cy="26" rx="9" ry="12"/><ellipse cx="76" cy="40" rx="9" ry="12"/></g></symbol>`,
  ];

  const DEFS = `<defs><linearGradient id="gr-fire" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffd25a"/><stop offset=".55" stop-color="#ff8a2a"/><stop offset="1" stop-color="#e2461b"/></linearGradient></defs>`;

  function installSprite() {
    const div = document.createElement('div');
    div.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    div.setAttribute('aria-hidden', 'true');
    div.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${DEFS}${SYMBOLS.join('')}</svg>`;
    document.body.prepend(div);
  }

  const RANK = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const SPECIAL = {
    mahjong: { idx: '1', mini: 'sparrow', big: 'mahjong', name: 'Mah Jong' },
    dog: { idx: 'H', mini: 'paw', big: 'dog', name: 'Hund' },
    phoenix: { idx: 'P', mini: 'phoenix', big: 'phoenix', name: 'Phönix' },
    dragon: { idx: 'D', mini: 'dragon', big: 'dragon', name: 'Drache' },
  };
  const use = (id, cls) => `<svg class="${cls}" viewBox="0 0 100 100"><use href="#ic-${id}"/></svg>`;

  function cardHTML(c, extra) {
    extra = extra || '';
    let cls, label, mini, big, title;
    if (c.special) {
      const sp = SPECIAL[c.special];
      cls = 'sp-' + c.special; label = sp.idx; mini = sp.mini; big = sp.big; title = sp.name;
    } else {
      cls = 's-' + c.suit; label = RANK[c.rank] || String(c.rank); mini = big = c.suit; title = label;
    }
    const idx = `<span class="idx"><b>${label}</b>${use(mini, 'mi')}</span>`;
    return `<div class="card ${cls} ${extra}" data-id="${c.id}" title="${title}"><span class="frame"></span>` +
      idx + use(big, 'big') + idx.replace('class="idx"', 'class="idx idx2"') + `</div>`;
  }

  // Klassisches Design: helle Karten mit Unicode-Symbolen und Emojis
  const CLASSIC_SUIT = { jade: '◆', sword: '⚔', pagoda: '▲', star: '★' };
  const CLASSIC_SPECIAL = {
    mahjong: { sym: '🐦', r: '1', name: 'Mah Jong' },
    dog: { sym: '🐕', r: '', name: 'Hund' },
    phoenix: { sym: '🔥', r: '', name: 'Phönix' },
    dragon: { sym: '🐉', r: '', name: 'Drache' },
  };
  function classicCardHTML(c, extra) {
    extra = extra || '';
    if (c.special) {
      const sp = CLASSIC_SPECIAL[c.special];
      return `<div class="card classic sp-${c.special} ${extra}" data-id="${c.id}" title="${sp.name}">` +
        (sp.r ? `<span class="r">${sp.r}</span>` : '') +
        `<span class="sym">${sp.sym}</span><span class="sname">${sp.name}</span></div>`;
    }
    const r = RANK[c.rank] || String(c.rank);
    return `<div class="card classic s-${c.suit} ${extra}" data-id="${c.id}"><span class="r">${r}</span>` +
      `<span class="sym">${CLASSIC_SUIT[c.suit]}</span><span class="r2">${r}</span></div>`;
  }

  let style = 'modern';
  try { style = localStorage.getItem('tichu.cardStyle') || 'modern'; } catch (e) { /* egal */ }
  function setStyle(s) {
    style = s === 'classic' ? 'classic' : 'modern';
    try { localStorage.setItem('tichu.cardStyle', style); } catch (e) { /* egal */ }
    document.body.classList.toggle('cards-classic', style === 'classic');
  }

  window.CardArt = {
    installSprite() { installSprite(); setStyle(style); },
    cardHTML: (c, extra) => (style === 'classic' ? classicCardHTML(c, extra) : cardHTML(c, extra)),
    get style() { return style; },
    setStyle,
  };
})();
