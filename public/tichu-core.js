// Gemeinsame Tichu-Logik für Server (Node) und Browser.
(function (root) {
  'use strict';

  const SUITS = ['jade', 'sword', 'pagoda', 'star'];
  const RANK_LABEL = { 1: '1', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

  function createDeck() {
    const deck = [];
    for (const suit of SUITS) {
      for (let rank = 2; rank <= 14; rank++) deck.push({ id: suit + '-' + rank, suit, rank });
    }
    deck.push({ id: 'mahjong', special: 'mahjong', rank: 1 });
    deck.push({ id: 'dog', special: 'dog', rank: 0 });
    deck.push({ id: 'phoenix', special: 'phoenix', rank: 0 });
    deck.push({ id: 'dragon', special: 'dragon', rank: 15 });
    return deck;
  }

  function cardPoints(card) {
    if (card.special === 'dragon') return 25;
    if (card.special === 'phoenix') return -25;
    if (card.special) return 0;
    if (card.rank === 5) return 5;
    if (card.rank === 10 || card.rank === 13) return 10;
    return 0;
  }

  function sumPoints(cards) {
    return cards.reduce((s, c) => s + cardPoints(c), 0);
  }

  // Sortierwert für die Handanzeige
  function sortValue(card) {
    if (card.special === 'dog') return 0;
    if (card.special === 'mahjong') return 1;
    if (card.special === 'phoenix') return 14.5;
    if (card.special === 'dragon') return 16;
    return card.rank;
  }

  function sortCards(cards) {
    return cards.slice().sort((a, b) => sortValue(a) - sortValue(b) || (a.suit || '').localeCompare(b.suit || ''));
  }

  function rankLabel(rank) {
    return RANK_LABEL[rank] || String(rank);
  }

  // Höchster Wert einer Straße oder null. ranks darf die 1 (Mah Jong) enthalten.
  function straightHigh(ranks, phoenix) {
    const s = ranks.slice().sort((a, b) => a - b);
    for (let i = 1; i < s.length; i++) if (s[i] === s[i - 1]) return null;
    const lo = s[0], hi = s[s.length - 1];
    const gaps = hi - lo + 1 - s.length;
    if (!phoenix) return gaps === 0 ? hi : null;
    if (gaps === 1) return hi;
    if (gaps === 0) {
      if (hi < 14) return hi + 1;   // Phönix verlängert nach oben
      if (lo - 1 >= 2) return hi;   // ...oder nach unten
    }
    return null;
  }

  function isConsecutive(sorted) {
    for (let i = 1; i < sorted.length; i++) if (sorted[i] !== sorted[i - 1] + 1) return false;
    return true;
  }

  /**
   * Bestimmt die Kombination der Karten. top = aktuell oben liegende Kombination
   * (nötig für den Wert des Phönix als Einzelkarte).
   * Rückgabe: { type, rank, len } oder null.
   * Typen: single, pair, triple, fullhouse, straight, pairs, bomb4, bombSF, dog
   */
  function analyze(cards, top) {
    const n = cards.length;
    if (n === 0) return null;

    if (n === 1) {
      const c = cards[0];
      if (c.special === 'dog') return { type: 'dog', rank: 0, len: 1 };
      if (c.special === 'phoenix') {
        if (top && top.type === 'single') {
          if (top.rank >= 15) return null; // nicht auf den Drachen
          return { type: 'single', rank: top.rank + 0.5, len: 1, phoenix: true };
        }
        return { type: 'single', rank: 1.5, len: 1, phoenix: true };
      }
      return { type: 'single', rank: c.rank, len: 1 };
    }

    if (cards.some(c => c.special === 'dog' || c.special === 'dragon')) return null;
    const phoenix = cards.some(c => c.special === 'phoenix');
    const mahjong = cards.some(c => c.special === 'mahjong');
    const normals = cards.filter(c => !c.special);
    const ranks = normals.map(c => c.rank);
    const counts = {};
    for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
    const distinct = Object.keys(counts).map(Number).sort((a, b) => a - b);
    const max = distinct[distinct.length - 1];

    // Bomben (ohne Phönix / Mah Jong)
    if (!phoenix && !mahjong) {
      if (n === 4 && distinct.length === 1) return { type: 'bomb4', rank: distinct[0], len: 4 };
      if (n >= 5 && distinct.length === n && isConsecutive(distinct) &&
          normals.every(c => c.suit === normals[0].suit)) {
        return { type: 'bombSF', rank: max, len: n };
      }
    }

    if (n >= 5) {
      const high = straightHigh(mahjong ? [1].concat(ranks) : ranks, phoenix);
      if (high) return { type: 'straight', rank: high, len: n };
    }
    if (mahjong) return null;

    if (n === 2) {
      if (phoenix ? normals.length === 1 : distinct.length === 1) return { type: 'pair', rank: distinct[0], len: 2 };
      return null;
    }
    if (n === 3) {
      if (distinct.length === 1) return { type: 'triple', rank: distinct[0], len: 3 };
      return null;
    }
    if (n === 5 && distinct.length === 2) {
      const [a, b] = distinct;
      if (!phoenix) {
        if (counts[a] === 3 && counts[b] === 2) return { type: 'fullhouse', rank: a, len: 5 };
        if (counts[b] === 3 && counts[a] === 2) return { type: 'fullhouse', rank: b, len: 5 };
      } else {
        if (counts[a] === 2 && counts[b] === 2) return { type: 'fullhouse', rank: b, len: 5 };
        if (counts[a] === 3 && counts[b] === 1) return { type: 'fullhouse', rank: a, len: 5 };
        if (counts[b] === 3 && counts[a] === 1) return { type: 'fullhouse', rank: b, len: 5 };
      }
    }
    if (n >= 4 && n % 2 === 0) {
      const k = n / 2;
      if (distinct.length === k && isConsecutive(distinct) && distinct.every(r => counts[r] <= 2)) {
        const singles = distinct.filter(r => counts[r] === 1).length;
        if (singles === (phoenix ? 1 : 0)) return { type: 'pairs', rank: max, len: n };
      }
    }
    return null;
  }

  function isBomb(combo) {
    return !!combo && (combo.type === 'bomb4' || combo.type === 'bombSF');
  }

  function bombValue(combo) {
    return combo.type === 'bombSF' ? 100 * combo.len + combo.rank : combo.rank;
  }

  function beats(combo, top) {
    if (!combo) return false;
    if (!top) return true;
    if (combo.type === 'dog') return false;
    const cb = isBomb(combo), tb = isBomb(top);
    if (cb && tb) return bombValue(combo) > bombValue(top);
    if (cb) return true;
    if (tb) return false;
    return combo.type === top.type && combo.len === top.len && combo.rank > top.rank;
  }

  function containsRank(cards, rank) {
    return cards.some(c => !c.special && c.rank === rank);
  }

  /**
   * Alle spielbaren Kombinationen aus der Hand (auf top), optional nur solche,
   * die eine echte Karte des Rangs mustRank enthalten.
   */
  function legalPlays(hand, top, mustRank) {
    const n = hand.length;
    const out = [];
    const wishIdx = mustRank ? hand.map((c, i) => (!c.special && c.rank === mustRank ? i : -1)).filter(i => i >= 0) : null;
    if (wishIdx && wishIdx.length === 0) return out;
    for (let mask = 1; mask < (1 << n); mask++) {
      if (wishIdx && !wishIdx.some(i => mask & (1 << i))) continue;
      let size = 0;
      for (let m = mask; m; m &= m - 1) size++;
      if (top && size !== top.len && size < 4) continue;
      const cards = [];
      for (let i = 0; i < n; i++) if (mask & (1 << i)) cards.push(hand[i]);
      const combo = analyze(cards, top);
      if (combo && beats(combo, top)) out.push({ cards, combo });
    }
    return out;
  }

  // Muss der Spieler den Wunsch erfüllen?
  function mustFulfillWish(hand, top, wish) {
    if (!wish || !containsRank(hand, wish)) return false;
    if (!top) return true;
    return legalPlays(hand, top, wish).length > 0;
  }

  const TYPE_NAMES = {
    single: 'Einzelkarte', pair: 'Paar', triple: 'Drilling', fullhouse: 'Full House',
    straight: 'Straße', pairs: 'Paarfolge', bomb4: 'Bombe (Vierling)', bombSF: 'Bombe (Farbstraße)', dog: 'Hund'
  };

  function describe(combo) {
    if (!combo) return '';
    let name = TYPE_NAMES[combo.type] || combo.type;
    if (combo.type === 'dog') return name;
    if (combo.type === 'single') {
      if (combo.rank === 15) return 'Drache';
      if (combo.phoenix) return 'Phönix';
      if (combo.rank === 1) return 'Mah Jong';
      return name + ' ' + rankLabel(combo.rank);
    }
    if (combo.type === 'straight' || combo.type === 'pairs' || combo.type === 'bombSF') {
      return name + ' (' + combo.len + ' Karten, bis ' + rankLabel(combo.rank) + ')';
    }
    return name + ' ' + rankLabel(combo.rank);
  }

  const api = {
    SUITS, createDeck, cardPoints, sumPoints, sortCards, sortValue, rankLabel,
    analyze, beats, isBomb, legalPlays, mustFulfillWish, containsRank, describe
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Tichu = api;
})(typeof window !== 'undefined' ? window : this);
