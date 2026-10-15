// Regel-Bot nach den Vergleichsgegnern aus Müller (ETH 2020) und Wyss (Uni Bern 2024):
// sagt nie Tichu an, schupft die zwei niedrigsten Karten an die Gegner und die höchste an den
// Partner, spielt immer die niedrigste mögliche Kombination und beim Ausspielen die mit den
// meisten Karten. Dient nur als grober Maßstab für die Arena.
const T = require('../public/tichu-core.js');

// Rangfolge der Karten fürs Schupfen (Hund ganz unten, Drache ganz oben)
const ORDER = c => c.special === 'dog' ? 0 : c.special === 'mahjong' ? 1 :
  c.special === 'phoenix' ? 15.5 : c.special === 'dragon' ? 16 : c.rank;

function chooseExchange(hand) {
  const s = hand.slice().sort((a, b) => ORDER(a) - ORDER(b));
  return { right: s[0].id, left: s[1].id, partner: s[s.length - 1].id };
}

function choosePlay(game, seat) {
  const top = game.trick ? game.trick.top : null;
  const must = game.mustFulfill(seat);
  const plays = T.legalPlays(game.hands[seat], top, must ? game.wish : null)
    .filter(p => !top || p.combo.type !== 'dog');
  if (!plays.length) return { type: 'pass' };
  // Bomben nur, wenn nichts anderes geht; sonst niedrigste Kombination,
  // beim Ausspielen zuerst die mit den meisten Karten
  const key = p => (T.isBomb(p.combo) ? 1e4 : 0) - (top ? 0 : 100 * p.cards.length) + p.combo.rank;
  plays.sort((a, b) => key(a) - key(b));
  return { type: 'play', ids: plays[0].cards.map(c => c.id) };
}

function decide(game, seat) {
  switch (game.phase) {
    case 'grand':
      return game.grandDecided[seat] ? null : { type: 'grand', call: false };
    case 'exchange':
      return game.exchange[seat] ? null : { type: 'exchange', ex: chooseExchange(game.hands[seat]) };
    case 'dragon':
      return game.dragonPending && game.dragonPending.winner === seat ? { type: 'dragon', to: (seat + 1) % 4 } : null;
    case 'play':
      if (game.turn !== seat || game.closing || game.hands[seat].length === 0) return null;
      return choosePlay(game, seat);
  }
  return null;
}

module.exports = { decide };
