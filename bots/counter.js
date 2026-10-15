// Kartenzähler-Bot: merkt sich gespielte und geschupfte Karten, zerlegt die eigene Hand in
// möglichst wenige, starke Kombinationen und bewertet jeden Zug danach, wie sehr er die Hand
// verbessert und wie wahrscheinlich er den Stich gewinnt.
//
// Der Bot liest nur, was ein menschlicher Spieler am Tisch auch weiß: eigene Hand, gespielte
// Karten, Kartenzahlen, Ansagen, Wunsch und die selbst geschupften Karten.
const T = require('../public/tichu-core.js');
const { team } = require('../game.js');

// Stellschrauben (mit der Arena abgestimmt)
const P = {
  WIN_COST: 0.1,        // Kombination, die (außer durch Bomben) nicht zu schlagen ist
  BOMB_COST: -0.6,      // Bomben halten ist gut
  DOG_COST: 0.8,
  PH_SINGLE: 0.5,       // Phönix als Einzelkarte
  LEAD: 0.6,            // Wert, den Stich zu gewinnen und auszuspielen
  PTS: 0.02,            // Wert je Kartenpunkt im Stich
  PTS_GIVE: 0,          // Strafe je eigener Punktkarte, die wohl beim Gegner landet
  LEAD_LEN: 0.2,        // beim Ausspielen lange Kombinationen bevorzugen (je Karte)
  DOG_EARLY: 1,         // Hund früher ausspielen (Bonus auf die Sortierung)
  STOP_TICHU: 2.0,      // Gegner mit offener Tichu-Ansage stoppen
  STOP_LOW: 1.2,        // Gegner mit ≤ 2 Karten nicht ans Ausspiel lassen
  BOMB_USE: 1.6,        // Hemmschwelle für Bomben
  PARTNER_PEN: 3.0,     // Partner überstechen
  K_SINGLE: 8,          // Einzelkarte: ab wie vielen stechenden Karten sie praktisch verloren ist
  K_MULTI: 1.5,
  WEAK: 1.0,            // Zusatzkosten niedriger Ränge
  TICHU_P: 0.6,         // Tichu ab dieser geschätzten Wahrscheinlichkeit, zuerst rauszugehen
  GRAND_P: 0.5,         // dasselbe für das Große Tichu
};

// ---------- Kartenwissen ----------

const DECK = T.createDeck();

// legalPlays mit Zwischenspeicher (die Vorausberechnung im Such-Bot fragt dieselben Hände sehr
// oft ab). Gespeichert werden nur Masken und Kombinationen; die Karten kommen aus der Hand.
const playCache = new Map();
function legalPlays(hand, top, mustRank) {
  let key = '';
  for (const c of hand) key += c.id + ',';
  if (top) key += '|' + top.type + top.len + ':' + top.rank;
  if (mustRank) key += '!' + mustRank;
  let list = playCache.get(key);
  if (!list) {
    if (playCache.size > 50000) playCache.clear();
    list = T.legalPlays(hand, top, mustRank).map(p => ({ combo: p.combo, mask: p.mask }));
    playCache.set(key, list);
  }
  return list.map(({ combo, mask }) => {
    const cards = [];
    for (let i = 0; i < hand.length; i++) if (mask & (1 << i)) cards.push(hand[i]);
    return { cards, combo, mask };
  });
}

// Kann die Hand überhaupt eine Bombe enthalten? (Vierling oder 5 Karten einer Farbe)
function mayHaveBomb(hand) {
  const n = {};
  for (const c of hand) {
    if (c.special) continue;
    if ((n[c.rank] = (n[c.rank] || 0) + 1) === 4) return true;
    if ((n[c.suit] = (n[c.suit] || 0) + 1) === 5) return true;
  }
  return false;
}

function observe(game, seat) {
  const hand = game.hands[seat];
  const playedIds = new Set();
  for (const t of game.tricks) for (const c of t) playedIds.add(c.id);
  if (game.trick) for (const p of game.trick.plays) for (const c of p.cards) playedIds.add(c.id);
  const handIds = new Set(hand.map(c => c.id));
  // Selbst geschupfte Karten: Ort bekannt, solange sie nicht gespielt wurden
  const knownAt = new Map();
  const ex = game.exchange && game.exchange[seat];
  if (game.phase !== 'exchange' && ex) {
    const to = { right: (seat + 1) % 4, partner: (seat + 2) % 4, left: (seat + 3) % 4 };
    for (const k of ['right', 'partner', 'left']) if (!playedIds.has(ex[k].id)) knownAt.set(ex[k].id, to[k]);
  }
  const unseen = DECK.filter(c => !playedIds.has(c.id) && !handIds.has(c.id));
  const partner = (seat + 2) % 4;
  const opps = [(seat + 1) % 4, (seat + 3) % 4];
  const counts = game.hands.map(h => h.length);
  // Karten, die ein Gegner haben könnte
  const threats = unseen.filter(c => knownAt.get(c.id) !== partner);
  const unknown = unseen.filter(c => !knownAt.has(c.id));
  const knownOpp = unseen.filter(c => opps.includes(knownAt.get(c.id)));
  const oppUnknown = Math.max(0, opps.reduce((n, s) => n + counts[s], 0) - knownOpp.length);
  return { game, seat, hand, partner, opps, counts, unseen, threats, unknown, knownOpp, oppUnknown, knownAt };
}

function rankCounts(cards) {
  const cnt = new Array(16).fill(0);
  let ph = false, dr = false, mj = false;
  for (const c of cards) {
    if (c.special === 'phoenix') ph = true;
    else if (c.special === 'dragon') dr = true;
    else if (c.special === 'mahjong') mj = true;
    else if (!c.special) cnt[c.rank]++;
  }
  return { cnt, ph, dr, mj };
}

// Wie viele Möglichkeiten haben die Karten in cards (ohne Bomben), die Kombination zu schlagen?
// Einzelkarten: Anzahl stechender Karten; sonst: Anzahl höherer Ränge bzw. Straßenfenster.
function beatCount(combo, cards, rc) {
  if (T.isBomb(combo) || combo.type === 'dog') return 0;
  const { cnt, ph, dr, mj } = rc || rankCounts(cards);
  const r = combo.rank;
  let n = 0;
  switch (combo.type) {
    case 'single':
      if (r >= 15) return 0;
      n = (dr ? 1 : 0) + (ph ? 1 : 0);
      for (let x = Math.floor(r) + 1; x <= 14; x++) n += cnt[x];
      return n;
    case 'pair':
      for (let x = r + 1; x <= 14; x++) if (cnt[x] >= 2 || (cnt[x] && ph)) n++;
      return n;
    case 'triple':
    case 'fullhouse':
      for (let x = r + 1; x <= 14; x++) if (cnt[x] >= 3 || (cnt[x] >= 2 && ph)) n++;
      return n;
    case 'straight':
      for (let h = r + 1; h <= 14; h++) {
        const lo = h - combo.len + 1;
        if (lo < 1) continue;
        let miss = 0;
        for (let x = lo; x <= h; x++) if (!(x === 1 ? mj : cnt[x])) miss++;
        if (miss <= (ph ? 1 : 0)) n++;
      }
      return n;
    case 'pairs': {
      const k = combo.len / 2;
      for (let h = r + 1; h <= 14; h++) {
        const lo = h - k + 1;
        if (lo < 2) continue;
        let need = 0;
        for (let x = lo; x <= h; x++) need += Math.max(0, 2 - cnt[x]);
        if (need === 0 || (need === 1 && ph)) n++;
      }
      return n;
    }
  }
  return 1;
}

function canBeBeaten(combo, cards, rc) { return beatCount(combo, cards, rc) > 0; }

// ---------- Handbewertung: Zerlegung in Kombinationen ----------

// Kosten einer Kombination ≈ wie sehr sie ein „Verlierer“ ist, der ein eigenes Ausspiel braucht.
function comboCost(combo, rc) {
  if (T.isBomb(combo)) return P.BOMB_COST;
  if (combo.type === 'dog') return P.DOG_COST;
  if (combo.type === 'single' && combo.phoenix) return P.PH_SINGLE;
  const h = beatCount(combo, null, rc);
  if (!h) return P.WIN_COST;
  const r = Math.min(Math.max(combo.rank, 1), 14);
  const weak = (14 - r) / 13;
  const k = combo.type === 'single' ? P.K_SINGLE : P.K_MULTI;
  const lose = 1 - Math.exp(-h / k);
  const base = combo.len >= 5 ? 0.8 : 1.0;
  return P.WIN_COST + (base - P.WIN_COST) * lose + P.WEAK * weak;
}

// Bewertet Teilmengen der Hand: best(mask) = minimale Summe der Kombinationskosten.
function makeEval(hand, threats) {
  const n = hand.length;
  const rc = rankCounts(threats);
  const plays = legalPlays(hand, null);
  const byLow = Array.from({ length: n }, () => []);
  for (const p of plays) {
    p.cost = comboCost(p.combo, rc);
    byLow[31 - Math.clz32(p.mask & -p.mask)].push(p);
  }
  // nur erreichbare Teilmengen werden besucht – Map statt Tabelle mit 2^n Einträgen
  const memo = new Map([[0, 0]]);
  const pick = new Map();
  function best(mask) {
    const m = memo.get(mask);
    if (m !== undefined) return m;
    const low = 31 - Math.clz32(mask & -mask);
    let b = Infinity, bp = null;
    for (const p of byLow[low]) {
      if ((p.mask & mask) !== p.mask) continue;
      const v = p.cost + best(mask & ~p.mask);
      if (v < b) { b = v; bp = p; }
    }
    memo.set(mask, b);
    pick.set(mask, bp);
    return b;
  }
  function partition(mask) {
    const out = [];
    while (mask) { best(mask); const p = pick.get(mask); out.push(p); mask &= ~p.mask; }
    return out;
  }
  const full = n ? (1 << n) - 1 : 0;
  return { best, partition, full, rc, plays };
}

// Bitmaske einer Kartenauswahl in der Hand
function maskOf(hand, cards) {
  let m = 0;
  for (const c of cards) m |= 1 << hand.indexOf(c);
  return m;
}

// ---------- Ansagen ----------

function controlValue(p, rc) {
  const c = p.combo;
  if (T.isBomb(c)) return 1.5;
  if (c.type === 'single') {
    if (c.rank === 15) return 1;
    if (c.phoenix) return 0.8;
    if (c.rank === 14) return rc.dr || rc.ph ? 0.7 : 1;
    if (c.rank === 13) return 0.35;
    return 0;
  }
  if (!canBeBeaten(c, null, rc)) return 1;
  if ((c.type === 'pair' || c.type === 'triple') && c.rank >= 13) return 0.6;
  if (c.len >= 7) return 0.5;
  return 0;
}

// Merkmale einer vollen Hand (14 Karten) für die Tichu-Entscheidung
function tichuFeatures(hand, threats) {
  const ev = makeEval(hand, threats);
  const part = ev.partition(ev.full);
  let control = 0, combos = 0, lowSingles = 0, longCards = 0;
  for (const p of part) {
    control += controlValue(p, ev.rc);
    if (!T.isBomb(p.combo)) combos++;
    if (p.combo.type === 'single' && !p.cards[0].special && p.combo.rank <= 9) lowSingles++;
    if (p.cards.length >= 5) longCards += p.cards.length;
  }
  const has = sp => hand.some(c => c.special === sp) ? 1 : 0;
  return [
    ev.best(ev.full), combos, control, has('dragon'), has('phoenix'),
    hand.filter(c => !c.special && c.rank === 14).length,
    part.filter(p => T.isBomb(p.combo)).length, has('mahjong'), has('dog'), lowSingles, longCards,
  ];
}

// Merkmale der ersten 8 Karten für das Große Tichu
function grandFeatures(hand8) {
  const cnt = new Array(15).fill(0);
  for (const c of hand8) if (!c.special) cnt[c.rank]++;
  const has = sp => hand8.some(c => c.special === sp) ? 1 : 0;
  return [
    has('dragon'), has('phoenix'), cnt[14], cnt[13], cnt.filter(n => n === 4).length,
    cnt.filter((n, r) => n >= 2 && r >= 2).length, has('mahjong'), has('dog'),
    cnt.slice(2, 7).reduce((a, b) => a + b, 0),
  ];
}

// Logistische Modelle: P(zuerst raus) aus den Merkmalen. Gewichte mit arena/fit-tichu.js aus
// Selbstspiel-Daten gelernt (erste Zahl = Achsenabschnitt).
const TICHU_W = [1.4146, -0.6134, 0.215, 0.0002, 0.4672, 0.5564, 0.2941, -0.089, 0.4276, -1.2869, -0.027, -0.0488];
const GRAND_W = [-1.4253, 0.442, 0.9763, 0.3159, 0.1155, 0.6365, 0.0306, -0.2689, 0.1265, -0.0665];

function logistic(w, f) {
  let z = w[0];
  for (let i = 0; i < f.length; i++) z += w[i + 1] * f[i];
  return 1 / (1 + Math.exp(-z));
}

function wantsTichu(o) {
  const g = o.game;
  if (g.tichu[o.seat] || g.hasPlayed[o.seat] || g.tichu[o.partner]) return false;
  return logistic(TICHU_W, tichuFeatures(o.hand, o.threats)) >= P.TICHU_P;
}

function wantsGrand(hand8) {
  return logistic(GRAND_W, grandFeatures(hand8)) >= P.GRAND_P;
}

// ---------- Schupfen ----------

function chooseExchange(game, seat) {
  const hand = game.hands[seat].slice();
  const others = T.createDeck().filter(c => !hand.some(h => h.id === c.id));
  const partner = (seat + 2) % 4;
  const ev = makeEval(hand, others);
  const base = ev.best(ev.full);
  const damage = c => ev.best(ev.full & ~(1 << hand.indexOf(c))) - base;
  const taken = new Set();
  const free = () => hand.filter(c => !taken.has(c.id));

  // An die Gegner: Hund bzw. Karten, deren Verlust am wenigsten schadet
  const oppCard = () => {
    const pool = free().filter(c => c.special === 'dog' || (!c.special && c.rank <= 12));
    const list = pool.length ? pool : free().filter(c => c.special !== 'dragon' && c.special !== 'phoenix');
    const dog = list.find(c => c.special === 'dog');
    if (dog) return dog;
    list.sort((a, b) => damage(a) - damage(b) || a.rank - b.rank);
    return list[0];
  };
  const right = oppCard(); taken.add(right.id);
  const left = oppCard(); taken.add(left.id);

  // An den Partner
  let pc;
  const rest = free();
  if (game.tichu[partner] === 'grand' || game.tichu[partner] === 'small') {
    const order = c => c.special === 'dragon' ? 20 : c.special === 'phoenix' ? 19 : c.special ? 0 : c.rank;
    pc = rest.slice().sort((a, b) => order(b) - order(a))[0];
  } else if (game.tichu[seat] || wantsTichu({ game, seat, hand, partner, threats: others })) {
    pc = rest.filter(c => c.special !== 'dragon' && c.special !== 'phoenix')
      .sort((a, b) => damage(a) - damage(b) || a.rank - b.rank)[0];
  } else {
    const cand = rest.filter(c => !c.special);
    cand.sort((a, b) => (b.rank * 0.15 - damage(b)) - (a.rank * 0.15 - damage(a)));
    pc = cand[0] || rest.find(c => c.special !== 'dragon') || rest[0];
  }
  return { right: right.id, partner: pc.id, left: left.id };
}

// ---------- Spielen ----------

function activeOpps(o) { return o.opps.filter(s => o.counts[s] > 0); }

// Wahrscheinlichkeit, dass ein Zug den Stich gewinnt
function pWin(o, combo) {
  if (T.isBomb(combo)) return 0.97;
  const rc = rankCounts(o.threats);
  if (!canBeBeaten(combo, null, rc)) return 0.95;
  if (combo.type !== 'single') return 0.45;
  const beatsIt = c => c.special === 'dragon' || (c.special === 'phoenix' && combo.rank < 15) ||
    (!c.special && c.rank > combo.rank);
  if (o.knownOpp.some(beatsIt)) return 0.15;
  const h = o.unknown.filter(beatsIt).length;
  const U = o.unknown.length;
  let pNone = 1;
  for (let i = 0; i < h; i++) pNone *= Math.max(0, (U - o.oppUnknown - i) / (U - i));
  return 0.15 + 0.8 * pNone;
}

function dangerOf(o, s) {
  if (team(s) === team(o.seat) || o.counts[s] === 0) return 0;
  let d = 0;
  if (o.game.tichu[s]) d += P.STOP_TICHU;
  if (o.counts[s] <= 2) d += P.STOP_LOW;
  return d;
}

function partnerTichuOpen(o) {
  return !!o.game.tichu[o.partner] && o.counts[o.partner] > 0 && !o.game.finished.length;
}

function chooseWish(o, cards) {
  const own = new Set(o.hand.filter(c => !c.special && !cards.includes(c)).map(c => c.rank));
  // Bevorzugt: Wert, den ich dem nächsten Gegner geschupft habe
  for (const s of [(o.seat + 1) % 4, (o.seat + 3) % 4]) {
    for (const [id, at] of o.knownAt) {
      if (at !== s) continue;
      const c = o.unseen.find(x => x.id === id);
      if (c && !c.special && !own.has(c.rank)) return c.rank;
    }
  }
  const rc = rankCounts(o.unseen);
  for (let r = 14; r >= 2; r--) if (!own.has(r) && rc.cnt[r] > 0) return r;
  return undefined;
}

function playAction(o, p) {
  const a = { type: 'play', ids: p.cards.map(c => c.id) };
  if (p.cards.some(c => c.special === 'mahjong')) {
    const w = chooseWish(o, p.cards);
    if (w) a.wish = w;
  }
  return a;
}

function chooseLead(o, ev, plays) {
  const g = o.game;
  const part = ev.partition(ev.full);
  if (part.length === 1 && plays.some(p => p.mask === part[0].mask)) return part[0];

  const dog = plays.find(p => p.combo.type === 'dog');
  if (dog && o.counts[o.partner] > 0 && !g.tichu[o.seat] &&
      (partnerTichuOpen(o) || o.counts[o.partner] <= 2)) return dog;

  const legal = new Set(plays.map(p => p.mask));
  const cand = part.filter(p => legal.has(p.mask));
  if (!cand.length) {
    // Wunsch erzwingt etwas anderes: den Zug wählen, der die Hand am wenigsten verschlechtert
    return plays.slice().sort((a, b) => ev.best(ev.full & ~a.mask) - ev.best(ev.full & ~b.mask))[0];
  }

  // Gegner kurz vor dem Ausgehen: nichts ausspielen, womit er rausgehen könnte
  const opp = activeOpps(o);
  const safe = p => p.cost <= P.WIN_COST || T.isBomb(p.combo) || p.combo.type === 'dog' ||
    !opp.some(s => o.counts[s] === p.cards.length);

  const nonBomb = cand.filter(p => !T.isBomb(p.combo));
  const winners = nonBomb.filter(p => p.cost <= P.WIN_COST);
  const losers = nonBomb.filter(p => p.cost > P.WIN_COST);
  if (losers.length <= 1 && winners.length) {
    winners.sort((a, b) => b.cards.length - a.cards.length || a.combo.rank - b.combo.rank);
    return winners[0];
  }
  const pool = losers.length ? losers : cand;
  const key = p => p.cost - Math.max(0, T.sumPoints(p.cards)) * P.PTS_GIVE + P.LEAD_LEN * (p.cards.length - 1) +
    (p.combo.type === 'dog' ? P.DOG_EARLY : 0);
  pool.sort((a, b) => key(b) - key(a) || b.cards.length - a.cards.length);
  const s = pool.find(safe);
  if (s) return s;
  // Alles riskant: das Stärkste ausspielen
  return pool.slice().sort((a, b) => a.cost - b.cost)[0];
}

// Bewertung aller Folgezüge (Passen = 0)
function followValues(o, ev, plays) {
  const g = o.game;
  const top = g.trick.top;
  const owner = g.trick.lastSeat;
  const partnerOnTop = team(owner) === team(o.seat);
  const base = ev.best(ev.full);
  const pts = T.sumPoints(g.trick.plays.flatMap(p => p.cards));
  const danger = dangerOf(o, owner) + (activeOpps(o).some(s => o.counts[s] <= 2) ? 0.5 : 0);
  let gain = P.LEAD + pts * P.PTS + danger;
  if (g.tichu[o.seat] && o.counts[o.seat] > 0) gain += 0.5;
  if (partnerTichuOpen(o)) gain += 0.5;

  return plays.map(p => {
    const rest = ev.full & ~p.mask;
    let v;
    if (!rest) {
      v = partnerTichuOpen(o) ? -5 : 10;
    } else {
      const pw = pWin(o, p.combo), own = T.sumPoints(p.cards);
      v = base - ev.best(rest) + pw * (gain + own * P.PTS) - (1 - pw) * Math.max(0, own) * P.PTS_GIVE;
      if (T.isBomb(p.combo)) v -= P.BOMB_USE;
    }
    if (partnerOnTop && rest) v -= P.PARTNER_PEN;
    if (top.type === 'single' && top.rank === 15 && p.combo.type !== 'single') v += 0.5; // Drachenstich
    return v;
  });
}

function chooseFollow(o, ev, plays, must) {
  const vals = followValues(o, ev, plays);
  let bestP = null, bestV = must ? -Infinity : 0;
  plays.forEach((p, i) => { if (vals[i] > bestV) { bestV = vals[i]; bestP = p; } });
  return bestP;
}

// Bombe außer der Reihe, bevor ein Gegner den Stich bekommt
function chooseInterruptBomb(o) {
  const g = o.game;
  if (!g.closing || !g.trick) return null;
  const owner = g.trick.lastSeat;
  if (team(owner) === team(o.seat)) return null;
  if (!mayHaveBomb(o.hand)) return null;
  const bombs = legalPlays(o.hand, g.trick.top).filter(p => T.isBomb(p.combo));
  if (!bombs.length) return null;
  const ev = makeEval(o.hand, o.threats);
  const base = ev.best(ev.full);
  const pts = T.sumPoints(g.trick.plays.flatMap(p => p.cards));
  const gain = P.LEAD + pts * P.PTS + dangerOf(o, owner);
  let bestP = null, bestV = 0;
  for (const p of bombs) {
    const rest = ev.full & ~p.mask;
    const v = rest ? base - ev.best(rest) + 0.97 * gain - P.BOMB_USE : 10;
    if (v > bestV) { bestV = v; bestP = p; }
  }
  return bestP;
}

// Legale Züge und Handbewertung für einen Spieler am Zug
function prepare(game, seat, o = observe(game, seat)) {
  const top = game.trick ? game.trick.top : null;
  const must = game.mustFulfill(seat);
  const plays = legalPlays(o.hand, top, must ? game.wish : null).filter(p => !top || p.combo.type !== 'dog');
  const ev = plays.length ? makeEval(o.hand, o.threats) : null;
  if (ev) {
    const cost = new Map(ev.plays.map(q => [q.mask, q.cost]));
    for (const p of plays) p.cost = cost.get(p.mask) ?? 1;
  }
  return { o, top, must, plays, ev };
}

function choosePlay(game, seat) {
  const o = observe(game, seat);
  if (wantsTichu(o)) return { type: 'tichu' };
  const { top, must, plays, ev } = prepare(game, seat, o);
  if (!plays.length) return { type: 'pass' };
  const choice = top ? chooseFollow(o, ev, plays, must) : chooseLead(o, ev, plays);
  if (!choice) return { type: 'pass' };
  return playAction(o, choice);
}

// Alle Möglichkeiten am Zug, nach Vorliebe des Kartenzählers sortiert: der erste Eintrag ist
// seine eigene Wahl, null steht für Passen (nur wenn erlaubt). Für die Vorausberechnung.
function rankPlays(game, seat) {
  const { o, top, must, plays, ev } = prepare(game, seat);
  if (!plays.length) return { o, ranked: must ? [] : [null] };
  if (top) {
    const vals = followValues(o, ev, plays);
    // Passen vorne: bei Gleichstand gewinnt es wie in chooseFollow, sonst der erste Zug (stabil sortiert)
    const items = must ? [] : [{ p: null, v: 0 }];
    plays.forEach((p, i) => items.push({ p, v: vals[i] }));
    items.sort((a, b) => b.v - a.v);
    return { o, ranked: items.map(x => x.p) };
  }
  const first = chooseLead(o, ev, plays);
  const dmg = p => ev.best(ev.full & ~p.mask) + p.cost;
  const rest = plays.filter(p => p !== first).sort((a, b) => dmg(a) - dmg(b) || b.cards.length - a.cards.length);
  return { o, ranked: [first, ...rest] };
}

function chooseDragon(game, seat) {
  const opp = [(seat + 1) % 4, (seat + 3) % 4];
  const counts = game.hands.map(h => h.length);
  // An den Gegner, der am ehesten Letzter wird (seine Stiche gehen dann an den Ersten)
  opp.sort((a, b) => counts[b] - counts[a] || (game.tichu[a] ? 1 : 0) - (game.tichu[b] ? 1 : 0));
  return opp[0];
}

function decide(game, seat) {
  switch (game.phase) {
    case 'grand':
      return game.grandDecided[seat] ? null : { type: 'grand', call: !game.tichu[(seat + 2) % 4] && wantsGrand(game.hands[seat]) };
    case 'exchange':
      return game.exchange[seat] ? null : { type: 'exchange', ex: chooseExchange(game, seat) };
    case 'dragon':
      return game.dragonPending && game.dragonPending.winner === seat ? { type: 'dragon', to: chooseDragon(game, seat) } : null;
    case 'play': {
      if (game.hands[seat].length === 0) return null;
      if (game.closing) {
        const o = observe(game, seat);
        const b = chooseInterruptBomb(o);
        return b ? playAction(o, b) : null;
      }
      if (game.turn !== seat) return null;
      return choosePlay(game, seat);
    }
  }
  return null;
}

module.exports = { decide, P, observe, rankPlays, playAction, wantsTichu, chooseDragon, makeEval, canBeBeaten, maskOf, tichuFeatures, grandFeatures, TICHU_W, GRAND_W };
