# CAC Controller - Technische Dokumentation

## Projektbeschreibung

Der CAC Controller ist eine webbasierte Steuerungssoftware fuer Pioneer CD-Automatenwechsler der Serien CAC-V3000, CAC-V3200, CAC-V5000 und CAC-V180M. Die Software laeuft auf einem Raspberry Pi, kommuniziert ueber RS-232C mit dem Wechsler und stellt ein modernes Webinterface zur Verfuegung, das von jedem Geraet im Netzwerk erreichbar ist.

### Systemarchitektur

```
┌─────────────────────────────────────────────────┐
│                   Browser                        │
│          (Smartphone / Tablet / PC)              │
│  ┌─────────────────────────────────────────────┐ │
│  │            Single Page App                  │ │
│  │   HTML + CSS + JavaScript (app.js, i18n.js) │ │
│  └─────────────┬───────────────────────────────┘ │
└────────────────┼─────────────────────────────────┘
                 │ HTTP (REST API) + WebSocket
                 │
┌────────────────┼─────────────────────────────────┐
│  Node.js       │  Express Server (server.js)     │
│  ┌─────────────┴───────────────────────────────┐ │
│  │              routes.js (REST API)           │ │
│  │              websocket.js (Live-Updates)     │ │
│  ├─────────────────────────────────────────────┤ │
│  │  player.js    │  scanner.js  │ musicbrainz  │ │
│  │  (Steuerung)  │  (CD-Scan)   │   .js (API)  │ │
│  ├─────────────────────────────────────────────┤ │
│  │           serial.js (Verbindung)            │ │
│  │           protocol.js (Protokoll)           │ │
│  ├─────────────────────────────────────────────┤ │
│  │        database.js (SQLite / better-sqlite3)│ │
│  └─────────────┬───────────────────────────────┘ │
└────────────────┼─────────────────────────────────┘
                 │ RS-232C (9600 Baud, 8N1)
                 │
┌────────────────┼─────────────────────────────────┐
│    Pioneer CAC CD-Automatenwechsler              │
│    (bis zu 500 CDs, 2 CD-Player)                 │
└──────────────────────────────────────────────────┘
```

---

## 1. Hardware und Anschluss

### 1.1 Unterstuetzte Modelle

| Modell | Kapazitaet | Player | Baudrate | Lautstaerke | Geschwindigkeit |
|--------|-----------|--------|----------|-------------|-----------------|
| CAC-V3000 | 300 CDs | 2 | 9600 | Ja | Ja |
| CAC-V3200 | 300 CDs | 2 | 9600 | Ja | Ja |
| CAC-V5000 | 500 CDs | 2 | 9600 | Ja | Ja |
| CAC-V180M | 18 CDs | 1 | 4800 | Nein | Nein |

### 1.2 Serielle Verbindung

Die Kommunikation erfolgt ueber RS-232C mit folgenden Parametern:

- **Baudrate**: 9600 (V3000/V3200/V5000) oder 4800 (V180M)
- **Datenbits**: 8
- **Stoppbits**: 1
- **Paritaet**: Keine
- **Terminator**: Carriage Return (`\r`, ASCII 0x0D)
- **Maximale Befehlslaenge**: 20 Zeichen

Physikalischer Anschluss: 15-poliger D-Sub-Stecker (RS-232C) am Wechsler, verbunden ueber einen USB-zu-Seriell-Adapter mit dem Raspberry Pi.

### 1.3 Empfohlene Hardware

- **Raspberry Pi**: Pi 3, Pi 4, Pi 5 oder Zero 2 W (auch Pi Zero W moeglich, aber langsamer)
- **USB-Seriell-Adapter**: FTDI FT232R, Prolific PL2303 oder CH340
- **Betriebssystem**: Raspberry Pi OS (Debian Bookworm oder neuer)

---

## 2. Pioneer CAC Serielles Protokoll

### 2.1 Befehlsformat

Alle Befehle werden im Format `<Player-ID>PS<Befehl>\r` gesendet. Die Player-ID ist `1` oder `2` (bei Dual-Player-Modellen).

Beispiel: `1PS001ZSPL\r` waehlt Player 1, laedt Disc 001 und startet die Wiedergabe.

Mehrere Befehle koennen in einer Zeile verkettet werden, solange die Gesamtlaenge 20 Zeichen nicht ueberschreitet.

### 2.2 Ausfuehrungsbefehle (27 Befehle)

| Befehl | Code | Beschreibung | Argumente |
|--------|------|--------------|-----------|
| Player Select | `PS` | Player auswaehlen | Player-ID (1/2) |
| Disc Select | `ZS` | CD laden | 3-stellige Slotnummer (001-500) |
| Disc Return | `ZR` | CD zuruecklegen | - |
| Start | `SA` | Motor starten | - |
| Reject | `RJ` | Motor stoppen | - |
| Play | `PL` | Wiedergabe starten | - |
| Pause | `PA` | Pausieren | - |
| Scan Forward | `NF` | Vorwaerts scannen | - |
| Scan Reverse | `NR` | Rueckwaerts scannen | - |
| Search | `SE` | Suche ausfuehren | - |
| Stop Marker | `SM` | Stopppunkt setzen | - |
| Track | `TR` | Track auswaehlen | 2-stellige Tracknummer |
| Index | `IX` | Index auswaehlen | 2-stellige Indexnummer |
| Clear | `CL` | Befehle loeschen | - |
| Lead Out | `LO` | Lead-Out anfahren | - |
| Speed | `SP` | Geschwindigkeit | 90-110 (Prozent) |
| Volume | `VL` | Lautstaerke | 0-255 (digital) |
| Duration | `DU` | Dauer fuer Fade | 1-99 (Sekunden) |
| Fade | `FD` | Lautstaerke-Fade | 0-255 (Zielwert) |
| Auto Cue Search | `QS` | Auto-Cue-Suche | - |
| Auto Cue Stop | `QT` | Auto-Cue-Stop | - |
| Cue Level | `QL` | Cue-Pegel | 0-255 |
| Block | `BK` | Block-Nummer setzen | - |
| Time | `TM` | Zeitposition setzen | - |
| Limit Time | `LT` | Zeitlimit | 1-99 (100ms Einheiten) |
| Comm Mode | `CM` | Kommunikationsmodus | 0-2 |
| Changer Reset | `!!` | Wechsler zuruecksetzen | - |

### 2.3 Abfragebefehle (14 Befehle)

| Befehl | Code | Antwortformat | Beschreibung |
|--------|------|---------------|-------------|
| Job Status | `?J` | `R` / `B` | Bereit / Beschaeftigt |
| Player Mode | `?P` | `P01`-`P22` | Aktueller Modus |
| Disc Number | `?Z` | 3-stellig / `XXX` | Geladene CD / keine |
| Mech Error | `?E` | `E00`-`E99` | Fehlercodes |
| Block Number | `?B` | 6-stellig | Aktuelle Position |
| Time Code | `?T` | 4-stellig (MMSS) | Verstrichene Zeit |
| Track Number | `?R` | 2-stellig / `XX` | Aktueller Track / keiner |
| Index Number | `?I` | 2-stellig | Aktueller Index |
| TOC Info | `?Q` | 10-stellig | Erstes/Letztes Track + Lead-Out |
| Catalog | `?G` | UPC/EAN | Katalognummer |
| Model Name | `?X` | 6 Zeichen | Modellbezeichnung |
| Comm Mode | `?M` | `CM0`-`CM2` | Kommunikationsmodus |
| Play Time | `?A` | 10-stellig | Gesamt-Spielzeit |
| Disc Status | `?K` | 8 Zeichen | Disc-Status-Flags |

### 2.4 Player-Modi

| Code | Modus | Beschreibung |
|------|-------|--------------|
| `P01` | Park | CD geladen, Motor aus |
| `P02` | Set Up | TOC wird gelesen |
| `P03` | Reject | Motor wird gestoppt |
| `P04` | Play | Wiedergabe laeuft |
| `P06` | Pause | Pausiert |
| `P07` | Search | Suchvorgang |
| `P08` | Scan | Scan-Vorgang |
| `P20` | Disc Unset | Keine CD geladen |
| `P21` | Load | CD wird aus dem Magazin geholt |
| `P22` | Unload | CD wird zurueckgelegt |

### 2.5 Fehlercodes

| Code | Fehler | Beschreibung |
|------|--------|--------------|
| `E00` | Kommunikation | Serieller Kommunikationsfehler |
| `E04` | Funktion | Funktion nicht verfuegbar |
| `E05` | Argument | Argument fehlt oder ungueltig |
| `E11` | Disc | Disc nicht vorhanden |
| `E12` | Adresse | Adressfehler |
| `E13` | Fokus | Defokussierung |
| `E14` | Spindel | Spindel entsperrt |
| `E20` | Panik | Wechsler-Panik |
| `E21` | Tuer | Tuer offen |
| `E22` | Init | Wechsler initialisiert |
| `E81`-`E99` | System | Diverse Systemfehler |

### 2.6 Lautstaerke-Mapping

Die digitale Lautstaerke (0-255) entspricht folgenden dB-Werten:

| dB | Wert | dB | Wert |
|----|------|----|------|
| 0 dB | 255 | -30 dB | 138 |
| -1 dB | 247 | -40 dB | 97 |
| -3 dB | 239 | -50 dB | 60 |
| -6 dB | 230 | -60 dB | 16 |
| -10 dB | 213 | -70 dB | 5 |
| -20 dB | 174 | -80 dB | 1 |
| | | Stumm | 0 |

---

## 3. Software-Architektur

### 3.1 Technologie-Stack

| Komponente | Technologie | Version |
|------------|-------------|---------|
| Runtime | Node.js | >= 18.x |
| Web-Framework | Express | 5.x |
| WebSocket | ws | 8.x |
| Datenbank | better-sqlite3 | 11.x |
| Serielle Kommunikation | serialport | 12.x |
| ZIP-Archivierung | adm-zip | 1.x |
| Frontend | Vanilla JS (SPA) | - |
| Internationalisierung | Eigene i18n-Loesung | DE/EN |

### 3.2 Projektstruktur

```
cac-controller/
├── server.js                 # Einstiegspunkt: Express + WebSocket Setup
├── package.json              # Abhaengigkeiten und Skripte
├── cac-controller.service    # Systemd-Unit fuer Autostart
├── src/
│   ├── protocol.js           # Pioneer-Protokoll (Befehle, Parser, Konstanten)
│   ├── serial.js             # Serielle Verbindung (Queue, Auto-Reconnect)
│   ├── player.js             # Player-Manager (Polling, Zustand, Wiedergabe-Modi)
│   ├── scanner.js            # CD-Scanner (TOC lesen, Slots scannen)
│   ├── musicbrainz.js        # MusicBrainz-API und Cover Art Archive
│   ├── database.js           # SQLite-Datenbank (Schema, CRUD-Operationen)
│   ├── routes.js             # REST-API-Routen
│   └── websocket.js          # WebSocket-Manager (Broadcasts)
├── public/
│   ├── index.html            # Single Page Application (HTML)
│   ├── css/
│   │   └── app.css           # Komplettes Styling (Dark Theme)
│   ├── js/
│   │   ├── app.js            # Frontend-Logik (Zustand, Rendering, Events)
│   │   └── i18n.js           # Uebersetzungen (Deutsch/Englisch)
│   └── covers/               # Hochgeladene Cover-Bilder
├── data/
│   └── cac-controller.db     # SQLite-Datenbank (wird automatisch erstellt)
└── docs/
    └── DOKUMENTATION.md       # Diese Datei
```

### 3.3 Modul-Uebersicht

#### server.js — Einstiegspunkt

Initialisiert alle Komponenten in der richtigen Reihenfolge:
1. Datenbank initialisieren und Einstellungen laden
2. Serielle Verbindung konfigurieren
3. PlayerManager mit serieller Verbindung erstellen
4. CDScanner erstellen
5. Express-Server mit statischen Dateien und API-Routen starten
6. WebSocket-Server starten
7. Serielle Verbindung oeffnen und Polling starten

Graceful Shutdown ueber SIGINT/SIGTERM: Polling stoppen, serielle Verbindung schliessen.

#### protocol.js — Pioneer-Protokoll

Enthaelt die komplette Protokolldefinition:

- **MODELS**: Hardware-Eigenschaften pro Modell (Baudrate, Kapazitaet, Features)
- **SERIAL_CONFIG**: Kommunikationsparameter (8N1, Terminator, Timeouts)
- **CMD**: Alle 27 Ausfuehrungsbefehle als Konstanten
- **QUERY**: Alle 14 Abfragebefehle als Konstanten
- **PLAYER_MODES**: Zuordnung P01-P22 zu lesbaren Labels
- **ERRORS**: Fehlercodes E00-E99 mit Beschreibungen
- **VOLUME_MAP**: dB-zu-Wert-Zuordnung
- **buildCommand()**: Erzeugt formatierte Befehlsstrings
- **parseResponse()**: Parst eingehende Antworten in typisierte Objekte

Der Parser erkennt automatisch: Fehlercodes, Job-Status, Player-Mode, Disc-Nummer, Track-Nummer, Zeitcode, Block-Nummer, TOC-Info, Modellname, Disc-Status und mehr.

#### serial.js — Serielle Verbindung

Verwaltet die physische Verbindung zum Wechsler:

- **Verbindungsmanagement**: Oeffnen, Schliessen, automatische Wiederverbindung alle 5 Sekunden
- **Befehlsqueues**: Separate Queue pro Player (1 und 2), mit 200ms Abstand zwischen Befehlen
- **Prioritaetsbefehle**: `sendPriority()` fuer zeitkritische Befehle (wird vorne in die Queue eingefuegt)
- **Response-Parser**: Eingehende Daten werden per ReadlineParser (CR-Delimiter) gepuffert und ueber Events verteilt
- **Event-basiert**: Emittiert `connected`, `disconnected`, `error`, `response` und `playerResponse`

Die Fire-and-Forget-Architektur entkoppelt gesendete Befehle komplett von empfangenen Antworten. Der PlayerManager reagiert auf eingehende Antworten unabhaengig davon, welcher Befehl sie ausgeloest hat.

#### player.js — Player-Manager

Zentrales Modul fuer die Steuerung beider CD-Player:

**Zustandsverwaltung:**
- Pro Player: Modus, Disc, Track, Zeit (Disc-elapsed und Track-relativ), Lautstaerke, Geschwindigkeit, TOC, Fehler
- Interpolierte Zeitanzeige: Der Pioneer liefert Zeitcodes nur ca. 1x/Sekunde. Das Frontend interpoliert fuer fluessige Anzeige.

**Polling:**
- Player-Modus: alle 850ms (Player 1) / 900ms (Player 2)
- Zeitcode: alle 1000ms / 1050ms
- Track: alle 1000ms / 1100ms
- Disc: alle 5000ms / 5500ms
- TOC: alle 10000ms / 10500ms
- Versetzte Intervalle vermeiden Kollisionen auf dem seriellen Bus

**Wiedergabe-Modi:**

*Continuous Play:*
Wenn die letzte Track einer CD endet (Modus wechselt von P04 zu P01/P03/P06 UND der letzte bekannte Track war der letzte Track laut TOC), wird automatisch der andere Player gestartet.

*Gapless Play:*
Wenn der aktuelle Track der letzte auf der CD ist, wird der andere Player per Auto-Cue vorbereitet (`SA` + `TR01SE`). Bei Disc-Ende wird er sofort gestartet (`PL`).

*Shuffle:*
- `cd`: Zufaelliger Track auf der aktuellen CD (mit History um Wiederholungen zu vermeiden)
- `players`: Zufaelliger Track von beiden geladenen CDs
- `all`: Zufaellige CD aus der gesamten Library laden und abspielen

*Playlists:*
Server-seitige Playlist-Engine mit intelligenter Dual-Player-Verwaltung:
- Waehlt automatisch den optimalen Player (bevorzugt den mit der richtigen CD)
- Laedt die naechste CD in den unbeschaeftigten Player vor (Pre-Loading)
- Erkennt automatische Track-Weiterschaltung und gleicht sie mit der Playlist ab
- Stoppt den vorherigen Player beim Wechsel
- Guard gegen doppeltes Weiterschalten bei schnellen Modus-Transitionen

**Spieldauer-Tracking:**
- Bei Wiedergabestart (Modus wechselt zu P04) wird ein `play_history`-Eintrag erstellt und der Startzeitpunkt gespeichert
- Bei Track-Wechsel waehrend der Wiedergabe wird der vorherige Eintrag finalisiert (Dauer berechnet) und ein neuer erstellt
- Bei Wiedergabestop (Modus wechselt von P04) wird der aktuelle Eintrag finalisiert
- Die tatsaechliche Spieldauer (`duration_played`) wird in Sekunden in der Datenbank gespeichert

#### scanner.js — CD-Scanner

Scannt Slots im Wechsler und liest die TOC (Table of Contents):

**Scan-Ablauf pro Slot:**
1. CD laden (`<slot>ZS`)
2. Warten auf Modus P01/P02/P04/P06 (Disc geladen)
3. Wiedergabe starten (`SA`) fuer TOC-Zugriff
4. 3 Sekunden warten (Spin-Up)
5. TOC abfragen (`?Q`), bis zu 3 Versuche
6. Track-Stubs erzeugen (Track 1..N mit Platzhalter-Titeln)
7. Daten in die Datenbank schreiben
8. Disc stoppen und zuruecklegen (`RJ` + `ZR`)

**Zusaetzliche Funktionen:**
- `scanRange(start, end)`: Scannt einen Bereich von Slots sequentiell
- `scanAll(maxDiscs)`: Scannt alle Slots
- `abort()`: Bricht den laufenden Scan ab
- `lookupMetadata()` / `applyMetadata()`: MusicBrainz-Integration
- Echtzeit-Fortschritt ueber EventEmitter (wird per WebSocket an alle Clients gesendet)

**Wichtig:** Waehrend des Scans wird das Polling fuer den betroffenen Player pausiert, um Konflikte auf dem seriellen Bus zu vermeiden.

#### musicbrainz.js — MusicBrainz-Integration

Ruft Metadaten von der MusicBrainz-API und Cover-Art vom Cover Art Archive ab:

**Rate Limiting:** Mindestens 1,1 Sekunden zwischen Anfragen (MusicBrainz erlaubt max. 1 Anfrage/Sekunde)

**Suchmoeglichkeiten:**
- Freitextsuche (Kuenstler, Album, etc.)
- Suche nach Kuenstler + Albumtitel
- Suche nach Barcode/EAN
- Suche nach Track-Anzahl und Gesamtdauer (fuer Pioneer-Scanner ohne Track-Offsets)
- Lookup per Disc-ID (SHA-1 aus TOC-Offsets)
- Lookup per TOC-Sektoren (Fuzzy-Matching)

**Metadaten-Mapping:**
MusicBrainz-Daten werden in das interne Format konvertiert:
- Release -> CD (Titel, Kuenstler, Jahr, Genre, Label, Land, Barcode)
- Recording -> Track (Titel, Kuenstler, Dauer)
- Cover Art Archive -> Cover-URL

#### database.js — SQLite-Datenbank

Verwendet better-sqlite3 fuer synchrone, performante Datenbankzugriffe.

**Schema:**

```sql
cds (
  slot INTEGER PRIMARY KEY,    -- 1-500
  disc_id TEXT,                -- MusicBrainz Disc-ID
  title TEXT,                  -- Album-Titel
  artist TEXT,                 -- Kuenstler
  year TEXT,                   -- Erscheinungsjahr
  genre TEXT,                  -- Genre
  total_tracks INTEGER,        -- Anzahl Tracks
  total_duration_seconds INTEGER, -- Gesamtdauer
  cover_url TEXT,              -- Pfad zum Cover-Bild
  notes TEXT,                  -- Benutzernotizen
  musicbrainz_release_id TEXT, -- MusicBrainz Release-ID
  barcode TEXT,                -- EAN/Barcode
  label TEXT,                  -- Plattenlabel
  country TEXT,                -- Herkunftsland
  created_at TEXT,
  updated_at TEXT
)

tracks (
  id INTEGER PRIMARY KEY,
  slot INTEGER REFERENCES cds(slot),
  track_number INTEGER,
  title TEXT,
  artist TEXT,
  duration_seconds INTEGER,
  isrc TEXT,
  UNIQUE(slot, track_number)
)

playlists (id, name, description, created_at, updated_at)
playlist_items (id, playlist_id, slot, track_number, position)
play_history (id, slot, track_number, player_id, played_at, duration_played)
favorites (id, slot, track_number, added_at)
ratings (id, slot, track_number, rating 1-5, created_at)
settings (key TEXT PRIMARY KEY, value TEXT)
```

**Zusaetzliche Operationen:**
- `moveCD(fromSlot, toSlot)` — Verschiebt eine CD mit allen zugehoerigen Daten (Tracks, Bewertungen, Favoriten, Wiedergabeverlauf) in einer Transaktion
- `bulkUpdateField(field, oldValue, newValue)` — Aktualisiert einen Feldwert (Jahr/Genre/Label) bei allen betroffenen CDs

**Standard-Einstellungen** werden beim ersten Start automatisch angelegt (Modell, Port, Baudrate, Polling-Intervalle, Sprache, MusicBrainz-Konfiguration, Hub/Netzwerk-Einstellungen, Statistik-Mindestspieldauer).

Die Spalte `duration_played` in `play_history` speichert die tatsaechliche Spieldauer in Sekunden. Der Schwellenwert `stats_min_seconds` (Standard: 30) bestimmt, ab welcher Dauer ein Track in der Statistik gezaehlt wird.

#### routes.js — REST-API

Definiert alle HTTP-Endpunkte:

- **API-Key-Middleware**: Globale Middleware auf `/api/*` — wenn ein `X-API-Key`-Header (oder `?apikey=`-Parameter) vorhanden ist, wird er gegen den gespeicherten Schluessel validiert. Damit kann ein Hub alle Endpunkte fernsteuern. Lokale Browser-Clients ohne API-Key passieren ungehindert.
- **Node-API** (2 Endpunkte): `/api/node/info` und `/api/node/status` — Hub-spezifische Convenience-Endpunkte (erfordern API-Key)
- **Player-Steuerung** (17 Endpunkte): Load, Eject, Play, Pause, Stop, Track, Next, Previous, Scan Forward/Reverse, Volume, Speed, Fade, Cue Search, Stop Marker, Reset, Raw Command
- **Library** (6 Endpunkte): CRUD fuer CDs, Bulk-Delete, Track-Update
- **Cover-Upload**: Base64-kodierte Bilder (max. 2MB), automatische Erkennung von JPEG/PNG/WebP
- **MusicBrainz** (3 Endpunkte): Suche, Release-Details, Metadaten anwenden
- **Scanner** (4 Endpunkte): Scan starten, Scan-All, Abbrechen, Fortschritt
- **Playlists** (10 Endpunkte): CRUD, Items hinzufuegen/entfernen, Reihenfolge, Abspielen
- **Favoriten, Bewertungen, History, Suche, Statistiken, Einstellungen, Play-Modi**
- **Statistiken** (2 Endpunkte): `GET /api/stats` (Top-Tracks mit Covers, Top-CDs, Top-Kuenstler, Genre-Verteilung, Aktivitaets-Diagramm), `DELETE /api/stats/reset` (Verlauf zuruecksetzen). Beruecksichtigt den konfigurierbaren Schwellenwert `stats_min_seconds`.
- **Backup** (4 Endpunkte): `GET /api/backup` (vollstaendiger Datenbank-Export als JSON), `POST /api/backup` (Datenbank-Import aus JSON-Backup), `GET /api/backup/covers` (alle Cover-Bilder als ZIP exportieren), `POST /api/backup/covers` (Cover-Bilder aus ZIP importieren)
- **Bibliothek-Editor** (2 Endpunkte): `POST /api/library/bulk-update-field` (Feldwert bei allen CDs umbenennen/loeschen), `POST /api/library/:slot/move` (CD in anderen Slot verschieben mit kaskadierender Aktualisierung von Tracks, Bewertungen, Favoriten, Wiedergabeverlauf)
- **Playlist-Sortierung**: `PUT /api/playlists/:id/reorder` — Drag-and-Drop-Neuordnung mit temporaerer Positions-Bereinigung (UNIQUE-Constraint-sicher)
- **JSON-Import**: Unterstuetzt verschiedene Formate, automatische Feld-Zuordnung, Track-Deduplizierung

#### websocket.js — WebSocket-Manager

Verwaltet alle WebSocket-Verbindungen und leitet Ereignisse weiter:

- **Lokale Clients**: Verbindung per `ws://host:port` — erhalten initialen Zustand und alle Broadcasts
- **Hub-Clients**: Verbindung per `ws://host:port/?hub=1&apikey=<key>` — API-Key wird validiert, bei Erfolg wird eine `hubInit`-Nachricht mit Node-Name, Raum, Modell und aktuellem Zustand gesendet
- Leitet weiter: Player-State-Changes, Scanner-Progress, Play-Mode-Changes, Continuous-Switch, Playlist-Updates, Serial-Events
- Broadcast an alle verbundenen Clients (lokal + Hub)

---

## 4. Frontend

### 4.1 Aufbau

Das Frontend ist eine Single Page Application (SPA) ohne Build-Tools oder Frameworks:

- **index.html**: Komplettes HTML mit allen Ansichten (Player, Library, Scanner, Playlists, Favoriten, Bewertungen, History, Statistiken, CD-Bibliothek-Editor, Einstellungen, Terminal)
- **app.js**: Gesamte Anwendungslogik (Zustand, Rendering, Event-Handler, API-Aufrufe, WebSocket-Verbindung)
- **i18n.js**: Uebersetzungssystem mit ca. 200 Schluessel-Wert-Paaren fuer Deutsch und Englisch
- **app.css**: Vollstaendiges Styling im Dark Theme mit CSS Custom Properties

### 4.2 Internationalisierung (i18n)

Das Uebersetzungssystem arbeitet auf drei Ebenen:

1. **HTML-Attribute**: `data-i18n="key"` fuer Textinhalte, `data-i18n-placeholder="key"` fuer Platzhalter, `data-i18n-title="key"` fuer Tooltips
2. **JavaScript**: `t('key')` Funktion fuer dynamisch erzeugte Texte
3. **Server-Nachrichten**: Der Scanner sendet strukturierte Objekte `{ key: 'scan.loading', slot: 42 }`, die im Frontend uebersetzt werden

Sprachumschaltung: Automatisch (Systemsprache), Deutsch oder Englisch. Bei Aenderung werden alle sichtbaren Texte sofort aktualisiert.

### 4.3 Echtzeit-Updates

Die WebSocket-Verbindung liefert alle Aenderungen in Echtzeit:

- **Player-Status**: Modus, Track, Disc (sofort bei Aenderung)
- **Zeitanzeige**: Der Pioneer liefert die Zeit ca. 1x/Sekunde. Das Frontend interpoliert clientseitig fuer fluessige Anzeige (1 Update/Sekunde via `setInterval`).
- **Scanner-Fortschritt**: Slot, Status, Fehlermeldungen
- **Playlist-Status**: Aktueller Index, Player-Zuordnung
- **Verbindungsstatus**: Seriell verbunden/getrennt

### 4.4 CD Bibliothek Editor

Der CD Bibliothek Editor (unter "Mehr") ermoeglicht die vollstaendige Inline-Bearbeitung aller CD-Metadaten:

**Bearbeitbare Felder:**
- **Slot** — Aenderbar mit automatischer Verschiebung aller zugehoerigen Daten (Tracks, Bewertungen, Favoriten, Wiedergabeverlauf)
- **Titel, Kuenstler, Notizen** — Inline-Textfelder mit sofortigem Speichern (Fire-and-Forget)
- **Jahr, Label, Genre** — Eigene Combobox-Komponente mit Suchfunktion, 47 vordefinierten Genres und 71 vordefinierten Labels

**Combobox-Komponente:**
- Ersetzt native `<select>`-Elemente fuer durchsuchbare Dropdowns
- Mehrzeichen-Typeahead-Suche (nicht nur Einzelzeichen wie bei nativen Selects)
- Zuletzt verwendete Werte werden oben angezeigt (max. 5 pro Feld)
- Individuelle Werte koennen inline hinzugefuegt werden (ohne Browser-Prompts)
- Tastaturnavigation: Pfeiltasten, Enter, Escape

**Werteverwaltung:**
- Umbenennung eines Wertes (z.B. Genre "Rock" in "Rock/Pop") mit automatischer Aktualisierung aller betroffenen CDs
- Loeschung eines Wertes mit Bulk-Update ueber `POST /api/library/bulk-update-field`

**Filter und Sortierung:**
- Filterleiste: Slot (Nummer), Titel (Text), Kuenstler (Text), Jahr/Label/Genre (Dropdown mit "Ohne Wert"-Option)
- Sortierung nach Slot, Titel, Kuenstler, Jahr, Label oder Genre (aufsteigend/absteigend)
- Ergebnisanzahl wird live angezeigt

**Darstellung:**
- Zweizeilige Card-Ansicht pro CD mit Cover-Thumbnail
- Gruener Flash bei erfolgreichem Speichern

### 4.5 Cover-Upload

Cover-Bilder werden clientseitig verarbeitet:
1. Dateiauswahl oder Drag & Drop
2. Vorschau im Browser
3. Automatische Groessenanpassung per Canvas-API (max. 500x500 Pixel)
4. Konvertierung zu JPEG (Qualitaet 85%)
5. Base64-kodierter Upload per REST-API
6. Server speichert in `public/covers/cover_<slot>.jpg`

---

## 5. Datenfluss

### 5.1 Player-Steuerung (z.B. "Play druecken")

```
Browser                   Server                    Wechsler
   │                         │                          │
   │ POST /api/player/1/play │                          │
   │────────────────────────>│                          │
   │    { ok: true }         │                          │
   │<────────────────────────│  "1PSPL\r"               │
   │                         │─────────────────────────>│
   │                         │                          │
   │                         │  "1PSP04\r"              │
   │                         │<─────────────────────────│
   │                         │                          │
   │  WS: playerState        │  (Polling: ?P -> P04)    │
   │  { mode: 'P04', ... }   │                          │
   │<════════════════════════│                          │
```

### 5.2 CD scannen

```
Browser                   Server                    Wechsler
   │ POST /api/scanner/scan  │                          │
   │ { slot: 42 }            │                          │
   │────────────────────────>│                          │
   │                         │  "1PS042ZS\r"            │
   │                         │─────────────────────────>│
   │  WS: scanProgress       │                          │
   │  { status: 'loading' }  │                          │
   │<════════════════════════│                          │
   │                         │  (wartet auf P01/P02...) │
   │                         │                          │
   │                         │  "1PSSA\r"               │
   │                         │─────────────────────────>│
   │  WS: scanProgress       │                          │
   │  { status: 'reading' }  │                          │
   │<════════════════════════│                          │
   │                         │  "1PS?Q\r"               │
   │                         │─────────────────────────>│
   │                         │  "1PS0112045000\r"       │
   │                         │<─────────────────────────│
   │  WS: scanProgress       │  (TOC: Tracks 1-12,     │
   │  { status: 'scanned',   │   45:00 Gesamtdauer)    │
   │    totalTracks: 12 }    │                          │
   │<════════════════════════│                          │
   │                         │  "1PSRJ\r" + "1PSZR\r"  │
   │                         │─────────────────────────>│
```

### 5.3 Playlist-Wiedergabe mit Dual-Player

```
Playlist: [Slot 42/Track 3, Slot 101/Track 1, Slot 42/Track 7]

Schritt 1: Lade CD 42 in Player 1, spiele Track 3
           Gleichzeitig: Lade CD 101 in Player 2 (Pre-Load)

Schritt 2: CD 101 ist bereits in Player 2 geladen
           Stoppe Player 1, spiele Track 1 auf Player 2
           Gleichzeitig: Player 1 hat noch CD 42 (kein Pre-Load noetig)

Schritt 3: CD 42 ist noch in Player 1
           Stoppe Player 2, spiele Track 7 auf Player 1
```

---

## 6. Datenbank-Details

### 6.1 WAL-Modus

Die Datenbank verwendet WAL (Write-Ahead Logging) fuer bessere Performance bei gleichzeitigem Lesen und Schreiben.

### 6.2 UPSERT-Logik

CDs werden per `upsertCD()` eingefuegt oder aktualisiert. COALESCE stellt sicher, dass nur uebergebene Felder aktualisiert werden — bestehende Werte bleiben bei NULL-Argumenten erhalten.

### 6.3 Track-Deduplizierung

Beim JSON-Import werden Tracks per Map dedupliziert, bevor sie in die Datenbank geschrieben werden. Dies verhindert UNIQUE-Constraint-Verletzungen bei doppelten Tracknummern in den Quelldaten.

### 6.4 Kaskadierendes Loeschen

`ON DELETE CASCADE` bei tracks -> cds stellt sicher, dass beim Loeschen einer CD automatisch alle zugehoerigen Tracks entfernt werden. Cover-Dateien werden separat per `deleteCoversForSlot()` geloescht.

---

## 7. JSON-Import

### 7.1 Unterstuetzte Formate

Der Import erkennt automatisch verschiedene JSON-Strukturen:

```json
// Format 1: Array von CDs
[
  { "slot": 1, "title": "Album", "artist": "Kuenstler", "tracks": [...] },
  ...
]

// Format 2: Objekt mit cds-Array
{
  "cds": [ { "slot": 1, ... }, ... ]
}

// Format 3: Objekt mit Slot-Keys
{
  "1": { "title": "Album", ... },
  "2": { "title": "Album 2", ... }
}
```

### 7.2 Feld-Zuordnung

Der Import unterstuetzt verschiedene Feldnamen:

| Internes Feld | Akzeptierte Bezeichnungen |
|---------------|---------------------------|
| slot | `slot`, `cd_number`, `slotNumber`, `nr` |
| title | `title`, `album`, `name` |
| artist | `artist`, `album_artist`, `albumArtist` |
| year | `year`, `release_date`, `releaseDate` |
| total_duration | `total_duration_seconds`, `totalDuration`, `album_length` (MM:SS) |
| track.title | `title`, `track_title`, `name` |
| track.duration | `duration_seconds`, `durationSeconds`, `track_length` (MM:SS), `duration` (MM:SS) |

### 7.3 Vorschau-UI

Vor dem eigentlichen Import wird eine editierbare Vorschau angezeigt:
- Jede CD als Zeile mit Slot-Nummer, Titel, Kuenstler, Tracks, Dauer
- Status-Badges: Neu / Update / Warnung
- Editierbare Slot-Nummern (mit automatischem Tausch bei Duplikaten)
- Checkbox pro CD (einzeln abwaehlen)
- Mojibake-Reparatur-Button (erkennt und repariert doppelt kodierte UTF-8-Sequenzen)

---

## 8. Deployment

### 8.1 Systemd-Service

Die mitgelieferte `cac-controller.service` startet die Anwendung beim Booten:

```ini
[Unit]
Description=CAC Controller - Pioneer CD Autochanger Web Controller
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/opt/cac-controller
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
SupplementaryGroups=dialout
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### 8.2 Serielle Port-Berechtigung

Der Benutzer muss Mitglied der `dialout`-Gruppe sein:
```bash
sudo usermod -a -G dialout pi
```

### 8.3 WLAN-Optimierung

Empfohlen: Stromsparmodus des WLAN deaktivieren, um Latenz zu vermeiden:
```bash
sudo iw wlan0 set power_save off
```

---

## 9. Sicherheit

### 9.1 Lokale Web-Oberflaeche

- **Keine Authentifizierung**: Die Web-Oberflaeche ist ohne Login zugaenglich (nur fuer LAN gedacht)
- **Kein HTTPS**: Die Kommunikation erfolgt unverschluesselt

### 9.2 Hub/Node-API-Authentifizierung

- Alle `/api/*`-Endpunkte unterstuetzen optionale **API-Key-Authentifizierung**
- Hub sendet `X-API-Key`-Header (oder `?apikey=`-Query-Parameter)
- Der Schluessel wird gegen den in den Einstellungen gespeicherten `node_api_key` geprueft
- Bei gueltigem Schluessel hat der Hub **vollen Zugriff auf alle Funktionen** (Library, Playlists, Scanner, Einstellungen, etc.)
- Ohne API-Key werden nur lokale Browser-Requests durchgelassen (bisheriges Verhalten)
- Hub-WebSocket-Verbindungen erfordern ebenfalls einen gueltigen API-Key: `ws://host:port/?hub=1&apikey=<key>`

### 9.3 Empfehlungen

- Firewall-Regel: Nur Zugriff aus dem lokalen Netzwerk erlauben
- Kein Port-Forwarding zum Internet
- API-Key sollte ausreichend lang und zufaellig sein (die UI generiert 32-stellige alphanumerische Keys)
- Bei Bedarf: Nginx als Reverse-Proxy mit Basic Auth oder Client-Zertifikaten

---

## 10. Hub/Node-Architektur (Multi-Changer)

### 10.1 Konzept

Jede CAC-Controller-Instanz laeuft als eigenstaendiger **Node** auf einem Raspberry Pi. Ein optionaler **Hub** kann sich mit mehreren Nodes im Netzwerk verbinden und bietet ein zentrales Dashboard fuer Monitoring und Steuerung.

```
                    ┌──────────────────┐
                    │    Hub (zentral)  │
                    │   Dashboard-App   │
                    └───┬────┬────┬────┘
          REST API +    │    │    │    REST API +
          WebSocket     │    │    │    WebSocket
        ┌───────────────┘    │    └───────────────┐
        v                    v                    v
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│  Wohnzimmer   │  │    Studio     │  │      Bar      │
│  (RPi + V3000)│  │  (RPi + V5000)│  │ (RPi + V180M) │
└───────────────┘  └───────────────┘  └───────────────┘
```

**Wichtig:** Jeder Node bleibt 100% eigenstaendig. Der Hub ist optional und fuegt lediglich eine zentrale Verwaltungsebene hinzu.

### 10.2 Authentifizierung

- Jeder Node generiert einen **API-Key** (32-stellig, alphanumerisch) in den Einstellungen
- Der Hub authentifiziert sich bei jedem API-Aufruf per `X-API-Key`-Header
- Bei gueltigem Key hat der Hub **vollen Zugriff auf alle Funktionen**: Library-CRUD, Playlists, Scanner, MusicBrainz, Favoriten, Bewertungen, History, Einstellungen, Player-Steuerung — alles

### 10.3 Hub-REST-API

Der Hub kann jeden beliebigen `/api/*`-Endpunkt aufrufen (mit API-Key). Zusaetzlich gibt es zwei Hub-spezifische Convenience-Endpunkte:

| Endpunkt | Beschreibung |
|----------|--------------|
| `GET /api/node/info` | Node-Metadaten (Name, Raum, Modell, Statistiken, Player-Status) |
| `GET /api/node/status` | Live-Status (Player, Scanner, Serielle Verbindung) |

### 10.4 Hub-WebSocket

Hub-Clients verbinden sich per `ws://host:port/?hub=1&apikey=<key>`. Bei erfolgreicher Authentifizierung erhalten sie:

1. Eine `hubInit`-Nachricht mit Node-Name, Raum, Modell und aktuellem Zustand
2. Alle regulaeren Broadcast-Nachrichten (Player-State, Scanner-Progress, etc.)

### 10.5 Einstellungen

Drei neue Einstellungen im Settings-Tab unter "Hub / Netzwerk":

| Einstellung | Beschreibung |
|-------------|--------------|
| Node-Name | Anzeigename fuer diesen Node (z.B. "Wohnzimmer") |
| Raum | Raum- oder Standortbezeichnung |
| API-Key | Gemeinsamer Schluessel fuer Hub-Authentifizierung |

---

## 11. Bekannte Einschraenkungen

1. **Keine Track-Offsets per serieller Schnittstelle**: Der Pioneer liefert nur die Gesamtdauer der CD und die Anzahl der Tracks. Individuelle Track-Laengen werden nicht per TOC uebermittelt. Daher koennen gescannte CDs nur per MusicBrainz-Suche mit genauen Track-Dauern versehen werden.

2. **Mechanische Geschwindigkeit**: Das Laden einer CD dauert 10-30 Sekunden (Roboterarm). Ein vollstaendiger Scan aller 300 Slots dauert daher mehrere Stunden.

3. **Kein Audio-Streaming**: Die Anwendung steuert die Wiedergabe des Wechslers — der Audioausgang ist analog am Geraet selbst. Es findet kein digitales Audio-Streaming statt.

---

## 12. Lizenz

MIT License — Copyright (c) 2025 Dirk Jensen — siehe [LICENSE](../LICENSE).

---

*CAC Controller v1.0.0 &mdash; Copyright (c) 2025 Dirk Jensen*
*Basierend auf dem Pioneer CAC-V3000 Programming Manual (Version 2.0, Mai 1993)*
*MIT License*
