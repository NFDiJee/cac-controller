# CAC Controller

A premium web-based controller for **Pioneer CAC-V3000 / V3200 / V5000 / V180M** commercial CD autochangers.

Control your Pioneer CD autochanger from any device on your network through a modern, mobile-first web interface. Built with Node.js and designed to run headless on a Raspberry Pi.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.x-green.svg)
![Platform](https://img.shields.io/badge/platform-Raspberry%20Pi%20%7C%20Linux-lightgrey.svg)

## Overview

The CAC Controller turns a Pioneer CD autochanger into a network-controllable music server. It communicates via RS-232C serial protocol, provides a real-time web interface over WebSocket, and maintains a full CD library database with metadata from MusicBrainz.

```
Browser (Phone / Tablet / PC)
    |
    | HTTP + WebSocket (LAN/WLAN)
    v
Node.js Server (Raspberry Pi)          <--- Optional: Hub (central dashboard)
    |                                        connects via REST API + WebSocket
    | RS-232C Serial (9600 baud, 8N1)        using API key authentication
    v
Pioneer CAC CD Autochanger
```

### Multi-Changer Architecture (Hub/Node)

Each CAC Controller instance runs as a standalone **Node**. An optional **Hub** can connect to multiple Nodes across the network for centralized monitoring and control. Each Node remains fully functional on its own — the Hub is purely additive.

```
                    ┌──────────────────┐
                    │    Hub (central)  │
                    │   Dashboard App   │
                    └───┬────┬────┬────┘
          REST API +    │    │    │    REST API +
          WebSocket     │    │    │    WebSocket
        ┌───────────────┘    │    └───────────────┐
        v                    v                    v
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│  Node: Living │  │  Node: Studio │  │  Node: Bar    │
│  Room (RPi)   │  │    (RPi)      │  │    (RPi)      │
│  CAC-V3000    │  │  CAC-V5000    │  │  CAC-V180M    │
└───────────────┘  └───────────────┘  └───────────────┘
```

## Features

### Player Control
- **Dual Player Support** - Independent control of both CD players (V3000/V3200/V5000)
- **Full Protocol Implementation** - All 27 execution commands and 14 query commands
- **Real-time Status** - Live updates via WebSocket for player mode, track number, elapsed time, and disc number
- **Volume Control** - Digital attenuator with 256 steps (0 to -80 dB)
- **Speed Control** - Playback speed adjustment from 90% to 110%
- **Fade** - Programmable volume fades with configurable duration

### Playback Modes
- **Continuous Play** - Automatic crossover between both players when a disc ends
- **Gapless Play** - Pre-cues the other player for seamless transitions between discs
- **Shuffle** - Three modes: current CD, both players, or the entire changer (random disc loading)
- **Playlists** - Server-side playlist engine with intelligent dual-player management, CD pre-loading, and drag-and-drop reordering

### CD Library
- **SQLite Database** - Persistent storage for all CD metadata, tracks, playlists, favorites, ratings, and play history
- **MusicBrainz Integration** - Search by artist, album, barcode, or disc TOC; automatic metadata and cover art download
- **Cover Art** - Upload custom covers (JPEG/PNG/WebP), client-side resize, or automatic download from Cover Art Archive
- **JSON Import** - Import existing CD databases with preview/edit UI, slot reassignment, mojibake repair, and format auto-detection
- **Advanced Filtering** - Filter by genre, artist, year, or label; sort by multiple criteria
- **Search** - Full-text search across all CDs and tracks
- **Bulk Operations** - Select mode with checkboxes for batch deletion

### CD Scanner
- **Single Slot Scan** - Load a disc, read its TOC (track count, total duration), and catalog it
- **Range Scan** - Batch-scan any range of slots with real-time progress via WebSocket
- **Full Scan** - Scan all slots (up to 300 or 500 depending on model)
- **Abort** - Cancel a running scan at any time

### Additional Features
- **Favorites** - Mark individual tracks or entire CDs as favorites
- **Ratings** - 1-5 star rating system for tracks and CDs with filterable views
- **Play History** - Automatic tracking of all played tracks with timestamps and actual play duration
- **Play Statistics** - Top tracks, top CDs, top artists, genre distribution, and activity charts with configurable minimum play duration threshold
- **Backup / Restore** - Full database export and import as JSON (CDs, tracks, playlists, favorites, ratings, play history, settings)
- **Serial Terminal** - Direct serial command interface for debugging and advanced control
- **Bilingual UI** - German and English, auto-detected from system locale or manually selectable
- **Mobile PWA** - Responsive design, installable on home screen, works in fullscreen
- **Systemd Service** - Runs headless on Raspberry Pi, auto-starts on boot, auto-reconnects serial port

## Supported Hardware

| Model | Capacity | Players | Baud Rate | Volume | Speed |
|-------|----------|---------|-----------|--------|-------|
| CAC-V3000 | 300 CDs | 2 | 9600 / 4800 | Yes | Yes |
| CAC-V3200 | 300 CDs | 2 | 9600 / 4800 | Yes | Yes |
| CAC-V5000 | 500 CDs | 2 | 9600 / 4800 | Yes | Yes |
| CAC-V180M | 18 CDs | 1 | 4800 | No | No |

### Hardware Requirements

- **Raspberry Pi** (Zero W, Zero 2 W, 3, 4, or 5) or any Linux system
- **USB-to-Serial adapter** (RS-232C, e.g., FTDI FT232R or similar)
- **Serial cable** with 15-pin D-Sub connector (RS-232C) to the Pioneer CAC changer
- **Network** connection (WLAN or Ethernet)

### Software Requirements

- **Node.js** >= 18.x (20 LTS recommended)
- **npm** (included with Node.js)
- **Build tools** for native SQLite module: `build-essential`, `python3`

## Quick Start

```bash
git clone https://github.com/NFDiJee/cac-controller.git
cd cac-controller
npm install
npm start
```

Open `http://<your-ip>:3000` in any browser.

## Installation on Raspberry Pi

See [INSTALL.md](INSTALL.md) for detailed step-by-step instructions including:
- Node.js and build tools setup
- Serial port permissions
- Systemd service configuration
- PWA installation on smartphones
- Troubleshooting guide

## Configuration

All settings are configurable via the web UI under **More > Settings**:

| Setting | Default | Description |
|---------|---------|-------------|
| Serial Port | `/dev/ttyUSB0` | Path to the USB-serial adapter |
| Baud Rate | `9600` | 9600 for V3000/V3200/V5000, 4800 for V180M |
| Model | `CAC-V3000` | Your Pioneer changer model |
| Max Discs | `300` | Maximum slot count (300 or 500) |
| Web Port | `3000` | HTTP server port |
| Language | `auto` | Auto-detect, German, or English |
| Stats Min Seconds | `30` | Minimum play duration (seconds) for a track to count in statistics |

### Hub / Network Settings

These settings enable a central Hub to discover, monitor, and control this Node remotely. All fields are optional — the controller works fully standalone without them.

| Setting | Default | Description |
|---------|---------|-------------|
| Node Name | *(empty)* | Display name for this node (e.g., "Living Room") |
| Room | *(empty)* | Room or location identifier |
| API Key | *(empty)* | Shared secret for Hub authentication (generate via UI) |

When an API key is set, the Hub can authenticate via `X-API-Key` header (or `?apikey=` query parameter) and gains **full access to all API endpoints** — including library editing, playlists, scanner, settings, and everything else.

### MusicBrainz Settings

To use MusicBrainz metadata lookup, you must register your own application credentials:

| Setting | Description |
|---------|-------------|
| App Name | Your application name (e.g., "MyCACController") |
| Version | Application version (e.g., "1.0") |
| Contact | Your email address (required by MusicBrainz ToS) |

## REST API

The server exposes a full REST API for programmatic control:

### Player Control
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/player/:id/state` | Get player status |
| `POST` | `/api/player/:id/play` | Start playback |
| `POST` | `/api/player/:id/pause` | Pause playback |
| `POST` | `/api/player/:id/stop` | Stop playback |
| `POST` | `/api/player/:id/load` | Load disc `{ disc, track }` |
| `POST` | `/api/player/:id/eject` | Eject and return disc |
| `POST` | `/api/player/:id/next` | Next track |
| `POST` | `/api/player/:id/previous` | Previous track |
| `POST` | `/api/player/:id/track/:num` | Play specific track |
| `POST` | `/api/player/:id/volume` | Set volume `{ value: 0-255 }` |
| `POST` | `/api/player/:id/speed` | Set speed `{ value: 90-110 }` |
| `POST` | `/api/player/:id/fade` | Fade `{ target, duration }` |
| `POST` | `/api/player/:id/raw` | Send raw command `{ command }` |
| `GET` | `/api/player/states` | Get all player states |

### Library
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/library` | List all CDs with tracks |
| `GET` | `/api/library/:slot` | Get single CD |
| `PUT` | `/api/library/:slot` | Update CD metadata |
| `DELETE` | `/api/library/:slot` | Delete CD and covers |
| `POST` | `/api/library/bulk-delete` | Delete multiple `{ slots: [...] }` |
| `POST` | `/api/library/:slot/cover` | Upload cover (base64) |
| `GET` | `/api/search?q=...` | Search library |

### MusicBrainz
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/musicbrainz/search?q=...` | Search releases |
| `GET` | `/api/musicbrainz/release/:id` | Get release details |
| `POST` | `/api/musicbrainz/apply/:slot` | Apply metadata to slot |

### Playlists
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/playlists` | List all playlists |
| `POST` | `/api/playlists` | Create playlist |
| `GET` | `/api/playlists/:id` | Get playlist with items |
| `PUT` | `/api/playlists/:id` | Update playlist |
| `DELETE` | `/api/playlists/:id` | Delete playlist |
| `POST` | `/api/playlists/:id/play` | Start playlist playback |
| `POST` | `/api/playlists/stop` | Stop playlist |
| `PUT` | `/api/playlists/:id/reorder` | Reorder items `{ itemIds: [...] }` |

### Statistics
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/stats` | Play statistics (top tracks, CDs, artists, genres, activity) |
| `DELETE` | `/api/stats/reset` | Reset all play history |

### Backup
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/backup` | Export full database as JSON |
| `POST` | `/api/backup` | Import database from JSON backup |

### Node API (Hub Communication)

These endpoints require API key authentication (`X-API-Key` header). They provide convenience aggregations for Hub discovery and monitoring.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/node/info` | Node info (name, room, model, stats, players) |
| `GET` | `/api/node/status` | Live status (players, scanner, serial) |

> **Note:** When authenticated with an API key, the Hub can access **all** endpoints listed above (library, playlists, scanner, settings, etc.) — not just the `/api/node/*` routes. The API key middleware applies globally to all `/api/*` routes.

### Other
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/favorites` | List favorites |
| `POST` | `/api/favorites/toggle` | Toggle favorite |
| `GET` | `/api/ratings` | List ratings |
| `POST` | `/api/ratings` | Set/remove rating |
| `GET` | `/api/history` | Play history |
| `GET` | `/api/stats` | Library statistics |
| `GET/PUT` | `/api/settings` | Get/update settings |
| `GET/PUT` | `/api/playmodes` | Get/set play modes |
| `POST` | `/api/import` | Import JSON data |
| `POST` | `/api/scanner/scan` | Start scan |
| `POST` | `/api/scanner/abort` | Abort scan |

### WebSocket

Connect to `ws://<host>:3000` for real-time updates.

**Hub WebSocket:** Connect to `ws://<host>:3000/?hub=1&apikey=<your-key>` for authenticated hub connections. Hub clients receive a `hubInit` message with node metadata on connection, plus all regular broadcast messages.

| Message Type | Direction | Description |
|--------------|-----------|-------------|
| `init` | Server -> Client | Initial state on connection |
| `hubInit` | Server -> Hub | Node info + initial state (hub connections only) |
| `playerState` | Server -> Client | Player status change |
| `scanProgress` | Server -> Client | Scan progress update |
| `scanComplete` | Server -> Client | Scan finished |
| `playModeChange` | Server -> Client | Play mode changed |
| `continuousSwitch` | Server -> Client | Automatic player switch |
| `playlistUpdate` | Server -> Client | Playlist state change |
| `playlistComplete` | Server -> Client | Playlist finished |
| `serialConnected` | Server -> Client | Serial port connected |
| `serialDisconnected` | Server -> Client | Serial port lost |
| `serialError` | Server -> Client | Serial communication error |
| `serialResponse` | Server -> Client | Raw serial response (for terminal) |

## Project Structure

```
cac-controller/
├── server.js                 # Express + WebSocket server entry point
├── package.json
├── cac-controller.service    # Systemd unit file
├── src/
│   ├── database.js           # SQLite database (better-sqlite3)
│   ├── serial.js             # Serial port connection with auto-reconnect
│   ├── protocol.js           # Pioneer CAC serial protocol (commands, queries, parser)
│   ├── player.js             # Player manager (polling, state, continuous/gapless/shuffle/playlist)
│   ├── scanner.js            # CD scanner (TOC read, slot scanning)
│   ├── musicbrainz.js        # MusicBrainz API + Cover Art Archive integration
│   ├── routes.js             # Express REST API routes
│   └── websocket.js          # WebSocket manager (broadcasts state changes)
├── public/
│   ├── index.html            # Single-page application
│   ├── css/
│   │   └── app.css           # Full application styles (dark theme)
│   ├── js/
│   │   ├── app.js            # Frontend application logic
│   │   └── i18n.js           # Internationalization (DE/EN)
│   └── covers/               # Uploaded cover art images
├── data/
│   └── cac-controller.db     # SQLite database (auto-created)
├── INSTALL.md                # Raspberry Pi installation guide
├── LICENSE                   # MIT License
└── README.md                 # This file
```

## Database Schema

The SQLite database contains the following tables:

- **cds** - CD metadata (slot, title, artist, year, genre, cover, MusicBrainz ID, barcode, label, country)
- **tracks** - Track metadata (title, artist, duration, ISRC)
- **playlists** / **playlist_items** - User-created playlists
- **play_history** - Automatic play tracking with duration measurement
- **favorites** - Favorited tracks and CDs
- **ratings** - 1-5 star ratings
- **settings** - Application configuration (key-value store)

## Pioneer Serial Protocol

This project implements the complete Pioneer CAC serial protocol as documented in the official Programming Manual (Version 2.0, May 1993).

### Communication Parameters
- **Baud Rate**: 9600 (V3000/V3200/V5000) or 4800 (V180M)
- **Data Bits**: 8
- **Stop Bits**: 1
- **Parity**: None
- **Terminator**: CR (`\r`)
- **Max Command Length**: 20 characters

### Command Format
All commands are prefixed with the player ID and `PS` (Player Select):
```
<player_id>PS<command>\r
```
Example: `1PS001ZSPL\r` selects player 1, loads disc 001, and starts playback.

### Supported Commands
- **27 Execution Commands**: Player select, disc select/return, start, reject, play, pause, scan, search, stop marker, auto-cue, volume, speed, fade, and more
- **14 Query Commands**: Player mode, disc number, track number, time code, TOC info, model name, disc status, and more

## Updating

```bash
cd /opt/cac-controller
git pull
npm install
sudo systemctl restart cac-controller
```

## Uninstalling

```bash
sudo systemctl stop cac-controller
sudo systemctl disable cac-controller
sudo rm /etc/systemd/system/cac-controller.service
sudo systemctl daemon-reload
sudo rm -rf /opt/cac-controller
```

## License

MIT License - See [LICENSE](LICENSE) for details.

## Acknowledgments

- Protocol documentation based on the official **Pioneer CAC-V3000 Programming Manual** (Version 2.0, May 1993)
- Inspired by the [CCC project](https://github.com/duprej/ccc) by Jonathan Dupre
- Uses [MusicBrainz API](https://musicbrainz.org/) for metadata lookup
- Uses [Cover Art Archive](https://coverartarchive.org/) for album artwork

## Disclaimer

This is an independent open-source project. It is not affiliated with, endorsed by, or connected to Pioneer Corporation or any of its subsidiaries. "Pioneer" and "CAC" are trademarks of Pioneer Corporation.
