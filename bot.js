// Einfacher Computerspieler: wirft niedrige Karten ab, sticht den Partner nicht.
const T = require('./public/tichu-core.js');
const { team } = require('./game.js');

function hasPhoenix(cards) { return cards.some(c => c.special === 'phoenix'); }

// Liefert die nächste Aktion des Bots als { type, ... } oder null.
function decide(game, seat) {
  switch (game.phase) {
    case 'grand':
      return game.grandDecided[seat] ? null : { type: 'grand', call: false };
    case 'exchange':
      return game.exchange[seat] ? null : { type: 'exchange', ex: chooseExchange(game.hands[seat]) };
    case 'dragon':
      if (game.dragonPending && game.dragonPending.winner === seat) {
        // An den Gegner mit den meisten Handkarten verschenken
        const opp = [(seat + 1) % 4, (seat + 3) % 4];
        opp.sort((a, b) => game.hands[b].length - game.hands[a].length);
        return { type: 'dragon', to: opp[0] };
      }
      return null;
    case 'roundEnd':
      return null;
    case 'play':
      if (game.turn !== seat || game.closing) return null;
      return choosePlay(game, seat);
  }
  return null;
}

function chooseExchange(hand) {
  const normals = T.sortCards(hand.filter(c => !c.special));
  const specials = hand.filter(c => c.special);
  // Hund an einen Gegner, sonst die niedrigsten Karten
  const pool = specials.filter(c => c.special === 'dog').concat(normals);
  const right = pool[0];
  const left = pool[1];
  const rest = hand.filter(c => c !== right && c !== left && c.special !== 'dragon' && c.special !== 'phoenix');
  const best = T.sortCards(rest).pop() || hand.find(c => c !== right && c !== left);
  return { right: right.id, partner: best.id, left: left.id };
}

function choosePlay(game, seat) {
  const hand = game.hands[seat];
  const top = game.trick ? game.trick.top : null;
  const must = game.mustFulfill(seat);
  let plays = T.legalPlays(hand, top, must ? game.wish : null);
  if (!plays.length) return { type: 'pass' };

  if (top && !must) {
    // Partner liegt vorne -> passen
    if (team(game.trick.lastSeat) === team(seat)) return { type: 'pass' };
  }

  const nonBombs = plays.filter(p => !T.isBomb(p.combo));
  const opponentsLow = [(seat + 1) % 4, (seat + 3) % 4].some(s => game.hands[s].length > 0 && game.hands[s].length <= 2);
  let pool = nonBombs;
  if (!pool.length) {
    // Nur Bomben möglich: nur werfen, wenn ein Gegner fast fertig ist (oder Wunsch erzwingt)
    if (!must && !opponentsLow && top) return { type: 'pass' };
    pool = plays;
  }

  const score = p => {
    let s = p.combo.rank;
    if (!top) s -= p.cards.length * 1.2;          // beim Ausspielen viele Karten loswerden
    if (hasPhoenix(p.cards) && p.cards.length > 1) s += 6;
    if (p.combo.phoenix) s += 8;
    if (p.combo.type === 'dog') s = game.hands[(seat + 2) % 4].length ? -5 : 20;
    if (T.isBomb(p.combo)) s += 50;
    return s;
  };

  // Beim Folgen auf hohe Karten nicht unnötig verschwenden
  if (top && top.type === 'single' && !opponentsLow) {
    const cheap = pool.filter(p => p.combo.rank < 14 || hand.length <= 3);
    if (cheap.length) pool = cheap;
    else if (!must && Math.random() < 0.5) return { type: 'pass' };
  }

  pool.sort((a, b) => score(a) - score(b));
  const choice = pool[0];
  const action = { type: 'play', ids: choice.cards.map(c => c.id) };
  if (choice.cards.some(c => c.special === 'mahjong')) {
    const own = new Set(hand.filter(c => !c.special).map(c => c.rank));
    const candidates = [];
    for (let r = 2; r <= 14; r++) if (!own.has(r)) candidates.push(r);
    if (candidates.length) action.wish = candidates[Math.floor(Math.random() * candidates.length)];
  }
  return action;
}

module.exports = { decide };
