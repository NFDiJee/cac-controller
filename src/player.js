import { EventEmitter } from 'events';
import * as protocol from './protocol.js';
import * as db from './database.js';

export class PlayerManager extends EventEmitter {
  constructor(serial) {
    super();
    this.serial = serial;
    this.players = new Map();
    this._pollTimer = null;
    this.polling = false;

    // Play modes
    this.continuousPlay = false;
    this.gaplessPlay = false;
    this.shuffleMode = 'off';

    // Shuffle state
    this._shuffleHistory = [];
    this._gaplessPrepared = false;

    // Playlist queue (server-side)
    this._playlist = {
      items: [],
      currentIndex: -1,
      active: false,
      currentPlayer: null,
      preloadedPlayer: null,
      _advancing: false,  // guard against double-advance
    };

    // Initialize player states
    this._initPlayer(1);
    this._initPlayer(2);

    // Listen to all serial responses (fire-and-forget pattern)
    this.serial.on('playerResponse', ({ playerId, raw, parsed }) => {
      this._handleResponse(playerId, parsed);
    });
  }

  _initPlayer(id) {
    this.players.set(id, {
      id,
      mode: null,
      modeLabel: '',
      disc: null,
      track: null,
      timeMinutes: 0,
      timeSeconds: 0,
      volume: 255,
      speed: 100,
      toc: null,
      error: null,
      lastUpdate: null,
      // For disc-end detection (track becomes null before mode changes)
      _lastKnownTrack: null,
      // For track-relative time calculation
      _trackStartTotalSeconds: 0,
      _needTrackStartCapture: true,
      trackTimeMinutes: 0,
      trackTimeSeconds: 0,
      // For smooth time display (local interpolation)
      _timeRefPioneer: 0,    // last Pioneer disc-elapsed seconds
      _timeRefLocal: 0,      // Date.now() when that was received
      _trackTimeRefTrack: 0, // last calculated track seconds
      _trackTimeRefLocal: 0, // Date.now() when that was calculated
    });
  }

  getState(playerId) {
    const player = this.players.get(playerId);
    if (!player) return null;
    return { ...player };
  }

  getAllStates() {
    return {
      player1: this.getState(1),
      player2: this.getState(2),
      playModes: {
        continuous: this.continuousPlay,
        gapless: this.gaplessPlay,
        shuffle: this.shuffleMode,
      },
      playlist: this._playlist.active ? {
        active: true,
        currentIndex: this._playlist.currentIndex,
        total: this._playlist.items.length,
      } : { active: false },
    };
  }

  // Play mode setters
  setContinuousPlay(enabled) {
    this.continuousPlay = enabled;
    this.emit('playModeChange', { continuous: enabled, gapless: this.gaplessPlay, shuffle: this.shuffleMode });
  }

  setGaplessPlay(enabled) {
    this.gaplessPlay = enabled;
    this._gaplessPrepared = false;
    this.emit('playModeChange', { continuous: this.continuousPlay, gapless: enabled, shuffle: this.shuffleMode });
  }

  setShuffleMode(mode) {
    this.shuffleMode = mode;
    this._shuffleHistory = [];
    this.emit('playModeChange', { continuous: this.continuousPlay, gapless: this.gaplessPlay, shuffle: mode });
  }

  // ── Polling ──

  startPolling() {
    if (this.polling) this.stopPolling();
    this.polling = true;
    this._pausedPlayers = new Set();

    // Player 1 polling
    setInterval(() => this._poll(1, '?P'), 850);
    setInterval(() => this._poll(1, '?T'), 1000);
    setInterval(() => this._poll(1, '?R'), 1000);
    setInterval(() => this._poll(1, '?Z'), 5000);
    setInterval(() => this._poll(1, '?Q'), 10000);

    // Player 2 polling (offset intervals)
    setInterval(() => this._poll(2, '?P'), 900);
    setInterval(() => this._poll(2, '?T'), 1050);
    setInterval(() => this._poll(2, '?R'), 1100);
    setInterval(() => this._poll(2, '?Z'), 5500);
    setInterval(() => this._poll(2, '?Q'), 10500);

    console.log('[Player] Status polling started');
  }

  _poll(playerId, query) {
    if (!this.serial.isConnected) return;
    if (this._pausedPlayers?.has(playerId)) return;
    this.serial.send(playerId, query);
  }

  pausePollingForPlayer(playerId) {
    if (!this._pausedPlayers) this._pausedPlayers = new Set();
    this._pausedPlayers.add(playerId);
    console.log(`[Player] Polling paused for player ${playerId}`);
  }

  resumePollingForPlayer(playerId) {
    if (this._pausedPlayers) this._pausedPlayers.delete(playerId);
    console.log(`[Player] Polling resumed for player ${playerId}`);
  }

  stopPolling() {
    this.polling = false;
    console.log('[Player] Status polling stopped');
  }

  // ── Play History Tracking ──

  _startPlayTracking(playerId) {
    const player = this.players.get(playerId);
    if (!player || !player.disc || !player.track) return;
    // Finalize any previous open tracking first
    this._finalizePlayTracking(playerId);
    const historyId = db.addPlayHistory(player.disc, player.track, playerId);
    player._playHistoryId = historyId;
    player._playStartedAt = Date.now();
    console.log(`[Stats] Start tracking: player ${playerId}, slot ${player.disc}, track ${player.track}, id ${historyId}`);
  }

  _finalizePlayTracking(playerId) {
    const player = this.players.get(playerId);
    if (!player || !player._playHistoryId) return;
    const elapsed = Math.round((Date.now() - player._playStartedAt) / 1000);
    db.finalizePlayHistory(player._playHistoryId, elapsed);
    console.log(`[Stats] Finalized: id ${player._playHistoryId}, duration ${elapsed}s`);
    player._playHistoryId = null;
    player._playStartedAt = null;
  }

  // ── Response handler (decoupled from commands) ──

  _handleResponse(playerId, parsed) {
    const player = this.players.get(playerId);
    if (!player) return;

    let changed = false;
    const previousMode = player.mode;

    switch (parsed.type) {
      case 'mode':
        if (player.mode !== parsed.raw) {
          console.log(`[Player] Player ${playerId} mode: ${previousMode} → ${parsed.raw} (track ${player.track}, lastTrack ${player.toc?.lastTrack || '?'})`);
          player.mode = parsed.raw;
          player.modeLabel = parsed.label || parsed.raw;
          changed = true;

          // Play started → begin tracking
          if (parsed.id === 'play' && player.disc && player.track) {
            this._startPlayTracking(playerId);
          }
          // Play stopped → finalize tracking
          if (previousMode === 'P04' && parsed.raw !== 'P04') {
            this._finalizePlayTracking(playerId);
          }

          // Detect disc end: was playing → now stopped/paused/parked
          // Use _lastKnownTrack because track gets set to null before mode changes
          if (previousMode === 'P04' && parsed.raw !== 'P04') {
            const lastTrack = player._lastKnownTrack || player.track;
            const isOnLastTrack = player.toc && lastTrack >= player.toc.lastTrack;
            const stoppedMode = ['P01', 'P03', 'P06'].includes(parsed.raw);
            if (stoppedMode && isOnLastTrack) {
              this._onDiscEnded(playerId);
            }
          }
        }
        break;

      case 'disc':
        if (player.disc !== parsed.disc) {
          player.disc = parsed.disc;
          changed = true;
          // Fetch TOC immediately when disc changes
          if (parsed.disc) {
            setTimeout(() => this.serial.send(playerId, '?Q'), 1000);
          }
        }
        break;

      case 'track':
        if (player.track !== parsed.track) {
          const previousTrack = player.track;
          // Remember last real track number for disc-end detection
          if (parsed.track) player._lastKnownTrack = parsed.track;
          player.track = parsed.track;
          // Flag: next time update captures the new track start
          player._needTrackStartCapture = true;
          player.trackTimeMinutes = 0;
          player.trackTimeSeconds = 0;
          changed = true;

          // Track changed while playing → finalize old, start new
          if (player.mode === 'P04' && parsed.track && player.disc) {
            this._startPlayTracking(playerId);
          }

          if (this.gaplessPlay && player.toc && parsed.track === player.toc.lastTrack) {
            this._prepareGapless(playerId);
          }

          // Detect natural track advance (N → N+1) while playing
          if (parsed.track && previousTrack && parsed.track === previousTrack + 1 && player.mode === 'P04') {
            // Playlist: intercept auto-advance if next item differs
            if (this._playlist.active && playerId === this._playlist.currentPlayer) {
              this._playlistOnTrackAdvance(playerId, parsed.track, previousTrack);
            } else if (this.shuffleMode !== 'off') {
              this._onShuffleTrackAdvance(playerId);
            }
          }
        }
        break;

      case 'time': {
        const totalSec = parsed.minutes * 60 + parsed.seconds;
        const prevTotalSec = player._timeRefPioneer;
        const now = Date.now();

        // Detect time jump (seek/skip) - recapture track start immediately
        // Skip during scan mode (P08) to avoid corrupting track-relative time
        if (Math.abs(totalSec - prevTotalSec) > 3 && player.mode !== 'P08') {
          player._trackStartTotalSeconds = totalSec;
          player._needTrackStartCapture = false;
          // Immediately query track to detect track change faster
          this.serial.send(playerId, '?R');
        }

        // Store reference point for interpolation
        player._timeRefPioneer = totalSec;
        player._timeRefLocal = now;
        player.timeMinutes = parsed.minutes;
        player.timeSeconds = parsed.seconds;

        // Capture start time on first time update after track change
        if (player._needTrackStartCapture) {
          player._trackStartTotalSeconds = totalSec;
          player._needTrackStartCapture = false;
        }

        const trackSec = Math.max(0, totalSec - player._trackStartTotalSeconds);
        // Store track time reference for interpolation
        player._trackTimeRefTrack = trackSec;
        player._trackTimeRefLocal = now;

        const newTrackMin = Math.floor(trackSec / 60);
        const newTrackSec = trackSec % 60;
        player.trackTimeMinutes = newTrackMin;
        player.trackTimeSeconds = newTrackSec;
        // Don't emit on every time update — let frontend interpolate
        break;
      }

      case 'toc':
        player.toc = parsed;
        changed = true;
        break;

      case 'error':
        player.error = { code: parsed.code, message: parsed.message };
        changed = true;
        break;
    }

    if (changed) {
      player.lastUpdate = Date.now();
      this.emit('stateChange', { playerId, state: this.getState(playerId) });
    }
  }

  // ── Disc ended / Continuous / Gapless ──

  _onDiscEnded(playerId) {
    console.log(`[Player] Player ${playerId} disc ended`);

    // Playlist mode takes priority
    if (this._playlist.active && playerId === this._playlist.currentPlayer) {
      this._playlistAdvance();
      return;
    }

    const otherId = playerId === 1 ? 2 : 1;
    const otherPlayer = this.players.get(otherId);

    console.log(`[Player] Continuous: ${this.continuousPlay}, other player ${otherId}: disc=${otherPlayer?.disc}, mode=${otherPlayer?.mode}`);

    if (this.continuousPlay && otherPlayer) {
      if (otherPlayer.disc && otherPlayer.mode !== 'P20') {
        console.log(`[Player] Continuous play: switching to player ${otherId}`);
        if (this.gaplessPlay && this._gaplessPrepared) {
          this.play(otherId);
          this._gaplessPrepared = false;
        } else {
          this.serial.send(otherId, 'SA');
          setTimeout(() => this.play(otherId), 500);
        }
        this.emit('continuousSwitch', { from: playerId, to: otherId });
        return;
      }
    }

    if (this.shuffleMode === 'cd') {
      const next = this.getShuffleNextTrack(playerId);
      if (next) this.playTrack(playerId, next);
      return;
    }
    if (this.shuffleMode === 'players') {
      this._shuffleNextFromPlayers(playerId);
      return;
    }
    if (this.shuffleMode === 'all') {
      this._shuffleNextDisc(playerId);
    }
  }

  _prepareGapless(currentPlayerId) {
    if (this._gaplessPrepared) return;

    const otherId = currentPlayerId === 1 ? 2 : 1;
    const otherPlayer = this.players.get(otherId);

    if (!otherPlayer || !otherPlayer.disc || otherPlayer.mode === 'P20') return;

    console.log(`[Player] Gapless: pre-cueing player ${otherId}`);
    this.serial.send(otherId, 'SA');
    setTimeout(() => {
      this.serial.send(otherId, 'TR01SE');
      this._gaplessPrepared = true;
    }, 500);
  }

  // ── Playlist (server-side, dual-player) ──

  startPlaylist(items) {
    console.log(`[Playlist] Starting playlist with ${items.length} items`);
    this._playlist = {
      items: [...items],
      currentIndex: 0,
      active: true,
      currentPlayer: null,
      preloadedPlayer: null,
      preloadedSlot: null,
      _advancing: false,
    };
    this._playlistPlayCurrent();
  }

  stopPlaylist() {
    console.log('[Playlist] Stopped');
    const playerId = this._playlist.currentPlayer;
    this._playlist.active = false;
    this._playlist.currentIndex = -1;
    this._playlist._advancing = false;
    // Stop the currently playing player
    if (playerId) {
      const player = this.players.get(playerId);
      if (player && player.mode === 'P04') {
        this.serial.send(playerId, 'RJ');
      }
    }
    this.emit('playlistUpdate', { active: false });
  }

  getPlaylistState() {
    if (!this._playlist.active) return { active: false };
    return {
      active: true,
      currentIndex: this._playlist.currentIndex,
      total: this._playlist.items.length,
      currentPlayer: this._playlist.currentPlayer,
    };
  }

  _playlistPlayCurrent() {
    const { items, currentIndex } = this._playlist;
    if (currentIndex >= items.length) {
      console.log('[Playlist] Complete');
      this.stopPlaylist();
      this.emit('playlistComplete');
      return;
    }

    const item = items[currentIndex];
    console.log(`[Playlist] Playing item ${currentIndex + 1}/${items.length}: slot=${item.slot} track=${item.track_number}`);

    // Decide which player to use
    const targetPlayer = this._playlistChoosePlayer(item.slot);
    const previousPlayer = this._playlist.currentPlayer;
    this._playlist.currentPlayer = targetPlayer;

    // Stop the previous player if switching to a different one
    if (previousPlayer && previousPlayer !== targetPlayer) {
      const prev = this.players.get(previousPlayer);
      if (prev && (prev.mode === 'P04' || prev.mode === 'P06')) {
        console.log(`[Playlist] Stopping player ${previousPlayer} before switching to ${targetPlayer}`);
        this.serial.send(previousPlayer, 'RJ');
      }
    }

    const player = this.players.get(targetPlayer);

    if (player.disc === item.slot) {
      // CD already loaded — just play the track
      this.playTrack(targetPlayer, item.track_number);
    } else if (this._playlist.preloadedPlayer === targetPlayer && this._playlist.preloadedSlot === item.slot) {
      // CD is being preloaded into this player — wait for it to finish, then play
      console.log(`[Playlist] Waiting for preloaded CD ${item.slot} on player ${targetPlayer}`);
      this._waitForDiscAndPlay(targetPlayer, item.slot, item.track_number);
    } else {
      // Need to load the CD from scratch
      this.loadAndPlay(targetPlayer, item.slot, item.track_number);
    }

    this.emit('playlistUpdate', {
      active: true,
      currentIndex,
      total: items.length,
      currentPlayer: targetPlayer,
      item,
    });

    // Pre-load next item's CD into the other player
    this._playlistPreloadNext();
  }

  _playlistChoosePlayer(slot) {
    const p1 = this.players.get(1);
    const p2 = this.players.get(2);

    // If one player already has the right CD loaded, use it
    if (p1.disc === slot) return 1;
    if (p2.disc === slot) return 2;

    // If one was pre-loaded with this CD (even if disc state hasn't updated yet), use it
    if (this._playlist.preloadedPlayer && this._playlist.preloadedSlot === slot) {
      console.log(`[Playlist] Using preloaded player ${this._playlist.preloadedPlayer} for slot ${slot}`);
      return this._playlist.preloadedPlayer;
    }

    // Use the player that is NOT currently playing
    const current = this._playlist.currentPlayer;
    if (current === 1 && p1.mode === 'P04') return 2;
    if (current === 2 && p2.mode === 'P04') return 1;

    // Default: alternate from current
    if (current === 1) return 2;
    if (current === 2) return 1;
    return 1;
  }

  _playlistPreloadNext() {
    const { items, currentIndex, currentPlayer } = this._playlist;
    this._playlist.preloadedPlayer = null;
    this._playlist.preloadedSlot = null;

    // Scan ahead for the next item that needs a different CD
    for (let i = currentIndex + 1; i < items.length; i++) {
      const nextItem = items[i];
      const p1 = this.players.get(1);
      const p2 = this.players.get(2);

      // If this CD is already in one of the players, no need to preload
      if (p1.disc === nextItem.slot || p2.disc === nextItem.slot) continue;
      // If we already preloaded this slot (still loading), no need again
      if (this._playlist.preloadedSlot === nextItem.slot) break;

      // Found a future item needing a different CD — preload into idle player
      const otherId = currentPlayer === 1 ? 2 : 1;
      const otherPlayer = this.players.get(otherId);

      // Preload if the other player is not actively playing
      if (otherPlayer.mode !== 'P04') {
        console.log(`[Playlist] Pre-loading CD ${nextItem.slot} into player ${otherId} for item ${i + 1}`);
        this.loadDisc(otherId, nextItem.slot);
        this._playlist.preloadedPlayer = otherId;
        this._playlist.preloadedSlot = nextItem.slot;
      }
      break;
    }
  }

  _playlistOnTrackAdvance(playerId, newTrack, previousTrack) {
    // The Pioneer auto-advanced from track N to N+1
    // Check if this matches the next playlist item
    const { items, currentIndex } = this._playlist;
    const nextIndex = currentIndex + 1;

    if (nextIndex >= items.length) {
      // No more items — let the CD play out, disc-end will stop
      return;
    }

    const currentItem = items[currentIndex];
    const nextItem = items[nextIndex];
    const player = this.players.get(playerId);

    // Check if auto-advance landed on exactly the next playlist item
    if (nextItem.slot === player.disc && nextItem.track_number === newTrack) {
      // Perfect match — Pioneer auto-advanced to the right track
      console.log(`[Playlist] Auto-advanced to item ${nextIndex + 1}/${items.length}`);
      this._playlist.currentIndex = nextIndex;
      this.emit('playlistUpdate', {
        active: true,
        currentIndex: nextIndex,
        total: items.length,
        currentPlayer: playerId,
        item: nextItem,
      });
      this._playlistPreloadNext();
    } else {
      // Auto-advance went to the wrong track — jump to the correct one
      console.log(`[Playlist] Auto-advance mismatch: got track ${newTrack}, need slot=${nextItem.slot} track=${nextItem.track_number}`);
      this._playlistAdvance();
    }
  }

  _playlistAdvance() {
    if (!this._playlist.active) return;
    if (this._playlist._advancing) return;
    this._playlist._advancing = true;
    this._playlist.currentIndex++;
    this._playlistPlayCurrent();
    // Reset guard after a short delay (allow mode transitions to settle)
    setTimeout(() => { this._playlist._advancing = false; }, 2000);
  }

  playlistNext() {
    if (!this._playlist.active) return;
    this._playlist._advancing = false; // manual skip overrides guard
    this._playlistAdvance();
  }

  playlistPrevious() {
    if (!this._playlist.active) return;
    this._playlist._advancing = false;
    this._playlist.currentIndex = Math.max(0, this._playlist.currentIndex - 1);
    this._playlist._advancing = true;
    this._playlistPlayCurrent();
    setTimeout(() => { this._playlist._advancing = false; }, 2000);
  }

  // ── Shuffle ──

  _onShuffleTrackAdvance(playerId) {
    // The Pioneer has already auto-advanced to track N+1 on this player.
    // We must stop it before starting the shuffled track.
    if (this.shuffleMode === 'cd') {
      // Same player — playTrack will override, but stop first to prevent brief overlap
      this.serial.send(playerId, 'PA');
      const next = this.getShuffleNextTrack(playerId);
      if (next) setTimeout(() => this.playTrack(playerId, next), 200);
    } else if (this.shuffleMode === 'players') {
      this._shuffleNextFromPlayers(playerId);
    } else if (this.shuffleMode === 'all') {
      this.serial.send(playerId, 'PA');
      setTimeout(() => this._shuffleNextDisc(playerId), 200);
    }
  }

  getShuffleNextTrack(playerId) {
    const player = this.players.get(playerId);
    if (!player || !player.toc) return null;

    const totalTracks = player.toc.lastTrack - player.toc.firstTrack + 1;
    if (totalTracks <= 1) return null;

    let nextTrack;
    let attempts = 0;
    do {
      nextTrack = player.toc.firstTrack + Math.floor(Math.random() * totalTracks);
      attempts++;
    } while (
      this._shuffleHistory.includes(`${playerId}:${nextTrack}`) &&
      attempts < totalTracks * 2
    );

    this._shuffleHistory.push(`${playerId}:${nextTrack}`);
    if (this._shuffleHistory.length > totalTracks * 2) {
      this._shuffleHistory = this._shuffleHistory.slice(-totalTracks);
    }

    return nextTrack;
  }

  _shuffleNextFromPlayers(currentPlayerId) {
    const p1 = this.players.get(1);
    const p2 = this.players.get(2);
    const candidates = [];

    if (p1.disc && p1.toc) {
      for (let i = p1.toc.firstTrack; i <= p1.toc.lastTrack; i++) {
        candidates.push({ playerId: 1, track: i });
      }
    }
    if (p2.disc && p2.toc) {
      for (let i = p2.toc.firstTrack; i <= p2.toc.lastTrack; i++) {
        candidates.push({ playerId: 2, track: i });
      }
    }

    if (candidates.length === 0) return;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];

    // Stop the current player before starting on the new one
    if (currentPlayerId) {
      this.serial.send(currentPlayerId, 'PA');
      setTimeout(() => this.playTrack(pick.playerId, pick.track), 200);
    } else {
      // Find which player is currently playing and stop it if switching
      const playingId = p1.mode === 'P04' ? 1 : (p2.mode === 'P04' ? 2 : null);
      if (playingId && playingId !== pick.playerId) {
        this.serial.send(playingId, 'PA');
        setTimeout(() => this.playTrack(pick.playerId, pick.track), 200);
      } else {
        this.playTrack(pick.playerId, pick.track);
      }
    }
  }

  _shuffleNextDisc(playerId) {
    const maxDiscs = parseInt(db.getSetting('max_discs')) || 300;
    const allCDs = db.getAllCDs();

    if (allCDs.length === 0) {
      const slot = Math.floor(Math.random() * maxDiscs) + 1;
      this.loadAndPlay(playerId, slot, 1);
      return;
    }

    const cd = allCDs[Math.floor(Math.random() * allCDs.length)];
    const track = cd.total_tracks > 0
      ? Math.floor(Math.random() * cd.total_tracks) + 1
      : 1;
    this.loadAndPlay(playerId, cd.slot, track);
  }

  // ── Player Controls (all fire-and-forget) ──

  nextTrack(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;

    // Playlist mode uses dedicated playlistNext() instead
    if (this._playlist.active) return;

    if (this.shuffleMode === 'cd') {
      const next = this.getShuffleNextTrack(playerId);
      if (next) return this.playTrack(playerId, next);
    }
    if (this.shuffleMode === 'players') {
      // Pass currentPlayerId so the current player gets stopped when switching
      return this._shuffleNextFromPlayers(playerId);
    }
    if (this.shuffleMode === 'all') {
      return this._shuffleNextDisc(playerId);
    }

    // Normal next track
    if (player.track) {
      this.playTrack(playerId, player.track + 1);
    }
  }

  previousTrack(playerId) {
    const player = this.players.get(playerId);
    if (player && player.track && player.track > 1) {
      this.playTrack(playerId, player.track - 1);
    }
  }

  loadDisc(playerId, discNumber) {
    const num = String(discNumber).padStart(3, '0');
    this.serial.send(playerId, `${num}ZS`);
  }

  ejectDisc(playerId) {
    this.serial.send(playerId, 'RJ');
    setTimeout(() => this.serial.send(playerId, 'ZR'), 500);
  }

  play(playerId) {
    const player = this.players.get(playerId);
    // Like the old project: query TOC then play
    if (player && (player.mode === 'P01' || player.mode === 'P03' || !player.mode)) {
      this.serial.send(playerId, '?Q');
      setTimeout(() => this.serial.send(playerId, 'PL'), 500);
    } else {
      this.serial.send(playerId, 'PL');
    }
  }

  pause(playerId) {
    this.serial.send(playerId, 'PA');
    setTimeout(() => this.serial.send(playerId, '?P'), 300);
  }

  stop(playerId) {
    // Stop also stops playlist
    if (this._playlist.active) this.stopPlaylist();
    this.serial.send(playerId, 'RJ');
    setTimeout(() => this.serial.send(playerId, '?P'), 300);
  }

  playTrack(playerId, trackNumber) {
    const player = this.players.get(playerId);
    const num = String(trackNumber).padStart(2, '0');
    // If parked/stopped, spin up first then seek+play
    if (player && (player.mode === 'P01' || player.mode === 'P03' || !player.mode)) {
      this.serial.send(playerId, 'SA');
      setTimeout(() => this.serial.send(playerId, `TR${num}SEPL`), 500);
    } else {
      this.serial.send(playerId, `TR${num}SEPL`);
    }
  }

  searchTrack(playerId, trackNumber) {
    const num = String(trackNumber).padStart(2, '0');
    this.serial.send(playerId, `TR${num}SE`);
  }

  scanForward(playerId) {
    this.serial.send(playerId, 'NF');
  }

  scanReverse(playerId) {
    this.serial.send(playerId, 'NR');
  }

  setVolume(playerId, value) {
    const v = Math.max(0, Math.min(255, Math.round(value)));
    const player = this.players.get(playerId);
    if (player) player.volume = v;
    this.serial.send(playerId, `${v}VL`);
  }

  setSpeed(playerId, percent) {
    const s = Math.max(90, Math.min(110, Math.round(percent)));
    const player = this.players.get(playerId);
    if (player) player.speed = s;
    this.serial.send(playerId, `${s}SP`);
  }

  fade(playerId, targetVolume, duration) {
    const v = Math.max(0, Math.min(255, Math.round(targetVolume)));
    const d = Math.max(1, Math.min(99, Math.round(duration)));
    this.serial.send(playerId, `${d}DU${v}FD`);
  }

  startDisc(playerId) {
    this.serial.send(playerId, 'SA');
  }

  clearPlayer(playerId) {
    this.serial.send(playerId, 'CL');
  }

  setStopMarker(playerId, trackNumber) {
    const num = String(trackNumber).padStart(2, '0');
    this.serial.send(playerId, `TR${num}SM`);
  }

  autoCueSearch(playerId, trackNumber) {
    const num = String(trackNumber).padStart(2, '0');
    this.serial.send(playerId, `TR${num}QS`);
  }

  resetChanger(playerId) {
    this.serial.send(playerId, '!!');
  }

  queryTOC(playerId) {
    this.serial.send(playerId, '?Q');
  }

  queryModel(playerId) {
    this.serial.send(playerId, '?X');
  }

  queryDiscStatus(playerId) {
    this.serial.send(playerId, '?K');
  }

  sendRawCommand(playerId, command) {
    this.serial.send(playerId, command);
  }

  _waitForDiscAndPlay(playerId, discNumber, trackNumber) {
    const startTime = Date.now();
    const checkReady = () => {
      const player = this.players.get(playerId);
      if (player && player.disc === discNumber && player.mode && !['P21', 'P22', 'P20'].includes(player.mode)) {
        if (trackNumber) {
          this.playTrack(playerId, trackNumber);
        } else {
          this.play(playerId);
        }
        return;
      }
      if (Date.now() - startTime < 45000) {
        setTimeout(checkReady, 500);
      } else {
        // Timeout — force load
        console.log(`[Playlist] Preload timeout for CD ${discNumber}, forcing load`);
        this.loadAndPlay(playerId, discNumber, trackNumber);
      }
    };
    setTimeout(checkReady, 500);
  }

  loadAndPlay(playerId, discNumber, trackNumber) {
    const num = String(discNumber).padStart(3, '0');
    this.serial.send(playerId, `${num}ZS`);

    // Wait for disc load, then play
    const checkReady = () => {
      const player = this.players.get(playerId);
      // Disc loaded when mode changes from load/unload to park/setup/play
      if (player && player.mode && !['P21', 'P22', 'P20'].includes(player.mode)) {
        if (trackNumber) {
          this.playTrack(playerId, trackNumber);
        } else {
          this.play(playerId);
        }
        return;
      }
      // Retry up to 45s
      if (Date.now() - startTime < 45000) {
        setTimeout(checkReady, 1000);
      }
    };
    const startTime = Date.now();
    setTimeout(checkReady, 2000);
  }
}
