# 🐉 Tichu Online

Tichu für 4 Spieler im Browser – mit Raum-Code / Einladungslink, Bots zum Auffüllen und
allen Regeln nach der Fata-Morgana/Abacus-Anleitung.

## Starten (lokal)

```bash
npm install
npm start
```

Dann <http://localhost:3000> öffnen, Namen eingeben, **Neuen Tisch erstellen** und den Link an die
Mitspieler schicken. Freie Plätze können mit Bots gefüllt werden.

## Online mit Freunden spielen

Der Server muss für deine Freunde erreichbar sein. Drei einfache Möglichkeiten:

1. **Schnell & temporär – Tunnel** (dein PC ist der Server, solange er läuft):
   ```bash
   npx cloudflared tunnel --url http://localhost:3000
   ```
   Den ausgegebenen `https://….trycloudflare.com`-Link verschicken.
2. **Dauerhaft – kostenloses Hosting** z. B. bei [Render](https://render.com) (Web Service):
   Repository hochladen, Build-Befehl `npm install`, Start-Befehl `npm start`. Der Port wird über
   die Umgebungsvariable `PORT` automatisch übernommen. WebSockets werden unterstützt.
3. **Eigener Server / Raspberry Pi / Portweiterleitung:** `npm start` (optional `PORT=8080`),
   Port im Router freigeben.

## Bedienung

- Karten anklicken zum Auswählen, **Spielen** (Enter) oder **Passen** (Leertaste), Esc/Rechtsklick hebt die Auswahl auf.
- **Bomben** können jederzeit außer der Reihe gespielt werden – auch noch kurz nachdem dreimal
  gepasst wurde (Balken unter „Stich geht an …“).
- **Feste Tasten:** In der Spielphase stehen Tichu | Spielen | Passen | 💣 Bombe immer an derselben Stelle.
- **Bomben-Taste:** Sobald eine Bombe auf der Hand ist, erscheint „💣 Bombe“ – spielt sie direkt (auch außer der
  Reihe); bei mehreren passenden Bomben wählt man eine aus.
- **Partner liegt vorne:** Seine Karte ist blau markiert („🤝 Partner“); wer sie stechen würde, bekommt einen
  Warnhinweis.
- **Unspielbare Karten** werden ausgegraut, wenn man dran ist (im ⚙-Menü abschaltbar).
- **Geschupfte Karten** werden nach dem Schupfen 5 Sekunden lang angezeigt (von links / Partner / rechts).
- **Automatisches Überspringen:** Wer weniger Karten hat, als die liegende Kombination braucht, wird
  automatisch übersprungen – außer man hat noch mindestens 4 Karten (dann wäre eine Bombe denkbar).
- Beim Spielen des Mah Jong erscheint eine Auswahl für den **Wunsch**. Wer den gewünschten Wert
  regelkonform spielen kann (notfalls als Bombe), wird dazu gezwungen.
- **Tisch-Einstellungen** (beim Erstellen und im Warteraum änderbar): Spiel bis 500 oder 1000 Punkte,
  Zeitlimit ohne oder 30 s pro Zug (Schupfen 60 s). Läuft die Zeit ab, wird automatisch gepasst bzw. die
  niedrigste Karte gespielt; beim Schupfen werden Karten automatisch gewählt.
  Mischung „zufällig“ oder „fest“ mit einer Zahl: dieselbe Zahl ergibt wieder dieselben Blätter (zum Nachspielen).
- **Zug-Anzeige:** Ein goldener Pfeil zeigt auf den Spieler am Zug, dazu „AM ZUG“ mit Countdown.
  Gespielte Karten liegen in Richtung des Spielers, der sie gelegt hat. „🃏 liegt vorne“ markiert, wer die
  oberste Karte gespielt hat, „✋ gepasst“ wer im Stich schon gepasst hat.
- **Schupfen:** Reihenfolge frei wählbar – erst Spieler-Feld, dann Karte antippen oder umgekehrt.
  Antippen einer Karte im Feld legt sie zurück.
- **Ansicht (⚙ oben rechts):** Sortierung nach Wert oder Farbe, jeweils auf- oder absteigend; Handkarten „Normal“ oder „Groß“.
  „Groß“ macht die Hand zum Karussell mit großen Karten: wischen (Finger, Maus ziehen oder Mausrad).
  Ausgewählte Karten wandern in eine Auswahl-Reihe darüber und bleiben so immer sichtbar; auch die gespielten
  Karten in der Tischmitte werden größer;
  eine Mini-Übersicht zeigt alle Handkarten – antippen springt zur Karte.
- **Töne:** Klänge für Ausspielen, Passen, Bombe, Drache, Hund (echtes Bellen), Tichu, Stich, Rundenende und
  „Du bist dran“ – im ⚙-Menü abschaltbar. Dort lässt sich auch das Kartendesign wählen: „Modern“ oder „Klassisch“.
- **Pause (⏸ oben rechts):** hält das Spiel an – Bots und Zeitlimit warten, bis jemand „Weiter“ drückt.
- **Spiel abbrechen / neu starten (⚙-Menü):** startet eine Abstimmung. Alle *verbundenen* menschlichen Mitspieler
  müssen zustimmen (Bots und Offline-Spieler zählen nicht – allein mit Bots geht es sofort). Abbruch führt in den
  Warteraum, Neustart beginnt sofort wieder bei 0 : 0. Ein „Nein“ oder 60 s ohne Einigung beenden die Abstimmung.
- **Tisch verlassen (⚙-Menü):** Während des Spiels übernimmt ein Bot den Platz, die anderen spielen weiter.
- **Verbindungsabbruch:** Der Platz bleibt reserviert und zeigt „offline“. Seite neu laden (oder auf einem anderen
  Gerät mit demselben Namen beitreten) bringt einen zurück. Ohne Zeitlimit wartet das Spiel; mit Zeitlimit werden
  automatische Züge gemacht. Die anderen können mit „🤖 Bot einsetzen“ einen Bot einspringen lassen.
  Wer zurückkommt (oder nach dem Verlassen wieder beitritt), übernimmt seinen Platz wieder vom Bot.

## Regeln (umgesetzt)

- 56 Karten, Spielrichtung rechtsherum, Partner sitzen gegenüber.
- Großes Tichu nach 8 Karten (±200), kleines Tichu bis zur ersten eigenen Karte (±100).
- Kombinationen: Einzelkarte, Paar, Paarfolge, Drilling, Full House, Straße (≥5), Bomben
  (Vierling, Farbstraße ≥5; längere Farbstraße schlägt kürzere, Farbstraße schlägt Vierling).
- Mah Jong (1, Wunsch), Hund (Ausspiel an den Partner), Phönix (½ über der letzten Einzelkarte,
  Joker in Kombinationen, −25), Drache (höchste Einzelkarte, Stich wird an einen Gegner verschenkt, +25).
- Rundenende: Letzter gibt Handkarten an die Gegner, Stiche an den Ersten; Doppelsieg = 200.
- Spielende bei 1000 Punkten.

## Entwicklung

- `public/tichu-core.js` – Kombinationen und Regeln (Server und Browser)
- `public/sounds.js` – Spielklänge (Web Audio, keine Audiodateien)
- `public/card-art.js` – Kartendesign: SVG-Motive (Jade, Schwert, Pagode, Stern, Phönix, Drache, Hund, Mah Jong)
- `game.js` – Spielablauf, `bot.js` – Computerspieler (Such-Bot aus `bots/`; Vergleich mit `node arena/arena.js`), `server.js` – HTTP + WebSocket
- `TICHU_SEED=80 npm start` – feste Mischung als Standard für alle Tische (zum Testen)
- `npm test` – Regeltests + 30 simulierte Bot-Partien; `node test/e2e.js` / `node test/e2e-multi.js` – Tests über den echten Server (mit zwei Menschen: Abstimmung, Verbindungsabbruch, Bot-Ersatz)

### Bots und Arena

- `bots/counter.js` – **Kartenzähler**: merkt sich gespielte und geschupfte Karten, zerlegt
  die Hand in möglichst wenige starke Kombinationen und bewertet jeden Zug danach, wie sehr er die
  Hand verbessert und wie wahrscheinlich er den Stich gewinnt. Tichu/Großes Tichu über ein
  aus Selbstspiel gelerntes Modell (Wahrscheinlichkeit, zuerst rauszugehen). Sieht nur, was ein
  Mensch am Tisch auch weiß.
- `bots/search.js` – **Such-Bot** (Standard, Stufe 2): rechnet beim Ausspielen und Folgen voraus. Die
  unbekannten Karten werden mehrfach zufällig auf die anderen Spieler verteilt – passend zu
  Kartenzahlen, gespielten und selbst geschupften Karten und zu Wunsch-Zwängen (wer bei offenem
  Wunsch gepasst oder anders gespielt hat, konnte ihn nicht erfüllen). Für die besten Züge laut
  Kartenzähler plus Passen wird die Runde in jeder dieser Welten mit dem Kartenzähler zu Ende
  gespielt; gewählt wird der Zug mit dem besten durchschnittlichen Rundenergebnis fürs eigene Team.
  Ansagen, Schupfen, Drache und Bomben außer der Reihe übernimmt der Kartenzähler. Stellschrauben
  in `P`: `TOP` (Kandidaten), `WORLDS` (Verteilungen je Zug), `MS` (Zeitbudget je Zug, Standard
  300 ms), `MARGIN`. Sieht wie der Kartenzähler nur öffentliche Information plus die eigene Hand.
  Der Server verwendet den Such-Bot mit dem Standardbudget von 300 ms je Zug. Ein kürzeres
  Budget kostet deutlich Spielstärke: mit 150 ms nur noch +3,1 ± 4,7 statt +20,3 ± 4,7 Punkte je
  Runde gegen den Kartenzähler (200 Mischungen). Ob ein Bot gerade handeln will, prüft der Server
  vorab mit dem Kartenzähler (`bot.wantsToAct`), damit die Suche nur einmal je Zug läuft.
- `bots/simple.js` – der frühere einfache Bot (Vergleichsgegner).
- `bots/rule.js` – **Regel-Bot** wie die Vergleichsgegner in den Arbeiten von Müller (ETH 2020) und
  Wyss (Uni Bern 2024): sagt nie Tichu an, schupft die zwei niedrigsten Karten an die Gegner und die
  höchste an den Partner, spielt immer die niedrigste mögliche Kombination, beim Ausspielen die mit
  den meisten Karten. Grober Maßstab: search +99,5 ± 4,3, counter +72,7 ± 2,7, simple +25,7 ± 2,1
  Punkte je Runde gegen rule (veröffentlicht: Wyss' bester lernender Agent, PPO mit Behavioral
  Cloning, etwa +90 gegen seinen Regel-Bot; Regeln im Detail und Zielpunktzahl können abweichen).
- `node arena/arena.js --a counter --b simple --games 500` – Bot gegen Bot ohne Server. Jede Mischung
  wird zweimal mit getauschten Plätzen gespielt (Duplicate), Ausgabe: gewonnene Partien, Punkte je
  Runde mit Konfidenzintervall, Tichu-Quoten. Die Mischungen laufen parallel auf allen
  Prozessorkernen (`--jobs N` begrenzt, `--jobs 1` spielt alles nacheinander).
- `node arena/arena.js --a search --b counter --games 200` – Such-Bot gegen Kartenzähler
  (dauert einige Minuten). Stand: +21,3 ± 4,6 Punkte je Runde, 69 % der Partien gewonnen;
  Rechenzeit je Suchzug im Median ≈ 40 ms, höchstens ≈ 300 ms.
- Ausprobiert und verworfen (Stufe 3, Duplicate-Arena, 95-%-Intervalle; übernommen wird nur, was
  signifikant hilft):
  - *Weiche Inferenz* (Müller 2020): ausgedachte Verteilungen danach gewichten, wie wahrscheinlich die
    beobachteten Züge und Pässe der anderen unter dem Kartenzähler gewesen wären (Softmax über seine
    Zugbewertungen, Fehlerrate EPS). search mit gegen ohne Inferenz, 200 Mischungen: TAU 0,5/EPS 0,1
    +1,1 ± 5,0; schärfer (TAU 0,25/EPS 0,03, 16 Ereignisse) −11,8 ± 4,9. Das Modell „spielt wie der
    Kartenzähler“ ist für die anderen Spieler offenbar nicht genau genug.
  - *Initiativmodell* (Pfander 2013, Kap. 3.5): P(Kombination gewinnt den Stich) und P(wird spielbar)
    aus 40 000 Runden Selbstspiel, Kontext höchste unbekannte Karte und Stichnummer, als Ersatz bzw.
    Ergänzung der Kostenformel im Kartenzähler. counter gegen counter, 1000 Mischungen: P(Stich)
    statt Formel −2,1 ± 2,0; Initiative PInit − PAbwurf −5,5 ± 2,2; Mittel aus beidem −0,5 ± 2,0.
    Die bisherige Formel zählt die tatsächlich noch stechenden Karten und ist damit genauer als der
    grobe Kontext.
  - *Faustregeln* aus Strategietexten (Aaron Fuegi, scv.bu.edu; tichuonline.com), counter gegen
    counter, 1000 Mischungen: Großes Tichu immer mit Drache und Phönix +0,5 ± 2,1; Hund beim ersten
    Ausspiel +0,9 ± 2,0; schwache Hand schupft die beste Karte zum Partner −2,5 ± 2,1; höchsten
    fehlenden Wert wünschen −1,1 ± 2,0.
- `node arena/tune.js --b counter "LEAD=0.8" "WEAK=1.2"` – mehrere Einstellungen der Stellschrauben
  (`P` in `bots/counter.js`) parallel testen.
- `node arena/trace.js --seed 7` – eine Runde Zug für Zug mit allen Händen anzeigen.
- `node arena/fit-tichu.js` – Tichu-Modelle aus Selbstspiel neu lernen (Gewichte in `bots/counter.js` eintragen).

## Quellen

- Hundebellen: „dog bark 9“ von alexzavesa, freesound.org (Sound #853723) – Lizenz siehe Freesound-Seite.
