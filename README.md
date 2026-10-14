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
  Ausgewählte Karten wandern in eine Auswahl-Reihe darüber und bleiben so immer sichtbar;
  eine Mini-Übersicht zeigt alle Handkarten – antippen springt zur Karte.
- **Töne:** Klänge für Ausspielen, Passen, Bombe, Drache, Hund (echtes Bellen), Tichu, Stich, Rundenende und
  „Du bist dran“ – im ⚙-Menü abschaltbar. Dort lässt sich auch das Kartendesign wählen: „Modern“ oder „Klassisch“.
- **Pause (⏸ oben rechts):** hält das Spiel an – Bots und Zeitlimit warten, bis jemand „Weiter“ drückt.
- Verbindungsabbruch? Einfach die Seite neu laden – man landet wieder auf seinem Platz
  (auch von einem anderen Gerät mit demselben Namen).

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
- `game.js` – Spielablauf, `bot.js` – einfacher Computerspieler, `server.js` – HTTP + WebSocket
- `TICHU_SEED=80 npm start` – feste Mischung als Standard für alle Tische (zum Testen)
- `npm test` – Regeltests + 30 simulierte Bot-Partien; `node test/e2e.js` – Test über den echten Server

## Quellen

- Hundebellen: „dog bark 9“ von alexzavesa, freesound.org (Sound #853723) – Lizenz siehe Freesound-Seite.
