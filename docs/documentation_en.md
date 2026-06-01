# CAC Controller - Technical Documentation

## Project Description

The CAC Controller is a web-based control application for Pioneer CD autochangers of the CAC-V3000, CAC-V3200, CAC-V5000, and CAC-V180M series. The software runs on a Raspberry Pi, communicates via RS-232C with the changer, and provides a modern web interface accessible from any device on the network.

### System Architecture

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
│  │              websocket.js (Live Updates)     │ │
│  ├─────────────────────────────────────────────┤ │
│  │  player.js    │  scanner.js  │ musicbrainz  │ │
│  │  (Control)    │  (CD Scan)   │   .js (API)  │ │
│  ├─────────────────────────────────────────────┤ │
│  │           serial.js (Connection)            │ │
│  │           protocol.js (Protocol)            │ │
│  ├─────────────────────────────────────────────┤ │
│  │        database.js (SQLite / better-sqlite3)│ │
│  └─────────────┬───────────────────────────────┘ │
└────────────────┼─────────────────────────────────┘
                 │ RS-232C (9600 Baud, 8N1)
                 │
┌────────────────┼─────────────────────────────────┐
│    Pioneer CAC CD Autochanger                    │
│    (up to 500 CDs, 2 CD Players)                 │
└──────────────────────────────────────────────────┘
```

---

## 1. Hardware and Connection

### 1.1 Supported Models

| Model | Capacity | Players | Baud Rate | Volume | Speed |
|-------|----------|---------|-----------|--------|-------|
| CAC-V3000 | 300 CDs | 2 | 9600 | Yes | Yes |
| CAC-V3200 | 300 CDs | 2 | 9600 | Yes | Yes |
| CAC-V5000 | 500 CDs | 2 | 9600 | Yes | Yes |
| CAC-V180M | 18 CDs | 1 | 4800 | No | No |

### 1.2 Serial Connection

Communication uses RS-232C with the following parameters:

- **Baud Rate**: 9600 (V3000/V3200/V5000) or 4800 (V180M)
- **Data Bits**: 8
- **Stop Bits**: 1
- **Parity**: None
- **Terminator**: Carriage Return (`\r`, ASCII 0x0D)
- **Maximum Command Length**: 20 characters

> **CAC-V3000 DIP Switch:** DIP switch 3 must be set to **ON** for 9600 baud. All DIP switches OFF = 4800 baud.

| DIP 1 | DIP 2 | DIP 3 | DIP 4 | Baud Rate |
|-------|-------|-------|-------|-----------|
| OFF | OFF | OFF | OFF | 4800 bps |
| OFF | OFF | **ON** | OFF | **9600 bps** |

#### Option A: External USB-Serial Adapter

Physical connection: 15-pin D-Sub connector (RS-232C) on the changer, connected via a USB-to-Serial adapter to the Raspberry Pi. Detected as `/dev/ttyUSB0`.

#### Option B: Internal TTL Direct Connection

When mounting the RPi Zero W internally, the serial signal is tapped directly at TTL level at the **RSIF board input** (handoff from MCDR board). Both boards are located under the **right side cover** (viewed from front).

![RSIF Board](RSIF.jpg) ![MCDR Board](MCDR.jpg)

Since the CAC-V3000 operates internally at 5V TTL and the RPi GPIO accepts max 3.3V, a voltage divider is required on the RXD input:

```
CAC RSIF "Tx" (5V TTL)
        │
       [1 kΩ]  ← R1
        ├──────────→ RPi GPIO15 / RXD (Pin 22)   Voltage: 5V × 2/(1+2) = 3.33V ✓
       [2 kΩ]  ← R2
        │
       GND

RPi GPIO14 / TXD (Pin 8) ──→ CAC RSIF "Rx"    3.3V > 2.0V TTL threshold ✓
RPi GND (Pin 14)          ──→ CAC RSIF "GND"
```

The serial port is `/dev/ttyAMA0`. In `/boot/config.txt`:
```
enable_uart=1
dtoverlay=disable-bt
```
Remove `console=serial0,115200` from `/boot/cmdline.txt`.

### 1.3 Recommended Hardware

#### Option A: External Connection

- **Raspberry Pi**: Pi 3, Pi 4, Pi 5 or Zero 2 W (Pi Zero W also possible but slower)
- **USB-Serial Adapter**: FTDI FT232R, Prolific PL2303 or CH340
- **Operating System**: Raspberry Pi OS (Debian Bookworm or newer)

#### Option B: Internal Installation (RPi Zero W)

The Raspberry Pi Zero W can be fully mounted inside the CAC-V3000 chassis:

- **Power Supply**: HLK-PM01 AC-DC converter (230V→5V, 600mA), tapped from the AC inlet (before the power switch), protected with T500mA fuse
- **Serial**: Direct TTL connection at the RSIF board input (handoff from MCDR board), voltage divider 1kΩ/2kΩ for 5V→3.3V level shifting
- **Relay**: JQC-3FF-S-Z 5V relay module on GPIO17 to power the CAC on/off (Active HIGH, 10kΩ pull-down), `gpio=17=op,dl` in `/boot/config.txt` for safe boot state
- **Network**: Mini USB to USB-A female adapter + **TP-Link TL-WN722N** USB WiFi stick with SMA female connector, routed via SMA cable to an external antenna (the metal chassis acts as a Faraday cage)

![TP-Link TL-WN722N](TL-WN722N.jpg)

| Pin | GPIO | Function | Connection |
|-----|------|----------|------------|
| Pin 2 | 5V | Power | HLK-PM01 "+" / Relay module VCC |
| Pin 6 | GND | Ground | HLK-PM01 "-" / Relay module GND |
| Pin 8 | GPIO14 TXD | Serial TX | RSIF "Rx" (direct) |
| Pin 11 | GPIO17 | Relay control | Relay module IN (+ 10k pull-down) |
| Pin 14 | GND | Serial ground | RSIF "GND" |
| Pin 22 | GPIO15 RXD | Serial RX | RSIF "Tx" (via 1k/2k divider) |

---

## 2. Pioneer CAC Serial Protocol

### 2.1 Command Format

All commands are sent in the format `<Player-ID>PS<Command>\r`. The Player ID is `1` or `2` (for dual-player models).

Example: `1PS001ZSPL\r` selects player 1, loads disc 001, and starts playback.

Multiple commands can be chained in a single line as long as the total length does not exceed 20 characters.

### 2.2 Execution Commands (27 Commands)

| Command | Code | Description | Arguments |
|---------|------|-------------|-----------|
| Player Select | `PS` | Select player | Player ID (1/2) |
| Disc Select | `ZS` | Load CD | 3-digit slot number (001-500) |
| Disc Return | `ZR` | Return CD to magazine | - |
| Start | `SA` | Start motor | - |
| Reject | `RJ` | Stop motor | - |
| Play | `PL` | Start playback | - |
| Pause | `PA` | Pause | - |
| Scan Forward | `NF` | Scan forward | - |
| Scan Reverse | `NR` | Scan reverse | - |
| Search | `SE` | Execute search | - |
| Stop Marker | `SM` | Set stop point | - |
| Track | `TR` | Select track | 2-digit track number |
| Index | `IX` | Select index | 2-digit index number |
| Clear | `CL` | Clear commands | - |
| Lead Out | `LO` | Seek to lead-out | - |
| Speed | `SP` | Playback speed | 90-110 (percent) |
| Volume | `VL` | Volume | 0-255 (digital) |
| Duration | `DU` | Fade duration | 1-99 (seconds) |
| Fade | `FD` | Volume fade | 0-255 (target value) |
| Auto Cue Search | `QS` | Auto cue search | - |
| Auto Cue Stop | `QT` | Auto cue stop | - |
| Cue Level | `QL` | Cue level | 0-255 |
| Block | `BK` | Set block number | - |
| Time | `TM` | Set time position | - |
| Limit Time | `LT` | Time limit | 1-99 (100ms units) |
| Comm Mode | `CM` | Communication mode | 0-2 |
| Changer Reset | `!!` | Reset changer | - |

### 2.3 Query Commands (14 Commands)

| Command | Code | Response Format | Description |
|---------|------|-----------------|-------------|
| Job Status | `?J` | `R` / `B` | Ready / Busy |
| Player Mode | `?P` | `P01`-`P22` | Current mode |
| Disc Number | `?Z` | 3-digit / `XXX` | Loaded CD / none |
| Mech Error | `?E` | `E00`-`E99` | Error codes |
| Block Number | `?B` | 6-digit | Current position |
| Time Code | `?T` | 4-digit (MMSS) | Elapsed time |
| Track Number | `?R` | 2-digit / `XX` | Current track / none |
| Index Number | `?I` | 2-digit | Current index |
| TOC Info | `?Q` | 10-digit | First/last track + lead-out |
| Catalog | `?G` | UPC/EAN | Catalog number |
| Model Name | `?X` | 6 characters | Model designation |
| Comm Mode | `?M` | `CM0`-`CM2` | Communication mode |
| Play Time | `?A` | 10-digit | Total play time |
| Disc Status | `?K` | 8 characters | Disc status flags |

### 2.4 Player Modes

| Code | Mode | Description |
|------|------|-------------|
| `P01` | Park | CD loaded, motor off |
| `P02` | Set Up | TOC being read |
| `P03` | Reject | Motor stopping |
| `P04` | Play | Playback in progress |
| `P06` | Pause | Paused |
| `P07` | Search | Searching |
| `P08` | Scan | Scanning |
| `P20` | Disc Unset | No CD loaded |
| `P21` | Load | CD being retrieved from magazine |
| `P22` | Unload | CD being returned to magazine |

### 2.5 Error Codes

| Code | Error | Description |
|------|-------|-------------|
| `E00` | Communication | Serial communication error |
| `E04` | Function | Function not available |
| `E05` | Argument | Missing or invalid argument |
| `E11` | Disc | Disc not present |
| `E12` | Address | Address error |
| `E13` | Focus | Defocus error |
| `E14` | Spindle | Spindle unlocked |
| `E20` | Panic | Changer panic |
| `E21` | Door | Door open |
| `E22` | Init | Changer initialized |
| `E81`-`E99` | System | Various system errors |

### 2.6 Volume Mapping

The digital volume (0-255) corresponds to the following dB values:

| dB | Value | dB | Value |
|----|-------|----|-------|
| 0 dB | 255 | -30 dB | 138 |
| -1 dB | 247 | -40 dB | 97 |
| -3 dB | 239 | -50 dB | 60 |
| -6 dB | 230 | -60 dB | 16 |
| -10 dB | 213 | -70 dB | 5 |
| -20 dB | 174 | -80 dB | 1 |
| | | Mute | 0 |

---

## 3. Software Architecture

### 3.1 Technology Stack

| Component | Technology | Version |
|-----------|------------|---------|
| Runtime | Node.js | >= 18.x |
| Web Framework | Express | 5.x |
| WebSocket | ws | 8.x |
| Database | better-sqlite3 | 11.x |
| Serial Communication | serialport | 12.x |
| ZIP Archiving | adm-zip | 1.x |
| Frontend | Vanilla JS (SPA) | - |
| Internationalization | Custom i18n solution | DE/EN |

### 3.2 Project Structure

```
cac-controller/
├── server.js                 # Entry point: Express + WebSocket setup
├── package.json              # Dependencies and scripts
├── cac-controller.service    # Systemd unit for autostart
├── src/
│   ├── protocol.js           # Pioneer protocol (commands, parser, constants)
│   ├── serial.js             # Serial connection (queue, auto-reconnect)
│   ├── player.js             # Player manager (polling, state, playback modes)
│   ├── scanner.js            # CD scanner (TOC read, slot scanning)
│   ├── musicbrainz.js        # MusicBrainz API and Cover Art Archive
│   ├── database.js           # SQLite database (schema, CRUD operations)
│   ├── gpio.js               # GPIO relay control (power on/off via pinctrl)
│   ├── routes.js             # REST API routes
│   └── websocket.js          # WebSocket manager (broadcasts)
├── public/
│   ├── index.html            # Single Page Application (HTML)
│   ├── css/
│   │   └── app.css           # Complete styling (dark theme)
│   ├── js/
│   │   ├── app.js            # Frontend logic (state, rendering, events)
│   │   └── i18n.js           # Translations (German/English)
│   └── covers/               # Uploaded cover art images
├── data/
│   └── cac-controller.db     # SQLite database (auto-created)
└── docs/
    └── DOCUMENTATION.md       # This file
```

### 3.3 Module Overview

#### server.js — Entry Point

Initializes all components in the correct order:
1. Initialize database and load settings
2. Configure serial connection
3. Create PlayerManager with serial connection
4. Create CDScanner
5. Start Express server with static files and API routes
6. Start WebSocket server
7. Open serial connection and start polling

Graceful shutdown via SIGINT/SIGTERM: stop polling, cleanup GPIO, close serial connection.

#### protocol.js — Pioneer Protocol

Contains the complete protocol definition:

- **MODELS**: Hardware properties per model (baud rate, capacity, features)
- **SERIAL_CONFIG**: Communication parameters (8N1, terminator, timeouts)
- **CMD**: All 27 execution commands as constants
- **QUERY**: All 14 query commands as constants
- **PLAYER_MODES**: Mapping P01-P22 to readable labels
- **ERRORS**: Error codes E00-E99 with descriptions
- **VOLUME_MAP**: dB-to-value mapping
- **buildCommand()**: Generates formatted command strings
- **parseResponse()**: Parses incoming responses into typed objects

The parser automatically recognizes: error codes, job status, player mode, disc number, track number, time code, block number, TOC info, model name, disc status, and more.

#### serial.js — Serial Connection

Manages the physical connection to the changer:

- **Serial Port Detection**: The settings UI offers a dropdown with automatic detection of available serial ports (via a refresh button), instead of requiring manual path entry
- **Connection Management**: Open, close, automatic reconnection every 5 seconds
- **Command Queues**: Separate queue per player (1 and 2), with 200ms delay between commands
- **Priority Commands**: `sendPriority()` for time-critical commands (inserted at front of queue)
- **Response Parser**: Incoming data is buffered via ReadlineParser (CR delimiter) and distributed via events
- **Event-based**: Emits `connected`, `disconnected`, `error`, `response`, and `playerResponse`

The fire-and-forget architecture completely decouples sent commands from received responses. The PlayerManager reacts to incoming responses regardless of which command triggered them.

#### player.js — Player Manager

Central module for controlling both CD players:

**State Management:**
- Per player: mode, disc, track, time (disc-elapsed and track-relative), volume, speed, TOC, error
- Interpolated time display: The Pioneer delivers time codes only ~1x/second. The frontend interpolates for smooth display.

**Polling:**
- Player mode: every 850ms (player 1) / 900ms (player 2)
- Time code: every 1000ms / 1050ms
- Track: every 1000ms / 1100ms
- Disc: every 5000ms / 5500ms
- TOC: every 10000ms / 10500ms
- Staggered intervals avoid collisions on the serial bus

**Playback Modes:**

*Continuous Play:*
When the last track of a CD ends (mode changes from P04 to P01/P03/P06 AND the last known track was the last track according to TOC), the other player is automatically started.

*Gapless Play:*
When the current track is the last on the CD, the other player is prepared via auto-cue (`SA` + `TR01SE`). On disc end, it is immediately started (`PL`).

*Shuffle:*
- `cd`: Random track on the current CD (with history to avoid repeats)
- `players`: Random track from both loaded CDs
- `all`: Load and play a random CD from the entire library

*Playlists:*
Server-side playlist engine with intelligent dual-player management:
- Automatically selects the optimal player (prefers the one with the correct CD)
- Pre-loads the next CD into the idle player (pre-loading)
- Detects automatic track advancement and matches it against the playlist
- Stops the previous player when switching
- Guard against double-advancement during fast mode transitions

**Play Duration Tracking:**
- When playback starts (mode changes to P04), a `play_history` entry is created and the start timestamp is recorded
- On track change during playback, the previous entry is finalized (duration calculated) and a new one is created
- When playback stops (mode changes from P04), the current entry is finalized
- The actual play duration (`duration_played`) is stored in seconds in the database

#### scanner.js — CD Scanner

Scans slots in the changer and reads the TOC (Table of Contents):

**Scan Process per Slot:**
1. Load CD (`<slot>ZS`)
2. Wait for mode P01/P02/P04/P06 (disc loaded)
3. Start playback (`SA`) for TOC access
4. Wait 3 seconds (spin-up)
5. Query TOC (`?Q`), up to 3 attempts
6. Generate track stubs (Track 1..N with placeholder titles)
7. Write data to database
8. Stop disc and return to magazine (`RJ` + `ZR`)

**Additional Functions:**
- `scanRange(start, end)`: Scans a range of slots sequentially
- `scanAll(maxDiscs)`: Scans all slots
- `abort()`: Aborts the running scan
- `lookupMetadata()` / `applyMetadata()`: MusicBrainz integration
- Real-time progress via EventEmitter (broadcast to all clients via WebSocket)

**Important:** During scanning, polling for the affected player is paused to avoid conflicts on the serial bus.

#### musicbrainz.js — MusicBrainz Integration

Fetches metadata from the MusicBrainz API and cover art from the Cover Art Archive:

**Rate Limiting:** Minimum 1.1 seconds between requests (MusicBrainz allows max 1 request/second)

**Search Options:**
- Free-text search (artist, album, etc.)
- Search by artist + album title
- Search by barcode/EAN
- Search by track count and total duration (for Pioneer scanner without track offsets)
- Lookup by disc ID (SHA-1 from TOC offsets)
- Lookup by TOC sectors (fuzzy matching)

**Metadata Mapping:**
MusicBrainz data is converted to the internal format:
- Release -> CD (title, artist, year, genre, label, country, barcode)
- Recording -> Track (title, artist, duration)
- Cover Art Archive -> cover URL

#### database.js — SQLite Database

Uses better-sqlite3 for synchronous, high-performance database access.

**Schema:**

```sql
cds (
  slot INTEGER PRIMARY KEY,    -- 1-500
  disc_id TEXT,                -- MusicBrainz Disc ID
  title TEXT,                  -- Album title
  artist TEXT,                 -- Artist
  year TEXT,                   -- Release year
  genre TEXT,                  -- Genre
  total_tracks INTEGER,        -- Number of tracks
  total_duration_seconds INTEGER, -- Total duration
  cover_url TEXT,              -- Path to cover image
  notes TEXT,                  -- User notes
  musicbrainz_release_id TEXT, -- MusicBrainz Release ID
  barcode TEXT,                -- EAN/Barcode
  label TEXT,                  -- Record label
  country TEXT,                -- Country of origin
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

**Additional Operations:**
- `moveCD(fromSlot, toSlot)` — Moves a CD with all related data (tracks, ratings, favorites, play history) in a single transaction
- `bulkUpdateField(field, oldValue, newValue)` — Updates a field value (year/genre/label) across all affected CDs

**Default settings** are automatically created on first start (model, port, baud rate, polling intervals, language, MusicBrainz configuration, Hub/Network settings, statistics minimum play duration).

The `duration_played` column in `play_history` stores the actual play duration in seconds. The `stats_min_seconds` threshold (default: 30) determines the minimum duration for a track to count in statistics.

#### gpio.js — GPIO Relay Control

Controls a relay via a configurable GPIO pin to power the CAC unit on/off:

- Uses `pinctrl` (pre-installed on every Raspberry Pi OS) — no additional npm packages required
- GPIO pin is configured in settings (`gpio_relay_pin`). Empty = disabled
- Active HIGH: `pinctrl set <pin> dh` = relay ON, `pinctrl set <pin> dl` = relay OFF
- Power button only appears in the UI when a pin is configured
- On shutdown, the pin is set to LOW (relay OFF)

#### routes.js — REST API

Defines all HTTP endpoints:

- **API Key Middleware**: Global middleware on `/api/*` — when an `X-API-Key` header (or `?apikey=` parameter) is present, it is validated against the stored key. This allows a Hub to remotely control all endpoints. Local browser clients without an API key pass through unchanged.
- **Node API** (2 endpoints): `/api/node/info` and `/api/node/status` — Hub-specific convenience endpoints (require API key)
- **Player Control** (17 endpoints): Load, Eject, Play, Pause, Stop, Track, Next, Previous, Scan Forward/Reverse, Volume, Speed, Fade, Cue Search, Stop Marker, Reset, Raw Command
- **Library** (6 endpoints): CRUD for CDs, bulk delete, track update
- **Cover Upload**: Base64-encoded images (max 2MB), automatic detection of JPEG/PNG/WebP
- **MusicBrainz** (3 endpoints): Search, release details, apply metadata
- **Scanner** (4 endpoints): Start scan, scan all, abort, progress
- **Playlists** (10 endpoints): CRUD, add/remove items, reorder, play
- **Power/GPIO** (3 endpoints): `GET /api/power/status`, `POST /api/power/on`, `POST /api/power/off` — relay control via configurable GPIO pin (uses `pinctrl`)
- **Favorites, Ratings, History, Search, Statistics, Settings, Play Modes**
- **Statistics** (2 endpoints): `GET /api/stats` (top tracks with covers, top CDs, top artists, genre distribution, activity chart), `DELETE /api/stats/reset` (reset play history). Respects the configurable `stats_min_seconds` threshold.
- **Backup** (4 endpoints): `GET /api/backup` (full database export as JSON), `POST /api/backup` (database import from JSON backup), `GET /api/backup/covers` (export all cover images as ZIP), `POST /api/backup/covers` (import covers from ZIP upload)
- **Library Editor** (2 endpoints): `POST /api/library/bulk-update-field` (bulk rename/delete field value across all CDs), `POST /api/library/:slot/move` (move CD to different slot with cascading updates to tracks, ratings, favorites, play history)
- **Playlist Reorder**: `PUT /api/playlists/:id/reorder` — Drag-and-drop reordering with temporary position clearing (UNIQUE constraint safe)
- **JSON Import**: Supports various formats, automatic field mapping, track deduplication

#### websocket.js — WebSocket Manager

Manages all WebSocket connections and forwards events:

- **Local clients**: Connect via `ws://host:port` — receive initial state and all broadcasts
- **Hub clients**: Connect via `ws://host:port/?hub=1&apikey=<key>` — API key is validated, on success a `hubInit` message is sent with node name, room, model, and current state
- Forwards: Player state changes, scanner progress, play mode changes, continuous switch, playlist updates, serial events
- Broadcast to all connected clients (local + hub)

---

## 4. Frontend

### 4.1 Structure

The frontend is a Single Page Application (SPA) without build tools or frameworks:

- **index.html**: Complete HTML with all views (Player with power button, Library, Favorites with filter tabs, Playlists, Ratings, History, Statistics, Scanner, CD Library Editor, Settings, Terminal)
- **app.js**: All application logic (state, rendering, event handlers, API calls, WebSocket connection)
- **i18n.js**: Translation system with ~200 key-value pairs for German and English
- **app.css**: Complete styling in dark theme with CSS Custom Properties

### 4.2 Internationalization (i18n)

The translation system works on three levels:

1. **HTML Attributes**: `data-i18n="key"` for text content, `data-i18n-placeholder="key"` for placeholders, `data-i18n-title="key"` for tooltips
2. **JavaScript**: `t('key')` function for dynamically generated text
3. **Server Messages**: The scanner sends structured objects `{ key: 'scan.loading', slot: 42 }`, which are translated in the frontend

Language switching: Automatic (system language), German, or English. On change, all visible texts are immediately updated.

### 4.3 Real-time Updates

The WebSocket connection delivers all changes in real-time:

- **Player Status**: Mode, track, disc (immediately on change)
- **Time Display**: The Pioneer delivers time ~1x/second. The frontend interpolates client-side for smooth display (1 update/second via `setInterval`).
- **Scanner Progress**: Slot, status, error messages
- **Playlist Status**: Current index, player assignment
- **Connection Status**: Serial connected/disconnected

### 4.4 CD Library Editor

The CD Library Editor (under "More") enables full inline editing of all CD metadata:

**Editable Fields:**
- **Slot** — Changeable with automatic migration of all related data (tracks, ratings, favorites, play history)
- **Title, Artist, Notes** — Inline text fields with immediate save (fire-and-forget)
- **Year, Label, Genre** — Custom combobox component with search, 47 preset genres and 71 preset labels

**Combobox Component:**
- Replaces native `<select>` elements for searchable dropdowns
- Multi-character typeahead search (not just single character like native selects)
- Recently used values shown at top (max 5 per field)
- Custom values can be added inline (no browser prompts)
- Keyboard navigation: arrow keys, Enter, Escape

**Value Management:**
- Rename a value (e.g., genre "Rock" to "Rock/Pop") with automatic bulk update of all affected CDs
- Delete a value with bulk update via `POST /api/library/bulk-update-field`

**Filtering and Sorting:**
- Filter bar: Slot (number), Title (text), Artist (text), Year/Label/Genre (dropdown with "no value" option)
- Sort by slot, title, artist, year, label, or genre (ascending/descending)
- Result count displayed live

**Display:**
- Two-line card layout per CD with cover thumbnail
- Green flash on successful save

### 4.5 Cover Upload

Cover images are processed client-side:
1. File selection or drag & drop
2. Preview in browser
3. Automatic resizing via Canvas API (max 500x500 pixels)
4. Conversion to JPEG (quality 85%)
5. Base64-encoded upload via REST API
6. Server saves to `public/covers/cover_<slot>.jpg`

---

## 5. Data Flow

### 5.1 Player Control (e.g., pressing "Play")

```
Browser                   Server                    Changer
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

### 5.2 CD Scanning

```
Browser                   Server                    Changer
   │ POST /api/scanner/scan  │                          │
   │ { slot: 42 }            │                          │
   │────────────────────────>│                          │
   │                         │  "1PS042ZS\r"            │
   │                         │─────────────────────────>│
   │  WS: scanProgress       │                          │
   │  { status: 'loading' }  │                          │
   │<════════════════════════│                          │
   │                         │  (waiting for P01/P02...)│
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
   │  { status: 'scanned',   │   45:00 total duration)  │
   │    totalTracks: 12 }    │                          │
   │<════════════════════════│                          │
   │                         │  "1PSRJ\r" + "1PSZR\r"  │
   │                         │─────────────────────────>│
```

### 5.3 Playlist Playback with Dual Player

```
Playlist: [Slot 42/Track 3, Slot 101/Track 1, Slot 42/Track 7]

Step 1: Load CD 42 into Player 1, play Track 3
        Simultaneously: Load CD 101 into Player 2 (pre-load)

Step 2: CD 101 is already loaded in Player 2
        Stop Player 1, play Track 1 on Player 2
        Player 1 still has CD 42 (no pre-load needed)

Step 3: CD 42 is still in Player 1
        Stop Player 2, play Track 7 on Player 1
```

---

## 6. Database Details

### 6.1 WAL Mode

The database uses WAL (Write-Ahead Logging) for better performance with concurrent reads and writes.

### 6.2 UPSERT Logic

CDs are inserted or updated via `upsertCD()`. COALESCE ensures that only provided fields are updated — existing values are preserved when arguments are NULL.

### 6.3 Track Deduplication

During JSON import, tracks are deduplicated via Map before being written to the database. This prevents UNIQUE constraint violations from duplicate track numbers in source data.

### 6.4 Cascading Deletes

`ON DELETE CASCADE` on tracks -> cds ensures that deleting a CD automatically removes all associated tracks. Cover files are separately deleted via `deleteCoversForSlot()`.

---

## 7. JSON Import

### 7.1 Supported Formats

The import automatically recognizes various JSON structures:

```json
// Format 1: Array of CDs
[
  { "slot": 1, "title": "Album", "artist": "Artist", "tracks": [...] },
  ...
]

// Format 2: Object with cds array
{
  "cds": [ { "slot": 1, ... }, ... ]
}

// Format 3: Object with slot keys
{
  "1": { "title": "Album", ... },
  "2": { "title": "Album 2", ... }
}
```

### 7.2 Field Mapping

The import supports various field names:

| Internal Field | Accepted Names |
|----------------|----------------|
| slot | `slot`, `cd_number`, `slotNumber`, `nr` |
| title | `title`, `album`, `name` |
| artist | `artist`, `album_artist`, `albumArtist` |
| year | `year`, `release_date`, `releaseDate` |
| total_duration | `total_duration_seconds`, `totalDuration`, `album_length` (MM:SS) |
| track.title | `title`, `track_title`, `name` |
| track.duration | `duration_seconds`, `durationSeconds`, `track_length` (MM:SS), `duration` (MM:SS) |

### 7.3 Preview UI

Before the actual import, an editable preview is displayed:
- Each CD as a row with slot number, title, artist, tracks, duration
- Status badges: New / Update / Warning
- Editable slot numbers (with automatic swap on duplicates)
- Checkbox per CD (deselect individually)
- Mojibake repair button (detects and repairs double-encoded UTF-8 sequences)

---

## 8. Deployment

### 8.1 Systemd Service

The included `cac-controller.service` starts the application on boot:

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

### 8.2 Serial Port Permissions

The user must be a member of the `dialout` group:
```bash
sudo usermod -a -G dialout pi
```

### 8.3 WiFi Optimization

Recommended: Disable WiFi power saving to avoid latency:
```bash
sudo iw wlan0 set power_save off
```

---

## 9. Security

### 9.1 Local Web Interface

- **No Authentication**: The web interface is accessible without login (designed for LAN use only)
- **No HTTPS**: Communication is unencrypted

### 9.2 Hub/Node API Authentication

- All `/api/*` endpoints support optional **API key authentication**
- Hub sends `X-API-Key` header (or `?apikey=` query parameter)
- The key is validated against the `node_api_key` stored in settings
- With a valid key, the Hub has **full access to all functions** (library, playlists, scanner, settings, etc.)
- Without an API key, only local browser requests pass through (existing behavior)
- Hub WebSocket connections also require a valid API key: `ws://host:port/?hub=1&apikey=<key>`

### 9.3 Recommendations

- Firewall rule: Allow access only from the local network
- No port forwarding to the internet
- API key should be sufficiently long and random (the UI generates 32-character alphanumeric keys)
- If needed: Nginx as reverse proxy with Basic Auth or client certificates

---

## 10. Hub/Node Architecture (Multi-Changer)

### 10.1 Concept

Each CAC Controller instance runs as a standalone **Node** on a Raspberry Pi. An optional **Hub** can connect to multiple Nodes across the network, providing a central dashboard for monitoring and control.

```
                    ┌──────────────────┐
                    │   Hub (central)   │
                    │   Dashboard App   │
                    └───┬────┬────┬────┘
          REST API +    │    │    │    REST API +
          WebSocket     │    │    │    WebSocket
        ┌───────────────┘    │    └───────────────┐
        v                    v                    v
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│  Living Room  │  │    Studio     │  │      Bar      │
│ (RPi + V3000) │  │ (RPi + V5000) │  │ (RPi + V180M) │
└───────────────┘  └───────────────┘  └───────────────┘
```

**Important:** Each Node remains 100% standalone. The Hub is optional and merely adds a central management layer.

### 10.2 Authentication

- Each Node generates an **API key** (32-character alphanumeric) in the settings
- The Hub authenticates with each API call via the `X-API-Key` header
- With a valid key, the Hub has **full access to all functions**: library CRUD, playlists, scanner, MusicBrainz, favorites, ratings, history, settings, player control — everything

### 10.3 Hub REST API

The Hub can call any `/api/*` endpoint (with API key). Additionally, there are two Hub-specific convenience endpoints:

| Endpoint | Description |
|----------|-------------|
| `GET /api/node/info` | Node metadata (name, room, model, stats, player status) |
| `GET /api/node/status` | Live status (players, scanner, serial connection) |

### 10.4 Hub WebSocket

Hub clients connect via `ws://host:port/?hub=1&apikey=<key>`. On successful authentication, they receive:

1. A `hubInit` message with node name, room, model, and current state
2. All regular broadcast messages (player state, scanner progress, etc.)

### 10.5 Settings

Three new settings in the Settings tab under "Hub / Network":

| Setting | Description |
|---------|-------------|
| Node Name | Display name for this node (e.g., "Living Room") |
| Room | Room or location identifier |
| API Key | Shared secret for Hub authentication |

---

## 11. Known Limitations

1. **No Track Offsets via Serial Interface**: The Pioneer only provides the total CD duration and track count. Individual track lengths are not transmitted via TOC. Therefore, scanned CDs can only receive accurate track durations via MusicBrainz lookup.

2. **Mechanical Speed**: Loading a CD takes 10-30 seconds (robotic arm). A full scan of all 300 slots therefore takes several hours.

3. **No Audio Streaming**: The application controls the changer's playback — the audio output is analog on the device itself. No digital audio streaming takes place.

---

## 12. License

MIT License — Copyright (c) 2025 Dirk Jensen — see [LICENSE](../LICENSE).

---

*CAC Controller v1.0.0 — Copyright (c) 2025 Dirk Jensen*
*Based on the Pioneer CAC-V3000 Programming Manual (Version 2.0, May 1993)*
*MIT License*
