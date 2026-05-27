import { EventEmitter } from 'events';
import * as db from './database.js';
import * as mb from './musicbrainz.js';

export class CDScanner extends EventEmitter {
  constructor(serial, options = {}) {
    super();
    this.serial = serial;
    this.playerManager = options.playerManager || null;
    this.playerId = options.playerId || 1;
    this.scanning = false;
    this.abortRequested = false;
    this.currentSlot = null;
    this.progress = { current: 0, total: 0, status: 'idle', slot: null, message: '' };
  }

  // Wait for a specific response type from the serial port
  _waitForResponse(type, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.serial.removeListener('playerResponse', handler);
        console.log(`[Scanner] TIMEOUT waiting for '${type}' after ${timeout}ms`);
        reject(new Error(`Timeout waiting for ${type}`));
      }, timeout);

      const handler = ({ playerId, raw, parsed }) => {
        if (playerId !== this.playerId) return;
        console.log(`[Scanner] Got response: type='${parsed.type}' raw='${raw}'`);
        if (parsed.type === type) {
          clearTimeout(timer);
          this.serial.removeListener('playerResponse', handler);
          resolve(parsed);
        }
        if (parsed.type === 'error') {
          clearTimeout(timer);
          this.serial.removeListener('playerResponse', handler);
          reject(new Error(`${parsed.code}: ${parsed.message}`));
        }
      };

      this.serial.on('playerResponse', handler);
    });
  }

  // Wait for player mode to be one of expected modes
  async _waitForMode(expectedModes, timeout = 45000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      this.serial.send(this.playerId, '?P');
      try {
        const parsed = await this._waitForResponse('mode', 3000);
        if (expectedModes.includes(parsed.raw)) return parsed;
      } catch { /* retry */ }
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`Mode timeout waiting for ${expectedModes.join('/')}`);
  }

  async scanSlot(slot) {
    this.currentSlot = slot;
    this._updateProgress(slot, 'loading', { key: 'scan.loading', slot });

    // Pause PlayerManager polling to avoid stealing responses
    if (this.playerManager) this.playerManager.pausePollingForPlayer(this.playerId);

    try {
      // Load the disc
      const padded = String(slot).padStart(3, '0');
      console.log(`[Scanner] === Scanning slot ${slot} ===`);
      console.log(`[Scanner] Sending: ${padded}ZS`);
      this.serial.send(this.playerId, `${padded}ZS`);

      // Wait for disc to be loaded (mode transitions to park or setup)
      console.log(`[Scanner] Waiting for mode P01/P02/P04/P06...`);
      await this._waitForMode(['P01', 'P02', 'P04', 'P06'], 45000);
      console.log(`[Scanner] Disc loaded, starting playback for TOC read`);

      // Start the disc to read TOC
      this._updateProgress(slot, 'reading', { key: 'scan.reading', slot });
      this.serial.send(this.playerId, 'SA');
      console.log(`[Scanner] Sent SA, waiting 3s for spin-up...`);
      await new Promise(r => setTimeout(r, 3000));

      // Query TOC — retry up to 3 times
      let toc = null;
      for (let attempt = 0; attempt < 3 && !toc; attempt++) {
        console.log(`[Scanner] Sending ?Q (attempt ${attempt + 1}/3)`);
        this.serial.send(this.playerId, '?Q');
        try {
          toc = await this._waitForResponse('toc', 10000);
          console.log(`[Scanner] TOC received: first=${toc.firstTrack} last=${toc.lastTrack} leadOut=${toc.leadOutMin}:${toc.leadOutSec}:${toc.leadOutFrames}`);
        } catch (err) {
          console.log(`[Scanner] TOC attempt ${attempt + 1} failed: ${err.message}`);
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      if (!toc || !toc.lastTrack) {
        console.log(`[Scanner] No TOC data for slot ${slot}`);
        this._updateProgress(slot, 'empty', { key: 'scan.empty', slot });
        await this._ejectDisc();
        return { slot, status: 'empty' };
      }

      // Pioneer doesn't support per-track TOC queries via serial,
      // so we save TOC data and let the user assign metadata via MusicBrainz search
      const totalTracks = toc.lastTrack - toc.firstTrack + 1;
      const totalSeconds = toc.leadOutMin * 60 + toc.leadOutSec;
      console.log(`[Scanner] CD ${slot}: ${totalTracks} tracks, ${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`);

      // Stop playback
      this.serial.send(this.playerId, 'RJ');
      await new Promise(r => setTimeout(r, 500));

      // Build track stubs
      const tracks = [];
      for (let i = toc.firstTrack; i <= toc.lastTrack; i++) {
        tracks.push({ track_number: i, title: `Track ${i}`, artist: '', duration_seconds: 0 });
      }

      const cdData = {
        total_tracks: totalTracks,
        total_duration_seconds: totalSeconds,
      };

      db.upsertCD(slot, cdData);
      db.setTracks(slot, tracks);
      this._updateProgress(slot, 'scanned', { key: 'scan.scanned', slot, totalTracks, duration: `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}` });

      await this._ejectDisc();
      return { slot, status: 'scanned', totalTracks, totalSeconds };

    } catch (err) {
      this._updateProgress(slot, 'error', { key: 'scan.error', slot, error: err.message });
      try { await this._ejectDisc(); } catch { /* ignore */ }
      return { slot, status: 'error', error: err.message };
    } finally {
      // Always resume polling
      if (this.playerManager) this.playerManager.resumePollingForPlayer(this.playerId);
    }
  }

  async scanRange(startSlot, endSlot) {
    if (this.scanning) throw new Error('Scan already in progress');

    this.scanning = true;
    this.abortRequested = false;
    const total = endSlot - startSlot + 1;
    this.progress = { current: 0, total, status: 'scanning', slot: null, message: { key: 'scan.started' } };
    this.emit('progress', this.progress);

    const results = [];

    for (let slot = startSlot; slot <= endSlot; slot++) {
      if (this.abortRequested) {
        this._updateProgress(slot, 'aborted', { key: 'scan.aborted' });
        break;
      }

      this.progress.current = slot - startSlot + 1;
      const result = await this.scanSlot(slot);
      results.push(result);
      await new Promise(r => setTimeout(r, 1000));
    }

    this.scanning = false;
    this.progress.status = this.abortRequested ? 'aborted' : 'complete';
    this.progress.message = { key: 'scan.complete', count: results.length };
    this.emit('progress', this.progress);
    this.emit('complete', results);

    return results;
  }

  async scanAll(maxDiscs = 300) {
    return this.scanRange(1, maxDiscs);
  }

  abort() {
    this.abortRequested = true;
  }

  async lookupMetadata(slot, query) {
    this._updateProgress(slot, 'lookup', { key: 'scan.lookup', slot });
    try {
      return await mb.searchAndParse(query);
    } catch (err) {
      this._updateProgress(slot, 'error', { key: 'scan.lookupFailed', error: err.message });
      throw err;
    }
  }

  async applyMetadata(slot, releaseId) {
    this._updateProgress(slot, 'applying', { key: 'scan.applying', slot });
    try {
      const data = await mb.fetchAndParse(releaseId);
      db.upsertCD(slot, data.cd);
      if (data.tracks.length > 0) {
        db.setTracks(slot, data.tracks);
      }
      this._updateProgress(slot, 'complete', { key: 'scan.applied', slot });
      return db.getCD(slot);
    } catch (err) {
      this._updateProgress(slot, 'error', { key: 'scan.applyFailed', error: err.message });
      throw err;
    }
  }

  async autoScanSlot(slot, searchQuery) {
    const scanResult = await this.scanSlot(slot);
    if (scanResult.status !== 'scanned') return scanResult;

    if (searchQuery) {
      try {
        const results = await this.lookupMetadata(slot, searchQuery);
        if (results.length > 0) {
          await this.applyMetadata(slot, results[0].releaseId);
        }
      } catch { /* metadata lookup is best-effort */ }
    }

    return db.getCD(slot);
  }

  async _ejectDisc() {
    this.serial.send(this.playerId, 'RJ');
    await new Promise(r => setTimeout(r, 1000));
    this.serial.send(this.playerId, 'ZR');
    await this._waitForMode(['P01', 'P20'], 45000);
  }

  _updateProgress(slot, status, message) {
    this.progress.slot = slot;
    this.progress.status = status;
    this.progress.message = message;
    this.emit('progress', { ...this.progress });
  }

  getProgress() {
    return { ...this.progress };
  }

  get isScanning() {
    return this.scanning;
  }
}
