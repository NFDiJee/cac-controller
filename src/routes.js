import { Router } from 'express';
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as db from './database.js';
import * as mb from './musicbrainz.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COVERS_DIR = join(__dirname, '..', 'public', 'covers');

function deleteCoversForSlot(slot) {
  ['jpg', 'png', 'webp'].forEach(e => {
    const f = join(COVERS_DIR, `cover_${slot}.${e}`);
    try { unlinkSync(f); } catch { /* ignore */ }
  });
}

export function createRoutes(playerManager, scanner, serial) {
  const router = Router();

  // ── Hub API-Key Authentication ──
  // When X-API-Key header is present, validate it. This allows the Hub to
  // access ALL endpoints (library, playlists, scanner, settings, etc.).
  // Local UI requests (no API key) pass through unchanged.

  router.use('/api', (req, res, next) => {
    const provided = req.headers['x-api-key'] || req.query.apikey;
    if (!provided) return next(); // Local client — no auth needed
    const apiKey = db.getSetting('node_api_key');
    if (!apiKey) return res.status(503).json({ error: 'Node API not configured (no API key set)' });
    if (provided !== apiKey) return res.status(401).json({ error: 'Invalid API key' });
    req.hubAuthenticated = true;
    next();
  });

  // ── Node API (Hub convenience endpoints — require API key) ──

  function requireHub(req, res, next) {
    if (!req.hubAuthenticated) return res.status(401).json({ error: 'API key required' });
    next();
  }

  router.get('/api/node/info', requireHub, (req, res) => {
    const settings = db.getAllSettings();
    const stats = db.getStats();
    res.json({
      name: settings.node_name || '',
      room: settings.node_room || '',
      model: settings.model || 'CAC-V3000',
      maxDiscs: parseInt(settings.max_discs) || 300,
      serialConnected: serial ? serial.isConnected : false,
      totalCDs: stats.totalCDs,
      totalTracks: stats.totalTracks,
      players: playerManager.getAllStates(),
      scanning: scanner.isScanning,
    });
  });

  router.get('/api/node/status', requireHub, (req, res) => {
    res.json({
      players: playerManager.getAllStates(),
      scanner: scanner.getProgress(),
      serialConnected: serial ? serial.isConnected : false,
    });
  });

  // ── Player Controls (all fire-and-forget, respond immediately) ──

  router.post('/api/player/:id/load', (req, res) => {
    const playerId = parseInt(req.params.id);
    const { disc, track } = req.body;
    if (track) {
      playerManager.loadAndPlay(playerId, disc, track);
    } else {
      playerManager.loadDisc(playerId, disc);
    }
    res.json({ ok: true });
  });

  router.post('/api/player/:id/eject', (req, res) => {
    playerManager.ejectDisc(parseInt(req.params.id));
    res.json({ ok: true });
  });

  router.post('/api/player/:id/play', (req, res) => {
    playerManager.play(parseInt(req.params.id));
    res.json({ ok: true });
  });

  router.post('/api/player/:id/pause', (req, res) => {
    playerManager.pause(parseInt(req.params.id));
    res.json({ ok: true });
  });

  router.post('/api/player/:id/stop', (req, res) => {
    playerManager.stop(parseInt(req.params.id));
    res.json({ ok: true });
  });

  router.post('/api/player/:id/track/:num', (req, res) => {
    playerManager.playTrack(parseInt(req.params.id), parseInt(req.params.num));
    res.json({ ok: true });
  });

  router.post('/api/player/:id/next', (req, res) => {
    playerManager.nextTrack(parseInt(req.params.id));
    res.json({ ok: true });
  });

  router.post('/api/player/:id/previous', (req, res) => {
    playerManager.previousTrack(parseInt(req.params.id));
    res.json({ ok: true });
  });

  router.post('/api/player/:id/scan-forward', (req, res) => {
    playerManager.scanForward(parseInt(req.params.id));
    res.json({ ok: true });
  });

  router.post('/api/player/:id/scan-reverse', (req, res) => {
    playerManager.scanReverse(parseInt(req.params.id));
    res.json({ ok: true });
  });

  router.post('/api/player/:id/volume', (req, res) => {
    playerManager.setVolume(parseInt(req.params.id), req.body.value);
    res.json({ ok: true });
  });

  router.post('/api/player/:id/speed', (req, res) => {
    playerManager.setSpeed(parseInt(req.params.id), req.body.value);
    res.json({ ok: true });
  });

  router.post('/api/player/:id/fade', (req, res) => {
    playerManager.fade(parseInt(req.params.id), req.body.target, req.body.duration);
    res.json({ ok: true });
  });

  router.post('/api/player/:id/cue-search', (req, res) => {
    playerManager.autoCueSearch(parseInt(req.params.id), req.body.track);
    res.json({ ok: true });
  });

  router.post('/api/player/:id/stop-marker', (req, res) => {
    playerManager.setStopMarker(parseInt(req.params.id), req.body.track);
    res.json({ ok: true });
  });

  router.post('/api/player/:id/reset', (req, res) => {
    playerManager.resetChanger(parseInt(req.params.id));
    res.json({ ok: true });
  });

  router.post('/api/player/:id/raw', (req, res) => {
    playerManager.sendRawCommand(parseInt(req.params.id), req.body.command);
    res.json({ ok: true });
  });

  router.get('/api/player/:id/state', (req, res) => {
    res.json(playerManager.getState(parseInt(req.params.id)));
  });

  router.get('/api/player/states', (req, res) => {
    res.json(playerManager.getAllStates());
  });

  router.get('/api/player/:id/toc', (req, res) => {
    playerManager.queryTOC(parseInt(req.params.id));
    const player = playerManager.getState(parseInt(req.params.id));
    res.json(player.toc || {});
  });

  router.get('/api/player/:id/model', (req, res) => {
    playerManager.queryModel(parseInt(req.params.id));
    res.json({ ok: true });
  });

  // ── CD Library ──

  router.get('/api/library', (req, res) => {
    const cds = db.getCDsWithTracks();
    res.json(cds);
  });

  router.get('/api/library/:slot', (req, res) => {
    const cd = db.getCD(parseInt(req.params.slot));
    if (!cd) return res.status(404).json({ error: 'CD not found' });
    res.json(cd);
  });

  router.put('/api/library/:slot', (req, res) => {
    const slot = parseInt(req.params.slot);
    const cd = db.upsertCD(slot, req.body);
    if (req.body.tracks) {
      db.setTracks(slot, req.body.tracks);
    }
    res.json(db.getCD(slot));
  });

  router.delete('/api/library/:slot', (req, res) => {
    const slot = parseInt(req.params.slot);
    deleteCoversForSlot(slot);
    db.deleteCD(slot);
    res.json({ ok: true });
  });

  // Bulk delete
  router.post('/api/library/bulk-delete', (req, res) => {
    const { slots } = req.body;
    if (!Array.isArray(slots)) return res.status(400).json({ error: 'slots must be an array' });
    let deleted = 0;
    for (const slot of slots) {
      const s = parseInt(slot);
      if (s >= 1 && s <= 500) { deleteCoversForSlot(s); db.deleteCD(s); deleted++; }
    }
    res.json({ ok: true, deleted });
  });

  router.put('/api/library/:slot/track/:num', (req, res) => {
    db.updateTrack(parseInt(req.params.slot), parseInt(req.params.num), req.body);
    res.json({ ok: true });
  });

  // ── Cover Upload (base64 JSON) ──
  router.post('/api/library/:slot/cover', (req, res) => {
    try {
      const slot = parseInt(req.params.slot);
      const { image } = req.body; // base64 data URL: "data:image/jpeg;base64,..."
      if (!image) return res.status(400).json({ error: 'No image data' });

      const match = image.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
      if (!match) return res.status(400).json({ error: 'Invalid image format (JPEG, PNG or WebP required)' });

      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const buffer = Buffer.from(match[2], 'base64');

      // Max 2MB
      if (buffer.length > 2 * 1024 * 1024) {
        return res.status(400).json({ error: 'Image too large (max 2MB)' });
      }

      mkdirSync(COVERS_DIR, { recursive: true });
      const filename = `cover_${slot}.${ext}`;
      const filepath = join(COVERS_DIR, filename);

      // Remove old covers for this slot
      deleteCoversForSlot(slot);

      writeFileSync(filepath, buffer);
      const coverUrl = `/covers/${filename}`;
      db.upsertCD(slot, { cover_url: coverUrl });

      res.json({ ok: true, cover_url: coverUrl });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── MusicBrainz Search ──

  router.get('/api/musicbrainz/search', async (req, res) => {
    try {
      const { q, artist, title, barcode } = req.query;
      let results;
      if (barcode) {
        results = await mb.searchByBarcode(barcode);
      } else if (artist || title) {
        results = await mb.searchByArtistAndTitle(artist, title);
      } else if (q) {
        results = await mb.searchAndParse(q);
      } else {
        return res.status(400).json({ error: 'Search query required' });
      }
      res.json(results);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/musicbrainz/apply/:slot', async (req, res) => {
    try {
      const cd = await scanner.applyMetadata(parseInt(req.params.slot), req.body.releaseId);
      res.json(cd);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/api/musicbrainz/release/:id', async (req, res) => {
    try {
      const data = await mb.fetchAndParse(req.params.id);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Scanner ──

  router.post('/api/scanner/scan', async (req, res) => {
    const { slot, startSlot, endSlot } = req.body;
    try {
      if (slot) {
        const result = await scanner.scanSlot(slot);
        res.json(result);
      } else if (startSlot && endSlot) {
        // Start async scan, return immediately
        scanner.scanRange(startSlot, endSlot);
        res.json({ ok: true, message: 'Scan gestartet' });
      } else {
        res.status(400).json({ error: 'slot or startSlot/endSlot required' });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/scanner/scan-all', (req, res) => {
    const maxDiscs = parseInt(req.body.maxDiscs) || 300;
    scanner.scanAll(maxDiscs);
    res.json({ ok: true, message: `Scan aller ${maxDiscs} Slots gestartet` });
  });

  router.post('/api/scanner/abort', (req, res) => {
    scanner.abort();
    res.json({ ok: true });
  });

  router.get('/api/scanner/progress', (req, res) => {
    res.json(scanner.getProgress());
  });

  // ── Playlists ──

  router.get('/api/playlists', (req, res) => {
    res.json(db.getAllPlaylists());
  });

  router.post('/api/playlists', (req, res) => {
    const playlist = db.createPlaylist(req.body.name, req.body.description);
    res.json(playlist);
  });

  router.get('/api/playlists/:id', (req, res) => {
    const playlist = db.getPlaylist(parseInt(req.params.id));
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
    res.json(playlist);
  });

  router.put('/api/playlists/:id', (req, res) => {
    const playlist = db.updatePlaylist(parseInt(req.params.id), req.body);
    res.json(playlist);
  });

  router.delete('/api/playlists/:id', (req, res) => {
    db.deletePlaylist(parseInt(req.params.id));
    res.json({ ok: true });
  });

  router.post('/api/playlists/:id/play', (req, res) => {
    const playlist = db.getPlaylist(parseInt(req.params.id));
    if (!playlist || !playlist.items?.length) {
      return res.status(404).json({ error: 'Playlist empty or not found' });
    }
    playerManager.startPlaylist(playlist.items);
    res.json({ ok: true, total: playlist.items.length });
  });

  router.post('/api/playlists/stop', (req, res) => {
    playerManager.stopPlaylist();
    res.json({ ok: true });
  });

  router.post('/api/playlists/next', (req, res) => {
    playerManager.playlistNext();
    res.json({ ok: true });
  });

  router.post('/api/playlists/previous', (req, res) => {
    playerManager.playlistPrevious();
    res.json({ ok: true });
  });

  router.get('/api/playlists/playing', (req, res) => {
    res.json(playerManager.getPlaylistState());
  });

  router.post('/api/playlists/:id/items', (req, res) => {
    const playlist = db.addToPlaylist(parseInt(req.params.id), req.body.slot, req.body.track);
    res.json(playlist);
  });

  router.delete('/api/playlists/:id/items/:itemId', (req, res) => {
    db.removeFromPlaylist(parseInt(req.params.itemId));
    res.json({ ok: true });
  });

  router.put('/api/playlists/:id/reorder', (req, res) => {
    const playlist = db.reorderPlaylist(parseInt(req.params.id), req.body.itemIds);
    res.json(playlist);
  });

  // ── Favorites ──

  router.get('/api/favorites', (req, res) => {
    res.json(db.getFavorites());
  });

  router.post('/api/favorites/toggle', (req, res) => {
    const isFav = db.toggleFavorite(req.body.slot, req.body.track);
    res.json({ favorite: isFav });
  });

  // ── Ratings ──

  router.get('/api/ratings', (req, res) => {
    const min = parseInt(req.query.min) || 1;
    res.json(db.getTopRated(100));
  });

  router.post('/api/ratings', (req, res) => {
    const { slot, track, rating } = req.body;
    if (rating === 0) {
      db.removeRating(slot, track);
    } else {
      db.setRating(slot, track, rating);
    }
    res.json({ ok: true, rating });
  });

  router.get('/api/ratings/:slot/:track', (req, res) => {
    const rating = db.getRating(parseInt(req.params.slot), parseInt(req.params.track));
    res.json({ rating });
  });

  // ── History ──

  router.get('/api/history', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    res.json(db.getPlayHistory(limit));
  });

  router.delete('/api/history', (req, res) => {
    db.clearPlayHistory();
    res.json({ ok: true });
  });

  // ── Search ──

  router.get('/api/search', (req, res) => {
    const results = db.searchLibrary(req.query.q || '');
    res.json(results);
  });

  // ── Settings ──

  router.get('/api/settings', (req, res) => {
    res.json(db.getAllSettings());
  });

  router.put('/api/settings', (req, res) => {
    for (const [key, value] of Object.entries(req.body)) {
      db.setSetting(key, value);
    }
    res.json(db.getAllSettings());
  });

  // ── Stats ──

  router.get('/api/stats', (req, res) => {
    const topLimit = parseInt(req.query.top) || 10;
    res.json({
      inventory: db.getInventoryStats(),
      topCDs: db.getTopCDs(topLimit),
      topTracks: db.getTopTracks(topLimit),
      daily: db.getPlayActivity('day'),
      weekly: db.getPlayActivity('week'),
      monthly: db.getPlayActivity('month'),
      yearly: db.getPlayActivity('year'),
      totalPlayTimeSec: db.getEstimatedPlayTime(),
    });
  });

  router.delete('/api/stats/reset', (req, res) => {
    db.resetPlayStats();
    res.json({ ok: true });
  });

  // ── Play Modes ──

  router.get('/api/playmodes', (req, res) => {
    res.json({
      continuous: playerManager.continuousPlay,
      gapless: playerManager.gaplessPlay,
      shuffle: playerManager.shuffleMode,
    });
  });

  router.put('/api/playmodes', (req, res) => {
    if (req.body.continuous !== undefined) playerManager.setContinuousPlay(!!req.body.continuous);
    if (req.body.gapless !== undefined) playerManager.setGaplessPlay(!!req.body.gapless);
    if (req.body.shuffle !== undefined) playerManager.setShuffleMode(req.body.shuffle);
    res.json({
      continuous: playerManager.continuousPlay,
      gapless: playerManager.gaplessPlay,
      shuffle: playerManager.shuffleMode,
    });
  });

  // ── JSON Import ──

  router.post('/api/import', (req, res) => {
    try {
      const data = req.body;
      let imported = 0;

      // Support multiple JSON formats
      let cdList = [];

      if (Array.isArray(data)) {
        // Direct array of CDs
        cdList = data;
      } else if (data.cds && Array.isArray(data.cds)) {
        cdList = data.cds;
      } else if (typeof data === 'object' && !Array.isArray(data)) {
        // Single CD object or keyed by slot
        for (const [key, val] of Object.entries(data)) {
          if (typeof val === 'object' && val !== null) {
            cdList.push({ ...val, slot: val.slot || val.cd_number || parseInt(key) || undefined });
          }
        }
      }

      for (const cd of cdList) {
        // Determine slot number
        let slot = cd.slot || cd.cd_number || cd.slotNumber || cd.nr;
        if (typeof slot === 'string') slot = parseInt(slot);
        if (!slot || slot < 1 || slot > 500) continue;

        // Map fields (support various JSON formats)
        const cdData = {
          disc_id: cd.disc_id || cd.discId || '',
          title: cd.title || cd.album || cd.name || '',
          artist: cd.artist || cd.album_artist || cd.albumArtist || '',
          year: cd.year || cd.release_date || cd.releaseDate || '',
          genre: cd.genre || '',
          total_tracks: cd.total_tracks || cd.totalTracks || cd.tracks?.length || 0,
          total_duration_seconds: cd.total_duration_seconds || cd.totalDuration || 0,
          cover_url: cd.cover_url || cd.coverUrl || cd.cover || '',
          notes: cd.notes || '',
          musicbrainz_release_id: cd.musicbrainz_release_id || cd.mbid || '',
          barcode: cd.barcode || cd.ean || '',
          label: cd.label || '',
          country: cd.country || '',
        };

        // Calculate total duration from tracks if not set
        if (!cdData.total_duration_seconds && cd.tracks) {
          cdData.total_duration_seconds = cd.tracks.reduce((sum, t) => {
            const dur = t.duration_seconds || t.durationSeconds || t.duration || 0;
            if (typeof dur === 'string' && dur.includes(':')) {
              const [m, s] = dur.split(':').map(Number);
              return sum + m * 60 + s;
            }
            return sum + (typeof dur === 'number' ? dur : 0);
          }, 0);
        }

        // Parse album_length format "MM:SS"
        if (!cdData.total_duration_seconds && cd.album_length) {
          const parts = cd.album_length.split(':').map(Number);
          if (parts.length === 2) cdData.total_duration_seconds = parts[0] * 60 + parts[1];
        }

        db.upsertCD(slot, cdData);

        // Import tracks
        if (cd.tracks && Array.isArray(cd.tracks)) {
          const trackMap = new Map();
          cd.tracks.forEach((t, i) => {
            let durSec = t.duration_seconds || t.durationSeconds || 0;
            if (!durSec && t.track_length) {
              const parts = t.track_length.split(':').map(Number);
              if (parts.length === 2) durSec = parts[0] * 60 + parts[1];
            }
            if (!durSec && t.duration && typeof t.duration === 'string' && t.duration.includes(':')) {
              const parts = t.duration.split(':').map(Number);
              if (parts.length === 2) durSec = parts[0] * 60 + parts[1];
            }

            const num = t.track_number || t.trackNumber || t.number || i + 1;
            trackMap.set(num, {
              track_number: num,
              title: t.title || t.track_title || t.name || '',
              artist: t.artist || t.track_artist || '',
              duration_seconds: typeof durSec === 'number' ? durSec : 0,
              isrc: t.isrc || '',
            });
          });
          db.setTracks(slot, [...trackMap.values()]);
        }

        imported++;
      }

      res.json({ ok: true, imported });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Backup Export/Import ──

  router.get('/api/backup', (req, res) => {
    res.json(db.exportBackup());
  });

  router.post('/api/backup', (req, res) => {
    try {
      db.importBackup(req.body);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── System Locale ──

  router.get('/api/system/locale', (req, res) => {
    try {
      const locale = execSync('locale 2>/dev/null | head -1', { encoding: 'utf-8' }).trim();
      const lang = locale.includes('de') ? 'de' : 'en';
      res.json({ locale, lang });
    } catch {
      res.json({ locale: 'en_US.UTF-8', lang: 'en' });
    }
  });

  // ── Serial Ports ──

  router.get('/api/serial/ports', async (req, res) => {
    try {
      const { SerialConnection } = await import('./serial.js');
      const ports = await SerialConnection.listPorts();
      res.json(ports);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
