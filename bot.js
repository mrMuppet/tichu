// Computerspieler für den Server. Die Bots selbst liegen in bots/ und lassen sich mit
// arena/arena.js gegeneinander vergleichen.
//   search – Such-Bot (Standard), counter – Kartenzähler, simple – der frühere einfache Bot
const search = require('./bots/search.js');
const counter = require('./bots/counter.js');
const simple = require('./bots/simple.js');

// Zeitbudget wie in der Arena (300 ms): mit 150 ms schrumpft der Vorsprung vor dem Kartenzähler
// von +20 auf +3 Punkte je Runde, weil gerade die langen Züge früh in der Runde abgeschnitten werden.

module.exports = {
  decide: search.decide,
  // Schnelle Probe, ob ein Platz gerade handeln will: Der Such-Bot handelt genau dann, wenn der
  // Kartenzähler es tut (am Zug immer, sonst übernimmt er ohnehin dessen Entscheidung).
  // Die teure Suche läuft so nur einmal je Zug. Wunsch-Zwänge (öffentlich) merkt sich der
  // Such-Bot auch hier, damit ihm keine Pässe entgehen.
  wantsToAct: (game, seat) => {
    if (game.phase === 'play') search.wishConstraints(game);
    return counter.decide(game, seat);
  },
  // Automatischer Zug für Menschen bei abgelaufener Zeit: bewusst zurückhaltend (passen bzw. niedrigster Zug)
  timeoutAction: simple.timeoutAction,
};
