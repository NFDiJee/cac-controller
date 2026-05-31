import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

let db;

export function initDatabase() {
  mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(join(DATA_DIR, 'cac-controller.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  createTables();
  return db;
}

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cds (
      slot INTEGER PRIMARY KEY CHECK(slot >= 1 AND slot <= 500),
      disc_id TEXT,
      title TEXT DEFAULT '',
      artist TEXT DEFAULT '',
      year TEXT DEFAULT '',
      genre TEXT DEFAULT '',
      total_tracks INTEGER DEFAULT 0,
      total_duration_seconds INTEGER DEFAULT 0,
      cover_url TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      musicbrainz_release_id TEXT DEFAULT '',
      barcode TEXT DEFAULT '',
      label TEXT DEFAULT '',
      country TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot INTEGER NOT NULL REFERENCES cds(slot) ON DELETE CASCADE,
      track_number INTEGER NOT NULL,
      title TEXT DEFAULT '',
      artist TEXT DEFAULT '',
      duration_seconds INTEGER DEFAULT 0,
      isrc TEXT DEFAULT '',
      UNIQUE(slot, track_number)
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS playlist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      slot INTEGER NOT NULL,
      track_number INTEGER DEFAULT 0,
      position INTEGER NOT NULL,
      UNIQUE(playlist_id, position)
    );

    CREATE TABLE IF NOT EXISTS play_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot INTEGER,
      track_number INTEGER,
      player_id INTEGER DEFAULT 1,
      played_at TEXT DEFAULT (datetime('now')),
      duration_played INTEGER DEFAULT 0,
      session_id TEXT
    );

    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot INTEGER NOT NULL,
      track_number INTEGER DEFAULT 0,
      added_at TEXT DEFAULT (datetime('now')),
      UNIQUE(slot, track_number)
    );

    CREATE TABLE IF NOT EXISTS ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot INTEGER NOT NULL,
      track_number INTEGER DEFAULT 0,
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(slot, track_number)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tracks_slot ON tracks(slot);
    CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist ON playlist_items(playlist_id);
    CREATE INDEX IF NOT EXISTS idx_play_history_played ON play_history(played_at DESC);
    CREATE INDEX IF NOT EXISTS idx_favorites_slot ON favorites(slot);
    CREATE INDEX IF NOT EXISTS idx_ratings_slot ON ratings(slot);
    CREATE INDEX IF NOT EXISTS idx_ratings_rating ON ratings(rating DESC);
  `);

  // Migration: add duration_played column if missing
  const cols = db.prepare("PRAGMA table_info(play_history)").all();
  if (!cols.find(c => c.name === 'duration_played')) {
    db.prepare('ALTER TABLE play_history ADD COLUMN duration_played INTEGER DEFAULT 0').run();
  }
  // Migration: add session_id column if missing
  if (!cols.find(c => c.name === 'session_id')) {
    db.prepare('ALTER TABLE play_history ADD COLUMN session_id TEXT').run();
  }

  // Default settings
  const defaults = {
    model: 'CAC-V3000',
    serial_port: '/dev/ttyUSB0',
    baud_rate: '9600',
    player1_id: '1',
    player2_id: '2',
    active_player: '1',
    poll_interval_mode: '1000',
    poll_interval_track: '2000',
    poll_interval_time: '900',
    poll_interval_disc: '5000',
    web_port: '3000',
    max_discs: '300',
    theme: 'dark',
    mb_app_name: 'CACController',
    mb_app_version: '1.0',
    mb_contact: '',
    node_name: '',
    node_room: '',
    node_api_key: '',
    stats_min_seconds: '30',
    gpio_relay_pin: '',
  };

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(defaults)) {
    insertSetting.run(key, value);
  }
}

// Settings
export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function getStatsMinSeconds() {
  return parseInt(getSetting('stats_min_seconds')) || 30;
}

export function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
}

export function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

// CDs
export function getCD(slot) {
  const cd = db.prepare('SELECT * FROM cds WHERE slot = ?').get(slot);
  if (!cd) return null;
  cd.tracks = db.prepare('SELECT * FROM tracks WHERE slot = ? ORDER BY track_number').all(slot);
  return cd;
}

export function getAllCDs() {
  return db.prepare('SELECT * FROM cds ORDER BY slot').all();
}

export function getCDsWithTracks() {
  const cds = getAllCDs();
  const trackStmt = db.prepare('SELECT * FROM tracks WHERE slot = ? ORDER BY track_number');
  return cds.map(cd => ({ ...cd, tracks: trackStmt.all(cd.slot) }));
}

export function upsertCD(slot, data) {
  const existing = db.prepare('SELECT slot FROM cds WHERE slot = ?').get(slot);
  if (existing) {
    db.prepare(`
      UPDATE cds SET
        disc_id = COALESCE(?, disc_id),
        title = COALESCE(?, title),
        artist = COALESCE(?, artist),
        year = COALESCE(?, year),
        genre = COALESCE(?, genre),
        total_tracks = COALESCE(?, total_tracks),
        total_duration_seconds = COALESCE(?, total_duration_seconds),
        cover_url = COALESCE(?, cover_url),
        notes = COALESCE(?, notes),
        musicbrainz_release_id = COALESCE(?, musicbrainz_release_id),
        barcode = COALESCE(?, barcode),
        label = COALESCE(?, label),
        country = COALESCE(?, country),
        updated_at = datetime('now')
      WHERE slot = ?
    `).run(
      data.disc_id, data.title, data.artist, data.year, data.genre,
      data.total_tracks, data.total_duration_seconds, data.cover_url,
      data.notes, data.musicbrainz_release_id, data.barcode, data.label,
      data.country, slot
    );
  } else {
    db.prepare(`
      INSERT INTO cds (slot, disc_id, title, artist, year, genre, total_tracks,
        total_duration_seconds, cover_url, notes, musicbrainz_release_id, barcode, label, country)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      slot, data.disc_id || '', data.title || '', data.artist || '', data.year || '',
      data.genre || '', data.total_tracks || 0, data.total_duration_seconds || 0,
      data.cover_url || '', data.notes || '', data.musicbrainz_release_id || '',
      data.barcode || '', data.label || '', data.country || ''
    );
  }
  return getCD(slot);
}

export function moveCD(fromSlot, toSlot) {
  const transaction = db.transaction(() => {
    // move tracks
    db.prepare('UPDATE tracks SET slot = ? WHERE slot = ?').run(toSlot, fromSlot);
    // move ratings
    db.prepare('UPDATE ratings SET slot = ? WHERE slot = ?').run(toSlot, fromSlot);
    // move favorites
    db.prepare('UPDATE favorites SET slot = ? WHERE slot = ?').run(toSlot, fromSlot);
    // move play_history
    db.prepare('UPDATE play_history SET slot = ? WHERE slot = ?').run(toSlot, fromSlot);
    // move cd
    db.prepare('UPDATE cds SET slot = ?, updated_at = datetime(\'now\') WHERE slot = ?').run(toSlot, fromSlot);
  });
  transaction();
  return getCD(toSlot);
}

export function bulkUpdateField(field, oldValue, newValue) {
  const allowed = ['year', 'genre', 'label'];
  if (!allowed.includes(field)) throw new Error('Invalid field');
  const stmt = db.prepare(`UPDATE cds SET ${field} = ?, updated_at = datetime('now') WHERE ${field} = ?`);
  const result = stmt.run(newValue, oldValue);
  return result.changes;
}

export function deleteCD(slot) {
  db.prepare('DELETE FROM cds WHERE slot = ?').run(slot);
}

// Tracks
export function setTracks(slot, tracks) {
  const del = db.prepare('DELETE FROM tracks WHERE slot = ?');
  const ins = db.prepare(`
    INSERT INTO tracks (slot, track_number, title, artist, duration_seconds, isrc)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction((slot, tracks) => {
    del.run(slot);
    for (const t of tracks) {
      ins.run(slot, t.track_number, t.title || '', t.artist || '', t.duration_seconds || 0, t.isrc || '');
    }
  });
  transaction(slot, tracks);
}

export function updateTrack(slot, trackNumber, data) {
  db.prepare(`
    UPDATE tracks SET
      title = COALESCE(?, title),
      artist = COALESCE(?, artist),
      duration_seconds = COALESCE(?, duration_seconds),
      isrc = COALESCE(?, isrc)
    WHERE slot = ? AND track_number = ?
  `).run(data.title, data.artist, data.duration_seconds, data.isrc, slot, trackNumber);
}

// Playlists
export function getAllPlaylists() {
  const playlists = db.prepare('SELECT * FROM playlists ORDER BY name').all();
  const itemStmt = db.prepare('SELECT slot, track_number FROM playlist_items WHERE playlist_id = ? ORDER BY position');
  for (const pl of playlists) {
    pl.items = itemStmt.all(pl.id);
  }
  return playlists;
}

export function getPlaylist(id) {
  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
  if (!playlist) return null;
  playlist.items = db.prepare(`
    SELECT pi.*, c.title as cd_title, c.artist as cd_artist,
           t.title as track_title, t.artist as track_artist
    FROM playlist_items pi
    LEFT JOIN cds c ON c.slot = pi.slot
    LEFT JOIN tracks t ON t.slot = pi.slot AND t.track_number = pi.track_number
    WHERE pi.playlist_id = ?
    ORDER BY pi.position
  `).all(id);
  return playlist;
}

export function createPlaylist(name, description) {
  const result = db.prepare('INSERT INTO playlists (name, description) VALUES (?, ?)').run(name, description || '');
  return getPlaylist(result.lastInsertRowid);
}

export function updatePlaylist(id, data) {
  db.prepare(`
    UPDATE playlists SET
      name = COALESCE(?, name),
      description = COALESCE(?, description),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(data.name, data.description, id);
  return getPlaylist(id);
}

export function deletePlaylist(id) {
  db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
}

export function addToPlaylist(playlistId, slot, trackNumber) {
  const maxPos = db.prepare('SELECT MAX(position) as max FROM playlist_items WHERE playlist_id = ?').get(playlistId);
  const position = (maxPos?.max || 0) + 1;
  db.prepare('INSERT INTO playlist_items (playlist_id, slot, track_number, position) VALUES (?, ?, ?, ?)')
    .run(playlistId, slot, trackNumber || 0, position);
  return getPlaylist(playlistId);
}

export function removeFromPlaylist(itemId) {
  db.prepare('DELETE FROM playlist_items WHERE id = ?').run(itemId);
}

export function reorderPlaylist(playlistId, itemIds) {
  const clearPos = db.prepare('UPDATE playlist_items SET position = -(id + 100000) WHERE playlist_id = ?');
  const update = db.prepare('UPDATE playlist_items SET position = ? WHERE id = ? AND playlist_id = ?');
  const transaction = db.transaction(() => {
    clearPos.run(playlistId);
    itemIds.forEach((id, index) => update.run(index + 1, id, playlistId));
  });
  transaction();
  return getPlaylist(playlistId);
}

// Play History
export function addPlayHistory(slot, trackNumber, playerId, sessionId) {
  const result = db.prepare('INSERT INTO play_history (slot, track_number, player_id, session_id) VALUES (?, ?, ?, ?)')
    .run(slot, trackNumber || 0, playerId || 1, sessionId || null);
  return Number(result.lastInsertRowid);
}

export function finalizePlayHistory(id, durationPlayed) {
  if (!id || !durationPlayed || durationPlayed < 0) return;
  db.prepare('UPDATE play_history SET duration_played = ? WHERE id = ?')
    .run(Math.round(durationPlayed), id);
}

export function getPlayHistory(limit = 50) {
  return db.prepare(`
    SELECT ph.*, c.title as cd_title, c.artist as cd_artist,
           t.title as track_title, t.artist as track_artist
    FROM play_history ph
    LEFT JOIN cds c ON c.slot = ph.slot
    LEFT JOIN tracks t ON t.slot = ph.slot AND t.track_number = ph.track_number
    ORDER BY ph.played_at DESC
    LIMIT ?
  `).all(limit);
}

export function clearPlayHistory() {
  db.prepare('DELETE FROM play_history').run();
}

// Favorites
export function getFavorites() {
  return db.prepare(`
    SELECT f.*, c.title as cd_title, c.artist as cd_artist,
           t.title as track_title, t.artist as track_artist
    FROM favorites f
    LEFT JOIN cds c ON c.slot = f.slot
    LEFT JOIN tracks t ON t.slot = f.slot AND t.track_number = f.track_number
    ORDER BY f.added_at DESC
  `).all();
}

export function toggleFavorite(slot, trackNumber) {
  const existing = db.prepare('SELECT id FROM favorites WHERE slot = ? AND track_number = ?')
    .get(slot, trackNumber || 0);
  if (existing) {
    db.prepare('DELETE FROM favorites WHERE id = ?').run(existing.id);
    return false;
  } else {
    db.prepare('INSERT INTO favorites (slot, track_number) VALUES (?, ?)').run(slot, trackNumber || 0);
    return true;
  }
}

export function isFavorite(slot, trackNumber) {
  return !!db.prepare('SELECT 1 FROM favorites WHERE slot = ? AND track_number = ?').get(slot, trackNumber || 0);
}

// Search
export function searchLibrary(query) {
  const pattern = `%${query}%`;
  const cds = db.prepare(`
    SELECT * FROM cds
    WHERE title LIKE ? OR artist LIKE ? OR genre LIKE ? OR notes LIKE ?
    ORDER BY slot
  `).all(pattern, pattern, pattern, pattern);

  const tracks = db.prepare(`
    SELECT t.*, c.title as cd_title, c.artist as cd_artist
    FROM tracks t
    JOIN cds c ON c.slot = t.slot
    WHERE t.title LIKE ? OR t.artist LIKE ?
    ORDER BY t.slot, t.track_number
  `).all(pattern, pattern);

  return { cds, tracks };
}

// Stats
export function getStats() {
  const totalCDs = db.prepare('SELECT COUNT(*) as count FROM cds').get().count;
  const totalTracks = db.prepare('SELECT COUNT(*) as count FROM tracks').get().count;
  const minSec = getStatsMinSeconds();
  const totalPlays = db.prepare('SELECT COUNT(*) as count FROM play_history WHERE duration_played >= ?').get(minSec).count;
  const totalFavorites = db.prepare('SELECT COUNT(*) as count FROM favorites').get().count;
  const totalPlaylists = db.prepare('SELECT COUNT(*) as count FROM playlists').get().count;
  const recentPlays = db.prepare(`
    SELECT slot, COUNT(*) as plays FROM play_history
    WHERE duration_played >= ?
    GROUP BY slot ORDER BY plays DESC LIMIT 10
  `).all(minSec);
  return { totalCDs, totalTracks, totalPlays, totalFavorites, totalPlaylists, recentPlays };
}

// Play Statistics

export function getTopCDs(limit = 10) {
  const minSec = getStatsMinSeconds();
  return db.prepare(`
    SELECT ph.slot,
      COUNT(DISTINCT CASE WHEN ph.session_id IS NOT NULL THEN ph.session_id ELSE ph.id END) as play_count,
      MAX(ph.played_at) as last_played,
      c.title as cd_title, c.artist as cd_artist, c.cover_url,
      COALESCE(SUM(ph.duration_played), 0) as total_play_time,
      COUNT(*) as track_plays
    FROM play_history ph
    LEFT JOIN cds c ON c.slot = ph.slot
    WHERE ph.duration_played >= ?
    GROUP BY ph.slot
    ORDER BY play_count DESC
    LIMIT ?
  `).all(minSec, limit);
}

export function getTopTracks(limit = 10) {
  const minSec = getStatsMinSeconds();
  return db.prepare(`
    SELECT ph.slot, ph.track_number, COUNT(*) as play_count, MAX(ph.played_at) as last_played,
      t.title as track_title, t.duration_seconds, c.title as cd_title, c.artist as cd_artist,
      c.cover_url, COALESCE(SUM(ph.duration_played), 0) as total_play_time
    FROM play_history ph
    LEFT JOIN cds c ON c.slot = ph.slot
    LEFT JOIN tracks t ON t.slot = ph.slot AND t.track_number = ph.track_number
    WHERE ph.duration_played >= ?
    GROUP BY ph.slot, ph.track_number
    ORDER BY play_count DESC
    LIMIT ?
  `).all(minSec, limit);
}

export function getPlayActivity(period) {
  const minSec = getStatsMinSeconds();
  switch (period) {
    case 'day':
      return db.prepare(`
        SELECT date(ph.played_at) as period, COUNT(*) as play_count,
          COUNT(DISTINCT ph.slot) as unique_cds,
          COUNT(DISTINCT ph.slot || '-' || ph.track_number) as unique_tracks,
          COALESCE(SUM(ph.duration_played), 0) as play_time_sec
        FROM play_history ph
        WHERE ph.duration_played >= ? AND ph.played_at >= date('now', '-30 days')
        GROUP BY date(ph.played_at)
        ORDER BY period
      `).all(minSec);

    case 'week':
      return db.prepare(`
        SELECT strftime('%G-W%V', ph.played_at) as period, COUNT(*) as play_count,
          COUNT(DISTINCT ph.slot) as unique_cds,
          COUNT(DISTINCT ph.slot || '-' || ph.track_number) as unique_tracks,
          COALESCE(SUM(ph.duration_played), 0) as play_time_sec
        FROM play_history ph
        WHERE ph.duration_played >= ? AND ph.played_at >= date('now', '-84 days')
        GROUP BY strftime('%G-W%V', ph.played_at)
        ORDER BY period
      `).all(minSec);

    case 'month':
      return db.prepare(`
        SELECT strftime('%Y-%m', ph.played_at) as period, COUNT(*) as play_count,
          COUNT(DISTINCT ph.slot) as unique_cds,
          COUNT(DISTINCT ph.slot || '-' || ph.track_number) as unique_tracks,
          COALESCE(SUM(ph.duration_played), 0) as play_time_sec
        FROM play_history ph
        WHERE ph.duration_played >= ? AND ph.played_at >= date('now', '-12 months')
        GROUP BY strftime('%Y-%m', ph.played_at)
        ORDER BY period
      `).all(minSec);

    case 'year':
      return db.prepare(`
        SELECT strftime('%Y', ph.played_at) as period, COUNT(*) as play_count,
          COUNT(DISTINCT ph.slot) as unique_cds,
          COUNT(DISTINCT ph.slot || '-' || ph.track_number) as unique_tracks,
          COALESCE(SUM(ph.duration_played), 0) as play_time_sec
        FROM play_history ph
        WHERE ph.duration_played >= ?
        GROUP BY strftime('%Y', ph.played_at)
        ORDER BY period
      `).all(minSec);

    default:
      return [];
  }
}

export function getInventoryStats() {
  const totalCDs = db.prepare('SELECT COUNT(*) as count FROM cds').get().count;
  const totalTracks = db.prepare('SELECT COUNT(*) as count FROM tracks').get().count;
  const totalDurationSeconds = db.prepare('SELECT COALESCE(SUM(total_duration_seconds), 0) as total FROM cds').get().total;
  const totalPlaylists = db.prepare('SELECT COUNT(*) as count FROM playlists').get().count;
  const totalPlaylistItems = db.prepare('SELECT COUNT(*) as count FROM playlist_items').get().count;
  const totalFavorites = db.prepare('SELECT COUNT(*) as count FROM favorites').get().count;
  const totalRatings = db.prepare('SELECT COUNT(*) as count FROM ratings').get().count;
  const avgRatingRow = db.prepare('SELECT ROUND(AVG(rating), 1) as avg FROM ratings').get();
  const avgRating = avgRatingRow.avg || 0;
  const genreDistribution = db.prepare(`
    SELECT genre, COUNT(*) as count FROM cds
    WHERE genre != ''
    GROUP BY genre
    ORDER BY count DESC
  `).all();

  return {
    totalCDs,
    totalTracks,
    totalDurationSeconds,
    totalPlaylists,
    totalPlaylistItems,
    totalFavorites,
    totalRatings,
    avgRating,
    genreDistribution,
  };
}

export function resetPlayStats() {
  db.prepare('DELETE FROM play_history').run();
}

export function getEstimatedPlayTime() {
  const row = db.prepare(`
    SELECT COALESCE(SUM(duration_played), 0) as total_seconds
    FROM play_history
  `).get();
  return row.total_seconds;
}

export function getPlayStats(topLimit = 10) {
  return {
    inventory: getInventoryStats(),
    topCDs: getTopCDs(topLimit),
    topTracks: getTopTracks(topLimit),
    dailyActivity: getPlayActivity('day'),
    weeklyActivity: getPlayActivity('week'),
    monthlyActivity: getPlayActivity('month'),
    yearlyActivity: getPlayActivity('year'),
    totalPlays: db.prepare('SELECT COUNT(*) as count FROM play_history WHERE duration_played >= ?').get(getStatsMinSeconds()).count,
    totalPlayTimeSec: getEstimatedPlayTime(),
  };
}

// Ratings
export function setRating(slot, trackNumber, rating) {
  if (rating < 1 || rating > 5) return;
  db.prepare('INSERT OR REPLACE INTO ratings (slot, track_number, rating) VALUES (?, ?, ?)')
    .run(slot, trackNumber || 0, rating);
}

export function removeRating(slot, trackNumber) {
  db.prepare('DELETE FROM ratings WHERE slot = ? AND track_number = ?').run(slot, trackNumber || 0);
}

export function getRating(slot, trackNumber) {
  const row = db.prepare('SELECT rating FROM ratings WHERE slot = ? AND track_number = ?').get(slot, trackNumber || 0);
  return row ? row.rating : 0;
}

export function getRatings(minRating = 1) {
  return db.prepare(`
    SELECT r.*, c.title as cd_title, c.artist as cd_artist,
           t.title as track_title, t.artist as track_artist
    FROM ratings r
    LEFT JOIN cds c ON c.slot = r.slot
    LEFT JOIN tracks t ON t.slot = r.slot AND t.track_number = r.track_number
    WHERE r.rating >= ?
    ORDER BY r.rating DESC, r.slot, r.track_number
  `).all(minRating);
}

export function getTopRated(limit = 50) {
  return db.prepare(`
    SELECT r.*, c.title as cd_title, c.artist as cd_artist,
           t.title as track_title, t.artist as track_artist
    FROM ratings r
    LEFT JOIN cds c ON c.slot = r.slot
    LEFT JOIN tracks t ON t.slot = r.slot AND t.track_number = r.track_number
    ORDER BY r.rating DESC, r.created_at DESC
    LIMIT ?
  `).all(limit);
}

// Full Backup Export
export function exportBackup() {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: getAllSettings(),
    cds: getCDsWithTracks(),
    playlists: getAllPlaylists().map(pl => getPlaylist(pl.id)),
    favorites: getFavorites(),
    ratings: db.prepare('SELECT slot, track_number, rating, created_at FROM ratings ORDER BY slot, track_number').all(),
    playHistory: db.prepare('SELECT slot, track_number, player_id, played_at, duration_played, session_id FROM play_history ORDER BY played_at').all(),
  };
}

// Full Backup Import
export function importBackup(data) {
  const tx = db.transaction(() => {
    // Settings
    if (data.settings) {
      for (const [key, value] of Object.entries(data.settings)) {
        setSetting(key, value);
      }
    }
    // CDs + tracks
    if (data.cds) {
      for (const cd of data.cds) {
        upsertCD(cd.slot, cd);
        if (cd.tracks && cd.tracks.length) setTracks(cd.slot, cd.tracks);
      }
    }
    // Playlists
    if (data.playlists) {
      for (const pl of data.playlists) {
        const existing = db.prepare('SELECT id FROM playlists WHERE name = ?').get(pl.name);
        let plId;
        if (existing) {
          plId = existing.id;
        } else {
          const r = db.prepare('INSERT INTO playlists (name, description) VALUES (?, ?)').run(pl.name, pl.description || '');
          plId = r.lastInsertRowid;
        }
        if (pl.items) {
          for (const item of pl.items) {
            const maxPos = db.prepare('SELECT MAX(position) as max FROM playlist_items WHERE playlist_id = ?').get(plId);
            db.prepare('INSERT INTO playlist_items (playlist_id, slot, track_number, position) VALUES (?, ?, ?, ?)')
              .run(plId, item.slot, item.track_number || 0, (maxPos?.max || 0) + 1);
          }
        }
      }
    }
    // Favorites
    if (data.favorites) {
      for (const f of data.favorites) {
        db.prepare('INSERT OR IGNORE INTO favorites (slot, track_number) VALUES (?, ?)').run(f.slot, f.track_number || 0);
      }
    }
    // Ratings
    if (data.ratings) {
      for (const r of data.ratings) {
        db.prepare('INSERT OR REPLACE INTO ratings (slot, track_number, rating) VALUES (?, ?, ?)').run(r.slot, r.track_number || 0, r.rating);
      }
    }
    // Play History
    if (data.playHistory) {
      for (const h of data.playHistory) {
        db.prepare('INSERT INTO play_history (slot, track_number, player_id, played_at, duration_played, session_id) VALUES (?, ?, ?, ?, ?, ?)').run(h.slot, h.track_number, h.player_id || 1, h.played_at, h.duration_played || 0, h.session_id || null);
      }
    }
  });
  tx();
}

export function getDb() {
  return db;
}
