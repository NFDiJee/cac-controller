// ═══════════════════════════════════════════
//  CAC Controller - Frontend Application
// ═══════════════════════════════════════════

// ── State ──
let activePlayer = 1;
let playerStates = { 1: {}, 2: {} };
let playModes = { continuous: false, gapless: false, shuffle: 'off' };
let library = [];
let ws = null;
let wsReconnectTimer = null;
let playlistMode = { active: false, name: '', currentIndex: 0, total: 0 };
let _selectMode = false;
let _selectedSlots = new Set();

// ── Init ──
(async function init() {
  // Detect language: first check server system locale as fallback
  try {
    const localeData = await api('/system/locale');
    if (getStoredLanguagePref() === 'auto' && localeData.lang) {
      // System locale used as base for auto detection
    }
  } catch { /* ignore */ }

  setLanguage(getStoredLanguagePref());
  renderImportFormatExample();
  connectWebSocket();
  loadLibrary();
  loadPlayModes();

  // Set language selector to stored preference
  const langSel = document.getElementById('settLanguage');
  if (langSel) langSel.value = getStoredLanguagePref();
})();

// ── WebSocket ──
function connectWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);
  ws.onopen = () => {
    showConnStatus(true);
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
  };
  ws.onclose = () => {
    showConnStatus(false);
    wsReconnectTimer = setTimeout(connectWebSocket, 3000);
  };
  ws.onerror = () => {};
  ws.onmessage = (e) => handleWSMessage(JSON.parse(e.data));
}

function handleWSMessage(msg) {
  switch (msg.type) {
    case 'init':
      if (msg.data.players) {
        playerStates[1] = msg.data.players.player1 || {};
        playerStates[2] = msg.data.players.player2 || {};
        if (msg.data.players.playModes) {
          playModes = msg.data.players.playModes;
          updatePlayModeUI();
        }
        updatePlayerUI();
      }
      break;
    case 'playerState':
      playerStates[msg.playerId] = msg.data;
      if (msg.playerId === activePlayer) updatePlayerUI();
      break;
    case 'playModeChange':
      playModes = msg.data;
      updatePlayModeUI();
      break;
    case 'continuousSwitch':
      toast(t('playmode.continuous') + `: Player ${msg.data.from} -> ${msg.data.to}`, 'success');
      break;
    case 'playlistUpdate':
      playlistMode.active = msg.data.active;
      playlistMode.currentIndex = msg.data.currentIndex || 0;
      playlistMode.total = msg.data.total || 0;
      if (msg.data.currentPlayer && msg.data.currentPlayer !== activePlayer) {
        activePlayer = msg.data.currentPlayer;
        // Update tab UI
        document.querySelectorAll('.player-tab').forEach(tab => {
          tab.classList.toggle('active', parseInt(tab.dataset.player) === activePlayer);
        });
        _lastTrackListDisc = null;
        updatePlayerUI._lastTrackKey = null;
      }
      updatePlaylistBanner();
      updatePlayerUI();
      break;
    case 'playlistComplete':
      playlistMode.active = false;
      updatePlaylistBanner();
      toast(t('playlists.ended'), 'success');
      break;
    case 'scanProgress':
      updateScanProgress(msg.data);
      break;
    case 'scanComplete':
      toast(t('scanner.complete'), 'success');
      loadLibrary();
      break;
    case 'serialConnected':
      toast(t('conn.serialConnected'), 'success');
      break;
    case 'serialDisconnected':
      toast(t('conn.serialDisconnected'), 'error');
      break;
    case 'serialResponse':
      appendTerminal(`< ${msg.data.raw}`);
      break;
  }
}

function showConnStatus(connected) {
  const el = document.getElementById('connStatus');
  el.textContent = connected ? t('conn.connected') : t('conn.disconnected');
  el.className = 'conn-status ' + (connected ? 'connected' : 'disconnected');
  setTimeout(() => { if (connected) el.classList.add('hidden'); }, 2000);
}

// ── API ──
async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`/api${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'API Error');
  return data;
}

// ── Language ──
function changeLanguage(lang) {
  setLanguage(lang);
  renderImportFormatExample();
  populateLibraryFilterOptions();
  applyLibraryFilters();
  // Persist to server settings too
  api('/settings', 'PUT', { language: lang }).catch(() => {});
}

// ── Play Modes ──
async function loadPlayModes() {
  try {
    playModes = await api('/playmodes');
    updatePlayModeUI();
  } catch { /* ignore */ }
}

function updatePlayModeUI() {
  document.getElementById('chkContinuous').checked = playModes.continuous;
  document.getElementById('chkGapless').checked = playModes.gapless;
  document.querySelectorAll('.shuffle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.shuffle === playModes.shuffle);
    if (btn.dataset.shuffle === playModes.shuffle) {
      btn.style.background = 'var(--accent-dim)';
      btn.style.borderColor = 'var(--accent)';
      btn.style.color = 'var(--accent)';
    } else {
      btn.style.background = '';
      btn.style.borderColor = '';
      btn.style.color = '';
    }
  });
}

async function setPlayMode() {
  try {
    await api('/playmodes', 'PUT', {
      continuous: document.getElementById('chkContinuous').checked,
      gapless: document.getElementById('chkGapless').checked,
    });
  } catch (err) { toast(err.message, 'error'); }
}

async function setShuffle(mode) {
  try {
    playModes = await api('/playmodes', 'PUT', { shuffle: mode });
    updatePlayModeUI();
  } catch (err) { toast(err.message, 'error'); }
}

// ── Player Controls ──
async function playerAction(action) {
  // In playlist mode, redirect controls to playlist API
  if (playlistMode.active) {
    try {
      if (action === 'next') { await api('/playlists/next', 'POST'); return; }
      if (action === 'previous') { await api('/playlists/previous', 'POST'); return; }
      if (action === 'stop') { await api('/playlists/stop', 'POST'); return; }
    } catch (err) { toast(err.message, 'error'); return; }
  }
  try { await api(`/player/${activePlayer}/${action}`, 'POST'); }
  catch (err) { toast(err.message, 'error'); }
}

async function togglePlayPause() {
  // Pause/resume works directly on the active player, also in playlist mode
  const state = playerStates[activePlayer];
  try { await api(`/player/${activePlayer}/${state?.mode === 'P04' ? 'pause' : 'play'}`, 'POST'); }
  catch (err) { toast(err.message, 'error'); }
}

function updatePlaylistBanner() {
  const banner = document.getElementById('playlistBanner');
  if (playlistMode.active) {
    banner.style.display = 'flex';
    document.getElementById('playlistBannerName').textContent =
      `${playlistMode.name || 'Playlist'} — ${t('player.track')} ${playlistMode.currentIndex + 1} / ${playlistMode.total}`;
  } else {
    banner.style.display = 'none';
  }
}

async function loadDisc() {
  const disc = parseInt(document.getElementById('discInput').value);
  const track = parseInt(document.getElementById('trackInput').value) || 0;
  if (!disc || disc < 1 || disc > 300) { toast(t('player.slotRange'), 'error'); return; }
  try {
    await api(`/player/${activePlayer}/load`, 'POST', { disc, track: track || undefined });
    toast(`CD ${disc} ${t('player.loading')}`);
    loadCDTracks(disc);
  } catch (err) { toast(err.message, 'error'); }
}

function onCDSelect(value) {
  if (!value) return;
  const slot = parseInt(value);
  document.getElementById('discInput').value = slot;
  loadCDTracks(slot);
}

async function loadCDTracks(slot) {
  try {
    const cd = await api(`/library/${slot}`);
    if (cd?.tracks?.length > 0) showTrackList(cd);
  } catch { /* not in library */ }
}

function showTrackList(cd) {
  const card = document.getElementById('trackListCard');
  const title = document.getElementById('trackListTitle');
  const list = document.getElementById('trackList');
  title.textContent = cd.title || `CD ${cd.slot}`;
  card.style.display = 'block';
  const _favTitle = t('player.favorite');
  const _plTitle = t('favorites.addToPlaylist');
  list.innerHTML = cd.tracks.map(tr => {
    const dur = formatDuration(tr.duration_seconds);
    const playing = playerStates[activePlayer]?.track === tr.track_number ? ' playing' : '';
    return `<li class="track-item${playing}">
      <span class="track-num" onclick="playTrack(${tr.track_number})">${tr.track_number}</span>
      <div class="track-info" onclick="playTrack(${tr.track_number})">
        <div class="track-title">${escHtml(tr.title || `Track ${tr.track_number}`)}</div>
        ${tr.artist ? `<div class="track-artist">${escHtml(tr.artist)}</div>` : ''}
      </div>
      <span class="track-duration">${dur}</span>
      <div class="star-rating star-rating-sm" id="trackStars-${tr.track_number}"></div>
      <button class="btn-icon btn-fav-track" id="trackFav-${tr.track_number}" onclick="event.stopPropagation();toggleFavForTrack(${cd.slot},${tr.track_number})" title="${escAttr(_favTitle)}">&#9825;</button>
      <button class="btn-icon btn-add-playlist" onclick="event.stopPropagation();showAddToPlaylist(${cd.slot},${tr.track_number})" title="${escAttr(_plTitle)}">+</button>
    </li>`;
  }).join('');
  // Load per-track ratings, CD rating, and favorites
  loadTrackRatings(cd.slot, cd.tracks);
  loadCDRating(cd.slot);
  loadTrackFavorites(cd.slot, cd.tracks);
}

async function loadTrackFavorites(slot, tracks) {
  try {
    const favs = await api('/favorites');
    for (const t of tracks) {
      const btn = document.getElementById(`trackFav-${t.track_number}`);
      if (!btn) continue;
      const isFav = favs.some(f => f.slot === slot && f.track_number === t.track_number);
      btn.innerHTML = isFav ? '&#9829;' : '&#9825;';
      btn.classList.toggle('active', isFav);
    }
  } catch { /* ignore */ }
}

async function loadTrackRatings(slot, tracks) {
  try {
    const all = await api('/ratings');
    const slotRatings = all.filter(r => r.slot === slot && r.track_number > 0);
    const ratingMap = {};
    slotRatings.forEach(r => { ratingMap[r.track_number] = r.rating; });
    for (const t of tracks) {
      const container = document.getElementById(`trackStars-${t.track_number}`);
      if (container) renderTrackStarsInline(container, slot, t.track_number, ratingMap[t.track_number] || 0);
    }
  } catch {
    for (const t of tracks) {
      const container = document.getElementById(`trackStars-${t.track_number}`);
      if (container) renderTrackStarsInline(container, slot, t.track_number, 0);
    }
  }
}

async function playTrack(num) {
  try { await api(`/player/${activePlayer}/track/${num}`, 'POST'); }
  catch (err) { toast(err.message, 'error'); }
}

function onVolumeChange(value) {
  document.getElementById('volValue').textContent = `${Math.round(value / 255 * 100)}%`;
  clearTimeout(onVolumeChange._t);
  onVolumeChange._t = setTimeout(() => {
    api(`/player/${activePlayer}/volume`, 'POST', { value: parseInt(value) }).catch(() => {});
  }, 100);
}

function onSpeedChange(value) {
  document.getElementById('speedValue').textContent = `${value}%`;
  clearTimeout(onSpeedChange._t);
  onSpeedChange._t = setTimeout(() => {
    api(`/player/${activePlayer}/speed`, 'POST', { value: parseInt(value) }).catch(() => {});
  }, 100);
}

// ── Time Display (local 1s tick) ──
let _timeRef = { trackSec: 0, discSec: 0, localMs: 0, playing: false, disc: null,
                 _lastPioneerDisc: -1, _lastPioneerTrack: -1 };

function syncTimeRef(state) {
  const newPlaying = state.mode === 'P04';
  const pioneerDisc = (state.timeMinutes || 0) * 60 + (state.timeSeconds || 0);
  const pioneerTrack = (state.trackTimeMinutes || 0) * 60 + (state.trackTimeSeconds || 0);

  // Only resync reference when Pioneer value actually changed
  if (pioneerDisc !== _timeRef._lastPioneerDisc || pioneerTrack !== _timeRef._lastPioneerTrack
      || newPlaying !== _timeRef.playing) {
    _timeRef._lastPioneerDisc = pioneerDisc;
    _timeRef._lastPioneerTrack = pioneerTrack;
    _timeRef.trackSec = pioneerTrack;
    _timeRef.discSec = pioneerDisc;
    _timeRef.localMs = Date.now();
  }

  _timeRef.playing = newPlaying;
  _timeRef.disc = state.disc;
}

function updateTimeDisplay() {
  let trackSec = _timeRef.trackSec;
  let discSec = _timeRef.discSec;

  if (_timeRef.playing && _timeRef.localMs > 0) {
    const elapsed = Math.floor((Date.now() - _timeRef.localMs) / 1000);
    trackSec += elapsed;
    discSec += elapsed;
  }

  const time = document.getElementById('npTime');
  time.textContent = _timeRef.localMs > 0
    ? `${String(Math.floor(trackSec / 60)).padStart(2, '0')}:${String(trackSec % 60).padStart(2, '0')}`
    : '--:--';

  const discTime = document.getElementById('npDiscTime');
  if (_timeRef.disc && _timeRef.localMs > 0) {
    const elStr = `${String(Math.floor(discSec / 60)).padStart(2, '0')}:${String(discSec % 60).padStart(2, '0')}`;
    const cd = library.find(c => c.slot === _timeRef.disc);
    const totalSec = cd?.total_duration_seconds;
    const totStr = totalSec
      ? `${String(Math.floor(totalSec / 60)).padStart(2, '0')}:${String(totalSec % 60).padStart(2, '0')}`
      : '--:--';
    discTime.textContent = `CD ${elStr} | ${totStr}`;
  } else {
    discTime.textContent = '';
  }
}

setInterval(updateTimeDisplay, 1000);

// ── Player UI Update ──
function updatePlayerUI() {
  const state = playerStates[activePlayer];
  if (!state) return;

  const badge = document.getElementById('statusBadge');
  const modeId = state.mode ? getModeId(state.mode) : 'unset';
  badge.textContent = state.mode ? t(`mode.${modeId}`) : t('mode.unset');
  badge.className = 'status-badge status-' + modeId;

  // Sync time reference from server state
  syncTimeRef(state);
  updateTimeDisplay();

  const info = document.getElementById('npInfo');
  const discStr = state.disc ? String(state.disc).padStart(3, '0') : '---';
  const trackStr = state.track ? String(state.track).padStart(2, '0') : '--';
  info.textContent = `${t('player.slot')} ${discStr} | ${t('player.track')} ${trackStr}`;

  const iconEl = document.getElementById('iconPlay');
  iconEl.innerHTML = state.mode === 'P04'
    ? '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>'
    : '<polygon points="6,4 20,12 6,20"/>';

  updateNowPlayingInfo(state.disc, state.track);
  updateTrackListForPlayer(state.disc);

  // Load fav/rating when track changes
  const trackKey = `${activePlayer}:${state.disc}:${state.track}`;
  if (updatePlayerUI._lastTrackKey !== trackKey) {
    updatePlayerUI._lastTrackKey = trackKey;
    loadCurrentTrackMeta();
  }
}

// Track list for the active player's disc
let _lastTrackListDisc = null;
function updateTrackListForPlayer(disc) {
  const card = document.getElementById('trackListCard');
  if (!disc) { card.style.display = 'none'; _lastTrackListDisc = null; return; }

  const discChanged = _lastTrackListDisc !== disc;

  if (discChanged) {
    _lastTrackListDisc = disc;
    // Full rebuild only on disc change
    const cd = library.find(c => c.slot === disc);
    if (cd && cd.tracks?.length > 0) {
      showTrackList(cd);
    } else {
      loadCDTracks(disc);
    }
  } else {
    // Just update playing highlight without rebuilding
    updateTrackListHighlight();
  }
}

function updateTrackListHighlight() {
  const currentTrack = playerStates[activePlayer]?.track;
  document.querySelectorAll('#trackList .track-item').forEach(li => {
    const num = parseInt(li.querySelector('.track-num')?.textContent);
    li.classList.toggle('playing', num === currentTrack);
  });
}

function updateNowPlayingInfo(disc, track) {
  const titleEl = document.getElementById('npTitle');
  const artistEl = document.getElementById('npArtist');
  const artEl = document.getElementById('albumArt');

  if (!disc) {
    titleEl.textContent = t('player.noDisc');
    artistEl.innerHTML = '&nbsp;';
    artEl.innerHTML = '<span class="placeholder">&#9834;</span>';
    return;
  }

  const cd = library.find(c => c.slot === disc);
  if (cd) {
    const trackInfo = cd.tracks?.find(tr => tr.track_number === track);
    titleEl.textContent = trackInfo?.title || cd.title || `CD ${disc}`;
    artistEl.textContent = trackInfo?.artist || cd.artist || '';
    if (cd.cover_url) {
      artEl.innerHTML = `<img src="${escHtml(cd.cover_url)}" alt="Cover" onerror="this.parentElement.innerHTML='<span class=placeholder>&#9834;</span>'">`;
    } else {
      artEl.innerHTML = '<span class="placeholder">&#9834;</span>';
    }
  } else {
    titleEl.textContent = `CD ${disc}`;
    artistEl.innerHTML = '&nbsp;';
    artEl.innerHTML = '<span class="placeholder">&#9834;</span>';
  }
}

function getModeId(code) {
  const map = { 'P01':'park','P02':'setup','P03':'reject','P04':'play','P06':'pause','P07':'search','P08':'scan','P20':'unset','P21':'load','P22':'unload' };
  return map[code] || 'stop';
}

// ── Player Tabs ──
document.querySelectorAll('.player-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.player-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activePlayer = parseInt(tab.dataset.player);
    _lastTrackListDisc = null;
    updatePlayerUI._lastTrackKey = null;
    updatePlayerUI();
  });
});

// ── Navigation ──
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${name}`).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  event.currentTarget.classList.add('active');
  if (name === 'library') loadLibrary();
  if (name === 'favorites') loadFavoritesPage();
  if (name === 'playlists') loadPlaylists();
  if (name === 'more') loadMoreData();
}

function showPageDirect(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${name}`).classList.add('active');
  const pages = ['player','library','favorites','playlists','more'];
  document.querySelectorAll('.nav-item').forEach((n, i) => {
    n.classList.toggle('active', pages.indexOf(name) === i);
  });
}

// ── Library ──
async function loadLibrary() {
  try {
    library = await api('/library');
    populateLibraryFilterOptions();
    applyLibraryFilters();
    updateCDSelect();
    updatePlayerUI();
    loadRatingsFavsCache(); // Pre-fill cache in background
  } catch (err) { console.error('Library load failed:', err); }
}

function populateLibraryFilterOptions() {
  const genres = new Set(), artists = new Set(), years = new Set(), labels = new Set();
  for (const cd of library) {
    if (cd.genre) genres.add(cd.genre);
    if (cd.artist) artists.add(cd.artist);
    if (cd.year) { const m = cd.year.match(/(\d{4})/); if (m) years.add(m[1]); }
    if (cd.label) labels.add(cd.label);
  }
  fillFilterSelect('filterGenre', t('library.allGenres'), [...genres].sort());
  fillFilterSelect('filterArtist', t('library.allArtists'), [...artists].sort());
  fillFilterSelect('filterYear', t('library.allYears'), [...years].sort().reverse());
  fillFilterSelect('filterLabel', t('library.allLabels'), [...labels].sort());
}

function fillFilterSelect(id, allLabel, values) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = `<option value="">${allLabel}</option>` +
    values.map(v => `<option value="${escAttr(v)}">${escHtml(v)}</option>`).join('');
  if (cur && values.includes(cur)) sel.value = cur;
}

function fillCDEditorFilterSelect(id, allLabel, values) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = `<option value="">${allLabel}</option>` +
    `<option value="__empty__">${t('cdeditor.noValue')}</option>` +
    values.map(v => `<option value="${escAttr(v)}">${escHtml(v)}</option>`).join('');
  if (cur && (cur === '__empty__' || values.includes(cur))) sel.value = cur;
}

function applyLibraryFilters() {
  const query = (document.getElementById('librarySearch')?.value || '').toLowerCase();
  const genre = document.getElementById('filterGenre')?.value || '';
  const artist = document.getElementById('filterArtist')?.value || '';
  const year = document.getElementById('filterYear')?.value || '';
  const label = document.getElementById('filterLabel')?.value || '';
  const sort = document.getElementById('filterSort')?.value || 'slot';

  let filtered = library.filter(cd => {
    if (genre && cd.genre !== genre) return false;
    if (artist && cd.artist !== artist) return false;
    if (year) { const m = (cd.year||'').match(/(\d{4})/); if (!m || m[1] !== year) return false; }
    if (label && cd.label !== label) return false;
    if (query) {
      const q = query;
      if (!(cd.title||'').toLowerCase().includes(q) &&
          !(cd.artist||'').toLowerCase().includes(q) &&
          !(cd.genre||'').toLowerCase().includes(q) &&
          !String(cd.slot).includes(q)) return false;
    }
    return true;
  });

  // Sort
  const cmp = (a, b) => (a||'').localeCompare(b||'', 'de', { sensitivity: 'base' });
  switch (sort) {
    case 'title': filtered.sort((a, b) => cmp(a.title, b.title)); break;
    case 'artist': filtered.sort((a, b) => cmp(a.artist, b.artist) || cmp(a.title, b.title)); break;
    case 'year-desc': filtered.sort((a, b) => (b.year||'').localeCompare(a.year||'') || cmp(a.title, b.title)); break;
    case 'year-asc': filtered.sort((a, b) => (a.year||'').localeCompare(b.year||'') || cmp(a.title, b.title)); break;
    case 'genre': filtered.sort((a, b) => cmp(a.genre, b.genre) || cmp(a.artist, b.artist)); break;
    default: filtered.sort((a, b) => a.slot - b.slot); break;
  }

  renderLibrary(filtered);
}

function resetLibraryFilters() {
  document.getElementById('librarySearch').value = '';
  document.getElementById('filterGenre').value = '';
  document.getElementById('filterArtist').value = '';
  document.getElementById('filterYear').value = '';
  document.getElementById('filterLabel').value = '';
  document.getElementById('filterSort').value = 'slot';
  applyLibraryFilters();
}

function renderLibrary(cds) {
  const grid = document.getElementById('cdGrid');
  const empty = document.getElementById('libraryEmpty');
  const count = document.getElementById('libraryCount');
  if (count) count.textContent = t('library.countOf', cds.length, library.length);
  if (cds.length === 0) { grid.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  grid.innerHTML = cds.map(cd => `
    <div class="cd-card ${_selectMode ? 'select-mode' : ''} ${_selectedSlots.has(cd.slot) ? 'selected' : ''}"
         onclick="${_selectMode ? `toggleCDSelection(${cd.slot})` : `showCDDetail(${cd.slot})`}">
      ${_selectMode ? `<div class="cd-select-check">${_selectedSlots.has(cd.slot) ? '&#9745;' : '&#9744;'}</div>` : ''}
      <div class="cd-art">
        ${cd.cover_url
          ? `<img src="${escHtml(cd.cover_url)}" alt="" onerror="this.parentElement.innerHTML='<span style=color:var(--text-muted);font-size:2rem>&#9834;</span>'">`
          : `<span style="color:var(--text-muted);font-size:2rem">&#9834;</span>`}
      </div>
      <div class="cd-slot">Slot ${String(cd.slot).padStart(3, '0')}</div>
      <div class="cd-name">${escHtml(cd.title || `CD ${cd.slot}`)}</div>
      <div class="cd-artist-name">${escHtml(cd.artist || '')}</div>
    </div>
  `).join('');
}

function filterLibrary(query) {
  applyLibraryFilters();
}

function updateCDSelect() {
  const sel = document.getElementById('cdSelect');
  const cur = sel.value;
  sel.innerHTML = `<option value="">${t('player.selectCD')}</option>` +
    library.map(cd => `<option value="${cd.slot}">${String(cd.slot).padStart(3,'0')} - ${escHtml(cd.title||t('library.unknown'))} ${cd.artist?'('+escHtml(cd.artist)+')':''}</option>`).join('');
  if (cur) sel.value = cur;
}

let _cdModalSlot = null;

let _ratingsCache = null, _favsCache = null;

async function loadRatingsFavsCache() {
  if (!_ratingsCache) try { _ratingsCache = await api('/ratings'); } catch { _ratingsCache = []; }
  if (!_favsCache) try { _favsCache = await api('/favorites'); } catch { _favsCache = []; }
}

function invalidateRatingsFavsCache() { _ratingsCache = null; _favsCache = null; }

async function showCDDetail(slot) {
  try {
    // Parallel: CD data + ratings/favs cache
    const [cd] = await Promise.all([api(`/library/${slot}`), loadRatingsFavsCache()]);
    _cdModalSlot = slot;

    const ratings = _ratingsCache || [];
    const favs = _favsCache || [];

    const cdRating = (ratings.find(r => r.slot === slot && r.track_number === 0) || {}).rating || 0;
    const cdFav = favs.some(f => f.slot === slot && (f.track_number || 0) === 0);

    document.getElementById('modalTitle').textContent = cd.title || `CD ${slot}`;
    document.getElementById('modalContent').innerHTML = `
      <div class="cd-detail-row">
        ${cd.cover_url ? `<img class="cd-detail-cover" src="${escHtml(cd.cover_url)}" alt="">` : ''}
        <div class="cd-detail-meta">
          <div><strong>${escHtml(cd.artist || '')}</strong></div>
          <div style="font-size:0.82rem;color:var(--text-dim)">
            Slot ${cd.slot}${((cd.year||'').match(/(\d{4})/)||[])[1] ? ' · '+((cd.year||'').match(/(\d{4})/)||[])[1] : ''} · ${cd.total_tracks} ${t('library.tracks')} · ${formatDuration(cd.total_duration_seconds)}
            ${cd.genre ? ' · '+escHtml(cd.genre) : ''}${cd.label ? ' · '+escHtml(cd.label) : ''}
          </div>
        </div>
        <button class="btn btn-dim btn-sm" onclick="showEditCD(${cd.slot})">${t('library.edit')}</button>
      </div>

      <div class="cd-modal-rating-row">
        <div class="star-rating" id="cdModalStars">${cdModalStarsHtml(slot, cdRating)}</div>
        <button class="btn-icon btn-fav${cdFav ? ' active' : ''}" id="cdModalFav" onclick="toggleCdModalFav(${slot})">${cdFav ? '&#9829;' : '&#9825;'}</button>
      </div>

      ${cd.tracks?.length > 0 ? `<div class="cd-detail-tracks">${cd.tracks.map(tr => {
        const trRating = (ratings.find(r => r.slot === slot && r.track_number === tr.track_number) || {}).rating || 0;
        const trFav = favs.some(f => f.slot === slot && f.track_number === tr.track_number);
        return `
        <div class="track-row" onclick="loadCdModalTrack(${slot},${tr.track_number})">
          <span class="track-num">${tr.track_number}</span>
          <span class="track-name">${escHtml(tr.title||'Track '+tr.track_number)}</span>
          <span class="track-stars-sm" id="cdmStars-${tr.track_number}">${cdModalTrackStarsHtml(slot, tr.track_number, trRating)}</span>
          <button class="btn-icon btn-fav-sm${trFav ? ' active' : ''}" id="cdmFav-${tr.track_number}" onclick="event.stopPropagation();toggleCdModalTrackFav(${slot},${tr.track_number})">
            ${trFav ? '&#9829;' : '&#9825;'}
          </button>
          <button class="btn-icon btn-playlist-sm" onclick="event.stopPropagation();showPlaylistPickerForTrack(${slot},${tr.track_number})" title="${t('library.addToPlaylist')}">+</button>
          <span class="track-dur">${formatDuration(tr.duration_seconds)}</span>
        </div>`;
      }).join('')}</div>` : ''}

      <div class="cd-detail-actions">
        <button class="btn btn-accent" onclick="loadCdFromModal(1)">${t('library.loadP1')}</button>
        <button class="btn btn-accent" onclick="loadCdFromModal(2)">${t('library.loadP2')}</button>
        <button class="btn btn-dim" onclick="showCdModalPlaylistMenu(${slot})">${t('library.addToPlaylist')}</button>
      </div>

      <div id="cdModalPlaylistMenu" class="playlist-add-menu" style="display:none"></div>
    `;
    document.getElementById('cdDetailModal').classList.add('active');
  } catch (err) { toast(err.message, 'error'); }
}

function cdModalStarsHtml(slot, rating) {
  return Array.from({length: 5}, (_, i) => {
    const filled = i < rating;
    return `<span class="${filled ? 'active' : ''}" onclick="event.stopPropagation();rateCdModal(${slot},${i+1})">${filled ? '&#9733;' : '&#9734;'}</span>`;
  }).join('');
}

function cdModalTrackStarsHtml(slot, trackNumber, rating) {
  return Array.from({length: 5}, (_, i) => {
    const filled = i < rating;
    return `<span class="${filled ? 'active' : ''}" onclick="event.stopPropagation();rateCdModalTrack(${slot},${trackNumber},${i+1})">${filled ? '&#9733;' : '&#9734;'}</span>`;
  }).join('');
}

async function rateCdModal(slot, rating) {
  try {
    const current = await api(`/ratings/${slot}/0`);
    const newRating = current.rating === rating ? 0 : rating;
    await api('/ratings', 'POST', { slot, track: 0, rating: newRating });
    invalidateRatingsFavsCache();
    document.getElementById('cdModalStars').innerHTML = cdModalStarsHtml(slot, newRating);
  } catch (err) { toast(err.message, 'error'); }
}

async function rateCdModalTrack(slot, trackNumber, rating) {
  try {
    const current = await api(`/ratings/${slot}/${trackNumber}`);
    const newRating = current.rating === rating ? 0 : rating;
    await api('/ratings', 'POST', { slot, track: trackNumber, rating: newRating });
    invalidateRatingsFavsCache();
    const el = document.getElementById(`cdmStars-${trackNumber}`);
    if (el) el.innerHTML = cdModalTrackStarsHtml(slot, trackNumber, newRating);
  } catch (err) { toast(err.message, 'error'); }
}

async function toggleCdModalFav(slot) {
  try {
    invalidateRatingsFavsCache();
    const result = await api('/favorites/toggle', 'POST', { slot, track: 0 });
    const btn = document.getElementById('cdModalFav');
    if (btn) {
      btn.innerHTML = result.favorite ? '&#9829;' : '&#9825;';
      btn.classList.toggle('active', result.favorite);
    }
  } catch (err) { toast(err.message, 'error'); }
}

async function toggleCdModalTrackFav(slot, trackNumber) {
  try {
    invalidateRatingsFavsCache();
    const result = await api('/favorites/toggle', 'POST', { slot, track: trackNumber });
    const btn = document.getElementById(`cdmFav-${trackNumber}`);
    if (btn) {
      btn.innerHTML = result.favorite ? '&#9829;' : '&#9825;';
      btn.classList.toggle('active', result.favorite);
    }
  } catch (err) { toast(err.message, 'error'); }
}

function loadCdFromModal(playerId) {
  if (!_cdModalSlot) return;
  closeModal('cdDetailModal');
  api(`/player/${playerId}/load`, 'POST', { disc: _cdModalSlot, track: 1 })
    .then(() => { toast(`CD ${_cdModalSlot} → ${t('player.player'+playerId)}`); showPageDirect('player'); })
    .catch(err => toast(err.message, 'error'));
}

function loadCdModalTrack(slot, track) {
  closeModal('cdDetailModal');
  api(`/player/${activePlayer}/load`, 'POST', { disc: slot, track })
    .then(() => { toast(`CD ${slot}, Track ${track} ${t('player.loading')}`); showPageDirect('player'); })
    .catch(err => toast(err.message, 'error'));
}

async function showCdModalPlaylistMenu(slot) {
  try {
    const playlists = await api('/playlists');
    const menu = document.getElementById('cdModalPlaylistMenu');
    menu.innerHTML = `
      <div class="playlist-add-header">
        <span>${t('playlists.addTo')}</span>
        <button class="modal-close" onclick="document.getElementById('cdModalPlaylistMenu').style.display='none'">&times;</button>
      </div>
      <div class="playlist-add-list">
        ${playlists.length === 0
          ? `<div style="color:var(--text-dim);padding:8px;font-size:0.85rem">${t('playlists.empty')}</div>`
          : playlists.map(pl => `
            <div class="playlist-pick-item" onclick="addCdToModalPlaylist(${pl.id},${slot})">
              <span>${escHtml(pl.name)}</span>
              <span class="playlist-count">${pl.item_count || 0}</span>
            </div>`).join('')}
      </div>
      <div class="playlist-add-new">
        <input type="text" id="cdModalNewPlaylistName" class="form-input" placeholder="${t('library.newPlaylistName')}">
        <button class="btn btn-accent btn-sm" onclick="createAndAddCdToPlaylist(${slot})">${t('playlists.createBtn')}</button>
      </div>
    `;
    menu.style.display = 'block';
  } catch (err) { toast(err.message, 'error'); }
}

async function addCdToModalPlaylist(playlistId, slot) {
  try {
    const cd = await api(`/library/${slot}`);
    const tracks = cd.tracks || [];
    if (tracks.length > 0) {
      for (const tr of tracks) {
        await api(`/playlists/${playlistId}/items`, 'POST', { slot, track: tr.track_number });
      }
    } else {
      await api(`/playlists/${playlistId}/items`, 'POST', { slot, track: 0 });
    }
    toast(t('playlists.added'));
    document.getElementById('cdModalPlaylistMenu').style.display = 'none';
  } catch (err) { toast(err.message, 'error'); }
}

async function createAndAddCdToPlaylist(slot) {
  const input = document.getElementById('cdModalNewPlaylistName');
  const name = input.value.trim();
  if (!name) return;
  try {
    const pl = await api('/playlists', 'POST', { name });
    input.value = '';
    await addCdToModalPlaylist(pl.id, slot);
  } catch (err) { toast(err.message, 'error'); }
}

async function showPlaylistPickerForTrack(slot, trackNumber) {
  try {
    const playlists = await api('/playlists');
    document.getElementById('modalTitle').textContent = t('playlists.addTo');
    document.getElementById('modalContent').innerHTML = `
      ${playlists.map(pl => `
        <div class="playlist-pick-item" onclick="addTrackToPickedPlaylist(${pl.id},${slot},${trackNumber})">
          <span>${escHtml(pl.name)}</span>
          <span class="playlist-count">${pl.item_count || 0}</span>
        </div>`).join('')}
      <div class="playlist-add-new" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
        <input type="text" id="pickerNewPl" class="form-input" placeholder="${t('library.newPlaylistName')}">
        <button class="btn btn-accent btn-sm" onclick="createAndAddTrackToPlaylist(${slot},${trackNumber})">${t('playlists.createBtn')}</button>
      </div>
    `;
    document.getElementById('cdDetailModal').classList.add('active');
  } catch (err) { toast(err.message, 'error'); }
}

async function addTrackToPickedPlaylist(playlistId, slot, trackNumber) {
  try {
    await api(`/playlists/${playlistId}/items`, 'POST', { slot, track: trackNumber });
    toast(t('playlists.added'));
    showCDDetail(slot); // Return to CD detail
  } catch (err) { toast(err.message, 'error'); }
}

async function createAndAddTrackToPlaylist(slot, trackNumber) {
  const input = document.getElementById('pickerNewPl');
  const name = input.value.trim();
  if (!name) return;
  try {
    const pl = await api('/playlists', 'POST', { name });
    await addTrackToPickedPlaylist(pl.id, slot, trackNumber);
  } catch (err) { toast(err.message, 'error'); }
}

async function loadAndPlayCD(slot) {
  closeModal('cdDetailModal');
  document.getElementById('discInput').value = slot;
  try {
    await api(`/player/${activePlayer}/load`, 'POST', { disc: slot, track: 1 });
    toast(`CD ${slot} ${t('player.loading')}`);
    loadCDTracks(slot);
    showPageDirect('player');
  } catch (err) { toast(err.message, 'error'); }
}

async function loadAndPlayTrack(slot, track) {
  closeModal('cdDetailModal');
  try {
    await api(`/player/${activePlayer}/load`, 'POST', { disc: slot, track });
    toast(`CD ${slot}, Track ${track} ${t('player.loading')}`);
    showPageDirect('player');
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteCD(slot) {
  if (!confirm(t('library.deleteConfirm'))) return;
  try {
    await api(`/library/${slot}`, 'DELETE');
    toast(t('library.deleted'));
    closeModal('cdDetailModal');
    loadLibrary();
  } catch (err) { toast(err.message, 'error'); }
}

function toggleSelectMode() {
  _selectMode = !_selectMode;
  _selectedSlots.clear();
  const btn = document.getElementById('btnSelectMode');
  btn.classList.toggle('btn-primary', _selectMode);
  // Show/hide bulk action buttons
  ['btnSelectAll', 'btnDeselectAll', 'btnDeleteSelected', 'btnDeleteAll'].forEach(id => {
    document.getElementById(id).style.display = _selectMode ? '' : 'none';
  });
  updateDeleteSelectedCount();
  applyLibraryFilters();
}

function toggleCDSelection(slot) {
  if (_selectedSlots.has(slot)) _selectedSlots.delete(slot);
  else _selectedSlots.add(slot);
  updateDeleteSelectedCount();
  applyLibraryFilters();
}

function librarySelectAll() {
  // Select all currently visible (filtered) CDs
  document.querySelectorAll('#cdGrid .cd-card').forEach(card => {
    const onclick = card.getAttribute('onclick');
    const m = onclick.match(/toggleCDSelection\((\d+)\)/);
    if (m) _selectedSlots.add(parseInt(m[1]));
  });
  updateDeleteSelectedCount();
  applyLibraryFilters();
}

function libraryDeselectAll() {
  _selectedSlots.clear();
  updateDeleteSelectedCount();
  applyLibraryFilters();
}

function updateDeleteSelectedCount() {
  const btn = document.getElementById('btnDeleteSelected');
  if (btn) {
    btn.textContent = _selectedSlots.size > 0
      ? `${t('library.deleteSelected')} (${_selectedSlots.size})`
      : t('library.deleteSelected');
  }
}

async function deleteSelectedCDs() {
  if (_selectedSlots.size === 0) { toast(t('library.noneSelected'), 'error'); return; }
  if (!confirm(`${_selectedSlots.size} ${t('library.deleteSelectedConfirm')}`)) return;
  try {
    const result = await api('/library/bulk-delete', 'POST', { slots: [..._selectedSlots] });
    toast(`${result.deleted} ${t('library.deletedCount')}`, 'success');
    _selectedSlots.clear();
    updateDeleteSelectedCount();
    loadLibrary();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteAllCDs() {
  if (!confirm(t('library.deleteAllConfirm'))) return;
  const allSlots = library.map(cd => cd.slot);
  try {
    const result = await api('/library/bulk-delete', 'POST', { slots: allSlots });
    toast(`${result.deleted} ${t('library.deletedCount')}`, 'success');
    _selectedSlots.clear();
    if (_selectMode) toggleSelectMode();
    loadLibrary();
  } catch (err) { toast(err.message, 'error'); }
}

function showEditCD(slot) {
  const cd = library.find(c => c.slot === slot);
  if (!cd) return;
  document.getElementById('modalTitle').textContent = t('edit.title');
  document.getElementById('modalContent').innerHTML = `
    <div class="form-group"><label class="form-label">${t('edit.cdTitle')}</label><input type="text" class="form-input" id="editTitle" value="${escAttr(cd.title||'')}"></div>
    <div class="form-group"><label class="form-label">${t('edit.artist')}</label><input type="text" class="form-input" id="editArtist" value="${escAttr(cd.artist||'')}"></div>
    <div class="form-group"><label class="form-label">${t('edit.year')}</label><input type="text" class="form-input" id="editYear" value="${escAttr(cd.year||'')}"></div>
    <div class="form-group"><label class="form-label">${t('edit.genre')}</label><input type="text" class="form-input" id="editGenre" value="${escAttr(cd.genre||'')}"></div>
    <div class="form-group"><label class="form-label">${t('edit.label')}</label><input type="text" class="form-input" id="editLabel" value="${escAttr(cd.label||'')}"></div>
    <div class="form-group"><label class="form-label">${t('edit.cover')}</label><input type="text" class="form-input" id="editCover" value="${escAttr(cd.cover_url||'')}"></div>
    <div class="form-group">
      <label class="form-label">${t('cover.upload')}</label>
      <div class="cover-upload-area" id="coverUploadArea">
        <div class="cover-preview" id="coverPreview">
          ${cd.cover_url ? `<img src="${escHtml(cd.cover_url)}" id="coverPreviewImg">` : `<span class="cover-placeholder">${t('cover.dragHint')}</span>`}
        </div>
        <input type="file" id="coverFileInput" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="handleCoverFile(this.files[0], ${slot})">
        <div class="cover-upload-controls">
          <button class="btn btn-sm" type="button" onclick="document.getElementById('coverFileInput').click()">${t('cover.selectFile')}</button>
          <select class="form-input" id="coverFormat" style="max-width:100px;font-size:0.75rem">
            <option value="auto">Auto</option>
            <option value="image/jpeg">JPEG</option>
            <option value="image/png">PNG</option>
            <option value="image/webp">WebP</option>
          </select>
          <select class="form-input" id="coverSize" style="max-width:100px;font-size:0.75rem">
            <option value="0">${t('cover.original')}</option>
            <option value="300">300px</option>
            <option value="500" selected>500px</option>
            <option value="800">800px</option>
          </select>
        </div>
        <div class="cover-upload-info" id="coverInfo"></div>
        <button class="btn btn-primary btn-sm" id="coverUploadBtn" style="display:none" onclick="uploadCover(${slot})">${t('cover.upload')}</button>
      </div>
    </div>
    <div class="form-group"><label class="form-label">${t('edit.notes')}</label><textarea class="form-input" id="editNotes">${escHtml(cd.notes||'')}</textarea></div>
    <button class="btn btn-primary btn-block" onclick="saveCD(${slot})">${t('edit.save')}</button>
  `;
  // Setup drag & drop
  const area = document.getElementById('coverUploadArea');
  area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('dragover'); });
  area.addEventListener('dragleave', () => area.classList.remove('dragover'));
  area.addEventListener('drop', e => { e.preventDefault(); area.classList.remove('dragover'); if (e.dataTransfer.files[0]) handleCoverFile(e.dataTransfer.files[0], slot); });
}

async function saveCD(slot) {
  try {
    await api(`/library/${slot}`, 'PUT', {
      title: document.getElementById('editTitle').value,
      artist: document.getElementById('editArtist').value,
      year: document.getElementById('editYear').value,
      genre: document.getElementById('editGenre').value,
      label: document.getElementById('editLabel').value,
      cover_url: document.getElementById('editCover').value,
      notes: document.getElementById('editNotes').value,
    });
    toast(t('edit.saved'));
    closeModal('cdDetailModal');
    loadLibrary();
  } catch (err) { toast(err.message, 'error'); }
}

// ── Cover Upload ──
let _pendingCoverDataUrl = null;
let _coverSourceImg = null; // original Image element for re-processing
let _coverOrigType = null;

function handleCoverFile(file, slot) {
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    toast(t('cover.formatError'), 'error');
    return;
  }
  _coverOrigType = file.type;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      _coverSourceImg = img;
      processCoverImage();
      // Re-process when format/size changes
      const fmt = document.getElementById('coverFormat');
      const sz = document.getElementById('coverSize');
      if (fmt) fmt.onchange = processCoverImage;
      if (sz) sz.onchange = processCoverImage;
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function processCoverImage() {
  if (!_coverSourceImg) return;
  const img = _coverSourceImg;
  const info = document.getElementById('coverInfo');

  const targetSize = parseInt(document.getElementById('coverSize').value) || 0;
  const formatSel = document.getElementById('coverFormat').value;
  const outputType = formatSel === 'auto' ? (_coverOrigType || 'image/jpeg') : formatSel;

  let w = img.width, h = img.height;
  if (targetSize > 0 && (w > targetSize || h > targetSize)) {
    const scale = targetSize / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);

  const quality = outputType === 'image/png' ? undefined : 0.85;
  _pendingCoverDataUrl = canvas.toDataURL(outputType, quality);

  const resultSize = Math.round((_pendingCoverDataUrl.length - _pendingCoverDataUrl.indexOf(',') - 1) * 0.75);
  info.textContent = `${t('cover.original')}: ${img.width}x${img.height}px | ${t('cover.output')}: ${w}x${h}px, ${(resultSize/1024).toFixed(0)} KB, ${outputType.split('/')[1]}`;

  if (resultSize > 2 * 1024 * 1024) {
    info.textContent += ` — ${t('cover.tooLarge')}`;
    info.style.color = 'var(--red)';
  } else {
    info.style.color = '';
  }

  const preview = document.getElementById('coverPreview');
  preview.innerHTML = `<img src="${_pendingCoverDataUrl}" id="coverPreviewImg">`;
  document.getElementById('coverUploadBtn').style.display = '';
}

async function uploadCover(slot) {
  if (!_pendingCoverDataUrl) return;
  const btn = document.getElementById('coverUploadBtn');
  btn.disabled = true;
  btn.textContent = t('cover.uploading');
  try {
    const result = await api(`/library/${slot}/cover`, 'POST', { image: _pendingCoverDataUrl });
    toast(t('cover.uploaded'));
    document.getElementById('editCover').value = result.cover_url;
    _pendingCoverDataUrl = null;
    btn.style.display = 'none';
    loadLibrary();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = t('cover.upload');
  }
}

// ── Favorites ──
async function toggleFavCD(slot) {
  if (!slot) { slot = playerStates[activePlayer]?.disc; }
  if (!slot) return;
  try {
    const result = await api('/favorites/toggle', 'POST', { slot, track: 0 });
    toast(result.favorite ? t('favorites.added') : t('favorites.removed'));
  } catch (err) { toast(err.message, 'error'); }
}

async function toggleFavTrack() {
  const state = playerStates[activePlayer];
  if (!state?.disc || !state?.track) return;
  try {
    const result = await api('/favorites/toggle', 'POST', { slot: state.disc, track: state.track });
    toast(result.favorite ? t('favorites.added') : t('favorites.removed'));
    // Update now-playing heart
    const npBtn = document.getElementById('btnFavTrack');
    if (npBtn) {
      npBtn.innerHTML = result.favorite ? '&#9829;' : '&#9825;';
      npBtn.classList.toggle('active', result.favorite);
    }
    // Sync tracklist heart
    const trackBtn = document.getElementById(`trackFav-${state.track}`);
    if (trackBtn) {
      trackBtn.innerHTML = result.favorite ? '&#9829;' : '&#9825;';
      trackBtn.classList.toggle('active', result.favorite);
    }
  } catch (err) { toast(err.message, 'error'); }
}

async function toggleFavForTrack(slot, trackNumber) {
  try {
    const result = await api('/favorites/toggle', 'POST', { slot, track: trackNumber });
    toast(result.favorite ? t('favorites.added') : t('favorites.removed'));
    // Update tracklist heart
    const trackBtn = document.getElementById(`trackFav-${trackNumber}`);
    if (trackBtn) {
      trackBtn.innerHTML = result.favorite ? '&#9829;' : '&#9825;';
      trackBtn.classList.toggle('active', result.favorite);
    }
    // Sync now-playing heart if same track
    const state = playerStates[activePlayer];
    if (state?.disc === slot && state?.track === trackNumber) {
      const npBtn = document.getElementById('btnFavTrack');
      if (npBtn) {
        npBtn.innerHTML = result.favorite ? '&#9829;' : '&#9825;';
        npBtn.classList.toggle('active', result.favorite);
      }
    }
  } catch (err) { toast(err.message, 'error'); }
}

async function updateFavButton(slot, track) {
  const btn = document.getElementById('btnFavTrack');
  if (!btn || !slot || !track) { if (btn) btn.innerHTML = '&#9825;'; return; }
  try {
    const favs = await api('/favorites');
    const isFav = favs.some(f => f.slot === slot && f.track_number === track);
    btn.innerHTML = isFav ? '&#9829;' : '&#9825;';
    btn.classList.toggle('active', isFav);
  } catch { /* ignore */ }
}

// ── Ratings ──
async function rateCurrentTrack(rating) {
  const state = playerStates[activePlayer];
  if (!state?.disc || !state?.track) return;
  try {
    const current = await api(`/ratings/${state.disc}/${state.track}`);
    const newRating = current.rating === rating ? 0 : rating;
    await api('/ratings', 'POST', { slot: state.disc, track: state.track, rating: newRating });
    updateStarDisplay(newRating);
    // Sync tracklist stars
    const container = document.getElementById(`trackStars-${state.track}`);
    if (container) renderTrackStarsInline(container, state.disc, state.track, newRating);
  } catch (err) { toast(err.message, 'error'); }
}

async function rateTrack(slot, trackNumber, rating) {
  try {
    const current = await api(`/ratings/${slot}/${trackNumber}`);
    const newRating = current.rating === rating ? 0 : rating;
    await api('/ratings', 'POST', { slot, track: trackNumber, rating: newRating });
    toast(newRating ? `${newRating} ${t('ratings.stars')}` : t('ratings.removed'));
  } catch (err) { toast(err.message, 'error'); }
}

function updateStarDisplay(rating) {
  const stars = document.querySelectorAll('#npStars span');
  stars.forEach((s, i) => {
    s.innerHTML = i < rating ? '&#9733;' : '&#9734;';
    s.classList.toggle('active', i < rating);
  });
}

// ── CD-level rating in tracklist header ──
async function loadCDRating(slot) {
  const container = document.getElementById('cdStars');
  if (!container || !slot) { if (container) container.innerHTML = ''; return; }
  try {
    const r = await api(`/ratings/${slot}/0`);
    renderCDStars(container, slot, r.rating || 0);
  } catch { renderCDStars(container, slot, 0); }
}

function renderCDStars(container, slot, rating) {
  container.innerHTML = Array.from({length: 5}, (_, i) => {
    const filled = i < rating;
    return `<span class="${filled ? 'active' : ''}" onclick="event.stopPropagation();rateCDFromList(${slot},${i+1})">${filled ? '&#9733;' : '&#9734;'}</span>`;
  }).join('');
}

async function rateCDFromList(slot, rating) {
  try {
    const current = await api(`/ratings/${slot}/0`);
    const newRating = current.rating === rating ? 0 : rating;
    await api('/ratings', 'POST', { slot, track: 0, rating: newRating });
    renderCDStars(document.getElementById('cdStars'), slot, newRating);
    toast(newRating ? `CD: ${newRating} ${t('ratings.stars')}` : t('ratings.removed'));
  } catch (err) { toast(err.message, 'error'); }
}

// ── Per-track rating in tracklist ──
async function rateTrackInList(slot, trackNumber, rating) {
  try {
    const current = await api(`/ratings/${slot}/${trackNumber}`);
    const newRating = current.rating === rating ? 0 : rating;
    await api('/ratings', 'POST', { slot, track: trackNumber, rating: newRating });
    // Update the inline stars
    const container = document.getElementById(`trackStars-${trackNumber}`);
    if (container) renderTrackStarsInline(container, slot, trackNumber, newRating);
    toast(newRating ? `${newRating} ${t('ratings.stars')}` : t('ratings.removed'));
    // Update now-playing stars if this is the current track
    const state = playerStates[activePlayer];
    if (state?.disc === slot && state?.track === trackNumber) updateStarDisplay(newRating);
  } catch (err) { toast(err.message, 'error'); }
}

function renderTrackStarsInline(container, slot, trackNumber, rating) {
  container.innerHTML = Array.from({length: 5}, (_, i) => {
    const filled = i < rating;
    return `<span class="${filled ? 'active' : ''}" onclick="event.stopPropagation();rateTrackInList(${slot},${trackNumber},${i+1})">${filled ? '&#9733;' : '&#9734;'}</span>`;
  }).join('');
}

async function loadCurrentTrackMeta() {
  const state = playerStates[activePlayer];
  if (!state?.disc || !state?.track) {
    updateStarDisplay(0);
    updateFavButton(null, null);
    return;
  }
  try {
    const r = await api(`/ratings/${state.disc}/${state.track}`);
    updateStarDisplay(r.rating || 0);
  } catch { updateStarDisplay(0); }
  updateFavButton(state.disc, state.track);
}

// ── Scanner ──
async function scanSingleCD() {
  const slot = parseInt(document.getElementById('scanSlot').value);
  if (!slot) { toast(t('scanner.enterSlot'), 'error'); return; }
  try {
    const result = await api('/scanner/scan', 'POST', { slot });
    toast(`CD ${slot}: ${result.totalTracks || '?'} ${t('scanner.tracksScanned')}`);
    loadLibrary();
    // Pre-fill MusicBrainz search with slot + TOC filter data
    const mbSlot = document.getElementById('mbSlot');
    const mbQuery = document.getElementById('mbQuery');
    if (mbSlot) mbSlot.value = slot;
    if (mbQuery) mbQuery.value = '';
    // Fill TOC filter fields
    if (result.totalTracks) {
      document.getElementById('mbTracks').value = result.totalTracks;
      const sec = result.totalSeconds || 0;
      document.getElementById('mbDuration').value = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      document.getElementById('mbTocFilter').style.display = 'flex';
    }
    // Highlight the MB search section with red border and scroll to it
    const mbCard = document.getElementById('mbCard');
    if (mbCard) {
      mbCard.style.outline = '3px solid var(--red)';
      mbCard.style.outlineOffset = '2px';
      mbCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => { mbCard.style.outline = ''; mbCard.style.outlineOffset = ''; }, 8000);
    }
    if (mbQuery) setTimeout(() => mbQuery.focus(), 500);
    toast(`Slot ${slot}: ${result.totalTracks} Tracks — ${t('scanner.enterAlbumArtist')}`, 'error');
  } catch (err) { toast(err.message, 'error'); }
}

async function scanRange() {
  const start = parseInt(document.getElementById('scanStart').value) || 1;
  const end = parseInt(document.getElementById('scanEnd').value) || 300;
  try {
    await api('/scanner/scan', 'POST', { startSlot: start, endSlot: end });
    document.getElementById('scanProgress').style.display = 'block';
    toast(t('scanner.started'));
  } catch (err) { toast(err.message, 'error'); }
}

async function abortScan() {
  try { await api('/scanner/abort', 'POST'); toast(t('scanner.aborting')); }
  catch (err) { toast(err.message, 'error'); }
}

function translateScanMessage(msg) {
  if (typeof msg === 'string') return msg;
  if (!msg || !msg.key) return '';
  const k = msg.key;
  if (k === 'scan.loading') return `${t('scan.loading')} CD ${msg.slot}...`;
  if (k === 'scan.reading') return `${t('scan.reading')} CD ${msg.slot}...`;
  if (k === 'scan.empty') return `CD ${msg.slot}: ${t('scan.empty')}`;
  if (k === 'scan.scanned') return `CD ${msg.slot}: ${msg.totalTracks} Tracks, ${msg.duration} — ${t('scan.assignMB')}`;
  if (k === 'scan.error') return `CD ${msg.slot}: ${t('scan.errorPrefix')} ${msg.error}`;
  if (k === 'scan.started') return t('scan.started');
  if (k === 'scan.aborted') return t('scan.aborted');
  if (k === 'scan.complete') return `${t('scan.completePrefix')} ${msg.count} CDs`;
  if (k === 'scan.lookup') return `${t('scan.lookup')} CD ${msg.slot}...`;
  if (k === 'scan.lookupFailed') return `${t('scan.lookupFailed')}: ${msg.error}`;
  if (k === 'scan.applying') return `${t('scan.applying')} CD ${msg.slot}...`;
  if (k === 'scan.applied') return `${t('scan.applied')} CD ${msg.slot}`;
  if (k === 'scan.applyFailed') return `${t('scan.applyFailed')}: ${msg.error}`;
  return JSON.stringify(msg);
}

function updateScanProgress(data) {
  document.getElementById('scanProgress').style.display = 'block';
  const pct = data.total > 0 ? (data.current / data.total * 100) : 0;
  document.getElementById('scanFill').style.width = `${pct}%`;
  document.getElementById('scanText').textContent = translateScanMessage(data.message) || `${data.current}/${data.total}`;
}

// ── MusicBrainz ──
async function searchMusicBrainz() {
  const slot = parseInt(document.getElementById('mbSlot').value);
  let query = document.getElementById('mbQuery').value.trim();
  if (!query) { toast(t('mb.enterQuery'), 'error'); return; }

  // Append TOC track count filter if available
  const tocTracks = parseInt(document.getElementById('mbTracks')?.value);
  if (tocTracks) query += ` AND tracks:${tocTracks}`;

  const container = document.getElementById('mbResults');
  const searchBtn = document.querySelector('#mbCard .btn-primary');
  container.innerHTML = `<div style="color:var(--text-muted);text-align:center;padding:16px">
    <div style="margin-bottom:8px;font-size:1.2rem" class="spinner">&#9881;</div>
    ${t('mb.querying')}
  </div>`;
  if (searchBtn) { searchBtn.disabled = true; searchBtn.textContent = t('mb.searching'); }
  try {
    let results = await api(`/musicbrainz/search?q=${encodeURIComponent(query)}`);
    if (results.length === 0) {
      container.innerHTML = `<div style="color:var(--text-muted);text-align:center;padding:16px">${t('mb.noResults')}</div>`;
      return;
    }
    // Sort by duration proximity to TOC if available
    const tocDuration = document.getElementById('mbDuration')?.value;
    if (tocDuration) {
      const parts = tocDuration.split(':');
      const tocSec = parseInt(parts[0]) * 60 + parseInt(parts[1] || 0);
      if (tocSec > 0) {
        results.sort((a, b) => {
          const diffA = Math.abs((a.cd.total_duration_seconds || 0) - tocSec);
          const diffB = Math.abs((b.cd.total_duration_seconds || 0) - tocSec);
          return diffA - diffB;
        });
      }
    }
    container.innerHTML = results.map((r, idx) => {
      const dur = r.cd.total_duration_seconds
        ? `${Math.floor(r.cd.total_duration_seconds / 60)}:${String(r.cd.total_duration_seconds % 60).padStart(2, '0')}`
        : '';
      // Duration match indicator
      let durMatch = '';
      if (tocDuration && r.cd.total_duration_seconds) {
        const parts2 = tocDuration.split(':');
        const tocSec2 = parseInt(parts2[0]) * 60 + parseInt(parts2[1] || 0);
        const diff = Math.abs(r.cd.total_duration_seconds - tocSec2);
        if (diff <= 10) durMatch = `<span style="color:var(--green)" title="${escAttr(t('mb.durationExact'))}">&#10004;</span> `;
        else if (diff <= 60) durMatch = `<span style="color:#f5a623" title="${escAttr(t('mb.durationClose'))}">&#9888;</span> `;
        else durMatch = `<span style="color:var(--red)" title="${escAttr(t('mb.durationFar'))}">&#10008;</span> `;
      }
      const meta = [
        r.cd.year || r.cd.date || '',
        r.cd.country || '',
        r.cd.format || 'CD',
        r.cd.label || '',
        r.cd.barcode || '',
        dur ? `${durMatch}${dur}` : '',
      ].filter(Boolean).join(' · ');

      const trackListHtml = r.tracks.length > 0
        ? `<div class="mb-tracklist" id="mbTracks-${idx}" style="display:none;margin-top:8px">
            <table style="width:100%;font-size:0.7rem;border-collapse:collapse">
              ${r.tracks.map(tr => `<tr style="border-bottom:1px solid var(--border)">
                <td style="padding:3px 6px;color:var(--text-muted);width:24px;text-align:right">${tr.track_number}</td>
                <td style="padding:3px 6px">${escHtml(tr.title)}</td>
                <td style="padding:3px 6px;color:var(--text-dim);white-space:nowrap">${tr.artist !== r.cd.artist ? escHtml(tr.artist) : ''}</td>
                <td style="padding:3px 6px;color:var(--text-muted);text-align:right;white-space:nowrap">${tr.duration_seconds ? formatDuration(tr.duration_seconds) : ''}</td>
              </tr>`).join('')}
            </table>
          </div>`
        : '';

      return `<div class="card" style="margin-bottom:10px;border:1px solid var(--border)">
        <div style="display:flex;gap:12px;align-items:flex-start">
          <div style="flex-shrink:0;width:80px;height:80px;border-radius:6px;overflow:hidden;background:var(--bg)">
            ${r.cd.cover_url
              ? `<img src="${escHtml(r.cd.cover_url)}" style="width:80px;height:80px;object-fit:cover" alt="" onerror="this.parentElement.innerHTML='<span style=display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:2rem>&#9834;</span>'">`
              : `<span style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:2rem">&#9834;</span>`}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:0.9rem;margin-bottom:2px">${escHtml(r.cd.title)}</div>
            <div style="font-size:0.8rem;color:var(--text-dim);margin-bottom:2px">${escHtml(r.cd.artist)}</div>
            <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:6px">${meta}</div>
            <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:6px">${r.tracks.length} Tracks${r.score ? ` · Score: ${r.score}` : ''}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn btn-primary btn-sm" onclick="applyMBResult(${slot||0},'${r.releaseId}')">${slot ? t('mb.apply') : t('mb.details')}</button>
              ${r.tracks.length > 0 ? `<button class="btn btn-sm" onclick="toggleMBTracks(${idx})">${t('mb.tracklist')}</button>` : ''}
            </div>
          </div>
        </div>
        ${trackListHtml}
      </div>`;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div style="color:var(--red);text-align:center;padding:16px">${escHtml(err.message)}</div>`;
  } finally {
    if (searchBtn) { searchBtn.disabled = false; searchBtn.textContent = t('mb.search'); }
  }
}

function toggleMBTracks(idx) {
  const el = document.getElementById(`mbTracks-${idx}`);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function applyMBResult(slot, releaseId) {
  if (!slot) { slot = parseInt(prompt(t('mb.enterSlot'))); if (!slot) return; }
  try {
    await api(`/musicbrainz/apply/${slot}`, 'POST', { releaseId });
    toast(`${t('mb.applied')} ${slot}`);
    loadLibrary();
  } catch (err) { toast(err.message, 'error'); }
}

function renderImportFormatExample() {
  const pre = document.getElementById('importFormatPre');
  const also = document.getElementById('importFormatAlso');
  if (!pre) return;
  pre.textContent = `[
  {
    "cd_number": 1,          // ${t('import.formatSlot')}
    "disc_id": "a80b520a",   // ${t('import.formatDiscId')}
    "album": "Album",        // ${t('import.formatAlbum')}
    "album_artist": "Artist",
    "release_date": "01.01.1990",  // ${t('import.formatDate')}
    "album_length": "45:30",       // ${t('import.formatDuration')}
    "tracks": [
      {
        "track_number": 1,
        "track_title": "Title",
        "track_artist": "Artist",
        "track_length": "3:45"     // ${t('import.formatTrackDuration')}
      }
    ]
  }
]`;
  if (also) also.innerHTML = `${t('import.formatAlsoSupported')} <code>{cds:[...]}</code>, Objekt/Object mit Slot-Keys, <code>title/artist/year</code> ${t('import.formatFieldNames')}.`;
}

// ── JSON Import ──
let _importData = []; // parsed CDs ready for preview

// UTF-8 mojibake repair map (double-encoded UTF-8 sequences)
const _mojibakeMap = [
  [/\u00e2\u0080\u0099/g, '\u2019'],  // '
  [/\u00e2\u0080\u0098/g, '\u2018'],  // '
  [/\u00e2\u0080\u009c/g, '\u201c'],  // "
  [/\u00e2\u0080\u009d/g, '\u201d'],  // "
  [/\u00e2\u0080\u0093/g, '\u2013'],  // –
  [/\u00e2\u0080\u0094/g, '\u2014'],  // —
  [/\u00e2\u0080\u00a6/g, '\u2026'],  // …
  [/\u00c3\u00a4/g, 'ä'], [/\u00c3\u0084/g, 'Ä'],
  [/\u00c3\u00b6/g, 'ö'], [/\u00c3\u0096/g, 'Ö'],
  [/\u00c3\u00bc/g, 'ü'], [/\u00c3\u009c/g, 'Ü'],
  [/\u00c3\u009f/g, 'ß'],
  [/\u00c3\u00a9/g, 'é'], [/\u00c3\u0089/g, 'É'],
  [/\u00c3\u00a8/g, 'è'], [/\u00c3\u00a0/g, 'à'],
  [/\u00c3\u00b1/g, 'ñ'], [/\u00c3\u00a7/g, 'ç'],
  [/\u00c3\u00ae/g, 'î'], [/\u00c3\u00b4/g, 'ô'],
  [/\u00c3\u00ab/g, 'ë'], [/\u00c3\u00af/g, 'ï'],
  [/\u00c3\u00a1/g, 'á'], [/\u00c3\u00ad/g, 'í'],
  [/\u00c3\u00ba/g, 'ú'], [/\u00c3\u00b3/g, 'ó'],
];

// Additional broken sequences from latin1 misread as UTF-8
const _mojibakeMap2 = [
  [/â€™/g, '\u2019'], [/â€˜/g, '\u2018'],
  [/â€œ/g, '\u201c'], [/â€\u009d/g, '\u201d'], [/â€/g, '\u201c'],
  [/â€"/g, '\u2013'], [/â€"/g, '\u2014'],
  [/â€¦/g, '\u2026'],
  [/Ã¤/g, 'ä'], [/Ã„/g, 'Ä'],
  [/Ã¶/g, 'ö'], [/Ã–/g, 'Ö'],
  [/Ã¼/g, 'ü'], [/Ãœ/g, 'Ü'],
  [/ÃŸ/g, 'ß'],
  [/Ã©/g, 'é'], [/Ã‰/g, 'É'],
  [/Ã¨/g, 'è'], [/Ã /g, 'à'],
  [/Ã±/g, 'ñ'], [/Ã§/g, 'ç'],
  [/Ã®/g, 'î'], [/Ã´/g, 'ô'],
  [/Ã«/g, 'ë'], [/Ã¯/g, 'ï'],
  [/Ã¡/g, 'á'], [/Ã­/g, 'í'],
  [/Ãº/g, 'ú'], [/Ã³/g, 'ó'],
];

function fixMojibake(str) {
  if (typeof str !== 'string') return str;
  for (const [pat, rep] of _mojibakeMap) str = str.replace(pat, rep);
  for (const [pat, rep] of _mojibakeMap2) str = str.replace(pat, rep);
  return str;
}

function fixMojibakeDeep(obj) {
  if (typeof obj === 'string') return fixMojibake(obj);
  if (Array.isArray(obj)) return obj.map(fixMojibakeDeep);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = fixMojibakeDeep(v);
    return out;
  }
  return obj;
}

function hasMojibake(str) {
  if (typeof str !== 'string') return false;
  return /Ã[¤öüÖÄÜß©é]|â€[™˜œ—–¦]|\u00c3[\u0080-\u00bf]|\u00e2\u0080/.test(str);
}

// Validate a single CD entry and return status badges
function validateImportCD(cd) {
  const issues = [];
  const title = cd.title || cd.album || '';
  const artist = cd.artist || cd.album_artist || '';
  const year = cd.year || cd.release_date || '';
  const slot = cd.slot || cd.cd_number;

  // Check invalid/missing slot
  if (!slot || slot < 1 || slot > 500) {
    issues.push({ type: 'err', key: 'invalidSlot' });
  }
  // Check encoding
  if (hasMojibake(title) || hasMojibake(artist)) {
    issues.push({ type: 'warn', key: 'encoding' });
  }
  // Check placeholder titles
  if (/^\+{3,}|Album-Titel|^Titel$|^Title$/i.test(title)) {
    issues.push({ type: 'err', key: 'placeholder' });
  }
  // Check missing title
  if (!title.trim()) {
    issues.push({ type: 'err', key: 'missingData' });
  }
  // Check missing artist
  if (!artist.trim()) {
    issues.push({ type: 'warn', key: 'missingData' });
  }
  // Check invalid dates
  if (/^TT\.MM\.|Unbekannt|^unknown$/i.test(year)) {
    issues.push({ type: 'warn', key: 'invalidDate' });
  }
  // Check invalid durations
  const dur = cd.album_length || '';
  if (/^\?\?:\?\?$|^MM:SS$/.test(dur)) {
    issues.push({ type: 'warn', key: 'invalidDuration' });
  }
  // Check tracks with invalid durations
  if (cd.tracks) {
    const badTracks = cd.tracks.some(t => /^\?\?:\?\?$|^MM:SS$/.test(t.track_length || ''));
    if (badTracks) issues.push({ type: 'warn', key: 'invalidDuration' });
  }

  return issues;
}

function parseCDList(data) {
  let cdList = [];
  if (Array.isArray(data)) {
    cdList = data;
  } else if (data.cds && Array.isArray(data.cds)) {
    cdList = data.cds;
  } else if (typeof data === 'object') {
    for (const [key, val] of Object.entries(data)) {
      if (typeof val === 'object' && val !== null) {
        cdList.push({ ...val, slot: val.slot || val.cd_number || parseInt(key) || undefined });
      }
    }
  }
  return cdList;
}

async function handleJSONImport(input) {
  const file = input.files[0];
  if (!file) return;
  const statusEl = document.getElementById('importStatus');
  statusEl.style.color = '';

  // Check file size (10 MB)
  if (file.size > 10 * 1024 * 1024) {
    statusEl.textContent = t('import.fileTooLarge');
    statusEl.style.color = 'var(--red)';
    toast(t('import.fileTooLarge'), 'error');
    input.value = '';
    return;
  }

  statusEl.textContent = t('import.importing');

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const cdList = parseCDList(data);

    if (cdList.length === 0) {
      statusEl.textContent = t('import.noData');
      statusEl.style.color = 'var(--red)';
      input.value = '';
      return;
    }

    // Normalize each CD for preview
    _importData = cdList.map(cd => {
      const slot = cd.slot || cd.cd_number || cd.slotNumber || cd.nr;
      return {
        _selected: true,
        _original: cd,
        slot: typeof slot === 'string' ? parseInt(slot) : slot,
        title: cd.title || cd.album || cd.name || '',
        artist: cd.artist || cd.album_artist || cd.albumArtist || '',
        year: cd.year || cd.release_date || cd.releaseDate || '',
        genre: cd.genre || '',
        trackCount: cd.tracks?.length || cd.total_tracks || 0,
        duration: cd.album_length || '',
        issues: [],
      };
    });

    // Validate
    _importData.forEach(cd => {
      cd.issues = validateImportCD({ ...cd._original, ...cd });
    });

    renderImportPreview();
    statusEl.textContent = '';
  } catch (err) {
    statusEl.textContent = `${t('import.parseError')}: ${err.message}`;
    statusEl.style.color = 'var(--red)';
    toast(t('import.parseError'), 'error');
  }
  input.value = '';
}

function renderImportPreview() {
  const preview = document.getElementById('importPreview');
  const selectArea = document.getElementById('importSelectArea');
  preview.style.display = 'block';
  selectArea.style.display = 'none';

  // Stats
  const total = _importData.length;
  const warns = _importData.filter(cd => cd.issues.some(i => i.type === 'warn')).length;
  const errs = _importData.filter(cd => cd.issues.some(i => i.type === 'err')).length;
  const ok = total - warns - errs + _importData.filter(cd => cd.issues.some(i => i.type === 'warn') && cd.issues.some(i => i.type === 'err')).length;

  document.getElementById('importStats').innerHTML =
    `<strong>${total}</strong> ${t('import.cdsFound')}` +
    (warns ? ` &middot; <span class="stat-warn">${warns} ${t('import.warnings')}</span>` : '') +
    (errs ? ` &middot; <span class="stat-err">${errs} ${t('import.errors')}</span>` : '');

  // Table
  const tbody = document.getElementById('importTableBody');
  tbody.innerHTML = _importData.map((cd, idx) => {
    const rowClass = cd.issues.some(i => i.type === 'err') ? 'import-row-error' :
                     cd.issues.some(i => i.type === 'warn') ? 'import-row-warning' : '';
    const badges = cd.issues.map(i => {
      const cls = i.type === 'err' ? 'import-badge-err' : 'import-badge-warn';
      const label = t(`import.${i.key}`) || i.key;
      return `<span class="import-badge ${cls}">${escHtml(label)}</span>`;
    }).join('');

    return `<tr class="${rowClass}" data-import-idx="${idx}">
      <td><input type="checkbox" ${cd._selected ? 'checked' : ''} onchange="_importData[${idx}]._selected=this.checked"></td>
      <td class="import-slot-cell">
        <input type="number" class="import-slot-input" value="${cd.slot || ''}" min="1" max="500"
          onchange="importSlotChanged(${idx},this.value)" title="${escAttr(t('import.changeSlot'))}">
      </td>
      <td contenteditable="true" data-field="title" oninput="importFieldChanged(${idx},'title',this.textContent)">${escHtml(cd.title)}</td>
      <td contenteditable="true" data-field="artist" oninput="importFieldChanged(${idx},'artist',this.textContent)">${escHtml(cd.artist)}</td>
      <td contenteditable="true" data-field="year" oninput="importFieldChanged(${idx},'year',this.textContent)">${escHtml(cd.year)}</td>
      <td>${cd.trackCount}</td>
      <td>${badges || `<span class="import-badge import-badge-ok">${t('import.ok')}</span>`}</td>
    </tr>`;
  }).join('');
}

function importFieldChanged(idx, field, value) {
  _importData[idx][field] = value;
  // Update original too so import sends corrected data
  const cd = _importData[idx]._original;
  if (field === 'title') { cd.title = value; cd.album = value; }
  if (field === 'artist') { cd.artist = value; cd.album_artist = value; }
  if (field === 'year') { cd.year = value; cd.release_date = value; }
  // Re-validate
  _importData[idx].issues = validateImportCD({ ...cd, ..._importData[idx] });
}

function importSlotChanged(idx, value) {
  const newSlot = parseInt(value);
  if (!newSlot || newSlot < 1 || newSlot > 500) return;

  // Check for duplicate slot
  const duplicate = _importData.find((cd, i) => i !== idx && cd.slot === newSlot);
  if (duplicate) {
    // Swap: give the other CD this CD's old slot
    const oldSlot = _importData[idx].slot;
    duplicate.slot = oldSlot;
    duplicate._original.cd_number = oldSlot;
    duplicate._original.slot = oldSlot;
    // Update the swapped row's input visually
    const otherRow = document.querySelector(`tr[data-import-idx="${_importData.indexOf(duplicate)}"] .import-slot-input`);
    if (otherRow) otherRow.value = oldSlot;
    toast(`Slot ${newSlot} \u2194 ${oldSlot} ${t('import.slotsSwapped')}`, 'info');
  }

  _importData[idx].slot = newSlot;
  _importData[idx]._original.cd_number = newSlot;
  _importData[idx]._original.slot = newSlot;
}

function importSelectAll(checked) {
  _importData.forEach(cd => cd._selected = checked);
  document.getElementById('importCheckAll').checked = checked;
  document.querySelectorAll('#importTableBody input[type=checkbox]').forEach(cb => cb.checked = checked);
}

function importFixEncoding() {
  let fixed = 0;
  _importData.forEach((cd, idx) => {
    const origTitle = cd.title;
    const origArtist = cd.artist;
    cd.title = fixMojibake(cd.title);
    cd.artist = fixMojibake(cd.artist);
    cd.year = fixMojibake(cd.year);
    cd.genre = fixMojibake(cd.genre);
    cd._original = fixMojibakeDeep(cd._original);
    if (cd.title !== origTitle || cd.artist !== origArtist) fixed++;
    cd.issues = validateImportCD({ ...cd._original, ...cd });
  });
  renderImportPreview();
  toast(`${t('import.encodingFixed')}: ${fixed} CDs`, 'success');
}

function cancelImportPreview() {
  _importData = [];
  document.getElementById('importPreview').style.display = 'none';
  document.getElementById('importSelectArea').style.display = '';
  document.getElementById('importStatus').textContent = '';
}

async function executeImport() {
  const selected = _importData.filter(cd => cd._selected);
  if (selected.length === 0) { toast(t('import.noData'), 'error'); return; }

  const statusEl = document.getElementById('importStatus');
  statusEl.textContent = t('import.importing');
  statusEl.style.color = '';

  // Build the data array from original objects (with any edits applied)
  const payload = selected.map(cd => cd._original);

  try {
    const result = await api('/import', 'POST', payload);
    statusEl.textContent = `${result.imported} ${t('import.success')}`;
    statusEl.style.color = 'var(--green)';
    toast(`${result.imported} ${t('import.success')}`, 'success');
    cancelImportPreview();
    loadLibrary();
  } catch (err) {
    statusEl.textContent = `${t('import.error')}: ${err.message}`;
    statusEl.style.color = 'var(--red)';
    toast(t('import.error'), 'error');
  }
}

// ── Playlists ──
async function loadPlaylists() {
  try {
    const playlists = await api('/playlists');
    const container = document.getElementById('playlistList');
    const empty = document.getElementById('playlistEmpty');
    if (playlists.length === 0) { container.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    container.innerHTML = playlists.map(pl => {
      const items = pl.items || [];
      // collect unique covers (max 4)
      const seenSlots = new Set();
      const covers = [];
      for (const item of items) {
        if (seenSlots.has(item.slot)) continue;
        seenSlots.add(item.slot);
        const cd = library.find(c => c.slot === item.slot);
        if (cd?.cover_url) covers.push(cd.cover_url);
        if (covers.length >= 4) break;
      }
      const coversHtml = covers.length > 0
        ? `<div class="playlist-covers">${covers.map(src => `<img class="playlist-mini-cover" src="${escHtml(src)}" alt="">`).join('')}</div>`
        : '';
      return `<div class="playlist-item" onclick="showPlaylistDetail(${pl.id})">
        <div class="playlist-item-meta">
          <div class="playlist-name">${escHtml(pl.name)}</div>
          <div class="playlist-count">${items.length} ${t('library.tracks')}${pl.description ? ' · ' + escHtml(pl.description) : ''}</div>
        </div>
        ${coversHtml}
        <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deletePlaylist(${pl.id})">&times;</button>
      </div>`;
    }).join('');
  } catch (err) { toast(err.message, 'error'); }
}

function showCreatePlaylist() { document.getElementById('playlistModal').classList.add('active'); }

async function createPlaylist() {
  const name = document.getElementById('plName').value.trim();
  if (!name) { toast(t('playlists.enterName'), 'error'); return; }
  try {
    await api('/playlists', 'POST', { name, description: document.getElementById('plDesc').value.trim() });
    closeModal('playlistModal');
    document.getElementById('plName').value = '';
    document.getElementById('plDesc').value = '';
    toast(t('playlists.created'));
    loadPlaylists();
  } catch (err) { toast(err.message, 'error'); }
}

let _currentPlaylistDetail = null;

async function showPlaylistDetail(id) {
  try {
    const pl = await api(`/playlists/${id}`);
    _currentPlaylistDetail = pl;
    renderPlaylistDetail(pl);
    document.getElementById('cdDetailModal').classList.add('active');
  } catch (err) { toast(err.message, 'error'); }
}

function renderPlaylistDetail(pl) {
  document.getElementById('modalTitle').textContent = pl.name;
  const items = pl.items || [];
  let totalSec = 0;
  items.forEach(it => { if (it.duration_seconds) totalSec += it.duration_seconds; });

  let html = `<div style="color:var(--text-dim);font-size:0.85rem;margin-bottom:12px">
    ${escHtml(pl.description||'')} ${items.length} ${t('playlists.items')}${totalSec ? ' · ' + formatDuration(totalSec) : ''}
  </div>
  <div class="btn-group" style="margin-bottom:12px">
    ${items.length > 0 ? `<button class="btn btn-primary btn-sm" onclick="playPlaylist(${pl.id})">&#9654; ${t('playlists.playAll')}</button>` : ''}
    <button class="btn btn-danger btn-sm" onclick="deletePlaylist(${pl.id})">${t('playlists.delete')}</button>
  </div>`;

  if (items.length > 0) {
    html += `<div class="playlist-detail-list" id="plDetailList">`;
    html += items.map((item, idx) => {
      const cd = library.find(c => c.slot === item.slot);
      const coverUrl = cd?.cover_url || '';
      return `<div class="pl-detail-item" draggable="true" data-idx="${idx}" data-item-id="${item.id}">
        <span class="drag-handle" title="Drag">&#9776;</span>
        <span class="track-num">${idx + 1}</span>
        ${coverUrl ? `<img class="playlist-item-cover" src="${escHtml(coverUrl)}" alt="">` : `<span class="playlist-item-no-cover">${item.slot}</span>`}
        <div class="track-info" onclick="loadAndPlayTrack(${item.slot},${item.track_number})" style="cursor:pointer">
          <div class="track-title">${escHtml(item.track_title||item.cd_title||`CD ${item.slot}`)}</div>
          <div class="track-artist">${escHtml(item.track_artist||item.cd_artist||'')} · Slot ${item.slot} · Track ${item.track_number}</div>
        </div>
        <button class="btn-icon btn-remove-item" onclick="event.stopPropagation();removePlaylistItem(${pl.id},${item.id})" title="${escAttr(t('playlists.remove'))}">&times;</button>
      </div>`;
    }).join('');
    html += `</div>`;
  } else {
    html += `<div class="empty-state"><p>${t('playlists.emptyList')}</p></div>`;
  }
  document.getElementById('modalContent').innerHTML = html;
  if (items.length > 1) initPlaylistDragDrop(pl.id);
}

function initPlaylistDragDrop(playlistId) {
  const list = document.getElementById('plDetailList');
  if (!list) return;
  let dragIdx = null;

  list.addEventListener('dragstart', e => {
    const item = e.target.closest('.pl-detail-item');
    if (!item) return;
    dragIdx = parseInt(item.dataset.idx);
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  list.addEventListener('dragend', e => {
    const item = e.target.closest('.pl-detail-item');
    if (item) item.classList.remove('dragging');
    list.querySelectorAll('.pl-detail-item').forEach(el => el.classList.remove('drag-over'));
  });

  list.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const target = e.target.closest('.pl-detail-item');
    list.querySelectorAll('.pl-detail-item').forEach(el => el.classList.remove('drag-over'));
    if (target && parseInt(target.dataset.idx) !== dragIdx) target.classList.add('drag-over');
  });

  list.addEventListener('drop', async e => {
    e.preventDefault();
    const target = e.target.closest('.pl-detail-item');
    if (!target) return;
    const dropIdx = parseInt(target.dataset.idx);
    if (dragIdx === null || dragIdx === dropIdx) return;

    const items = _currentPlaylistDetail.items;
    const ids = items.map(i => i.id);
    const [moved] = ids.splice(dragIdx, 1);
    ids.splice(dropIdx, 0, moved);

    try {
      const updated = await api(`/playlists/${playlistId}/reorder`, 'PUT', { itemIds: ids });
      _currentPlaylistDetail = updated;
      renderPlaylistDetail(updated);
    } catch (err) { toast(err.message, 'error'); }
    dragIdx = null;
  });

  // Touch support
  let touchItem = null, touchClone = null, touchStartY = 0;

  list.addEventListener('touchstart', e => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    const item = handle.closest('.pl-detail-item');
    if (!item) return;
    touchItem = item;
    dragIdx = parseInt(item.dataset.idx);
    touchStartY = e.touches[0].clientY;
    touchClone = item.cloneNode(true);
    touchClone.classList.add('touch-dragging');
    touchClone.style.position = 'fixed';
    touchClone.style.left = item.getBoundingClientRect().left + 'px';
    touchClone.style.width = item.offsetWidth + 'px';
    touchClone.style.top = item.getBoundingClientRect().top + 'px';
    touchClone.style.zIndex = '9999';
    touchClone.style.pointerEvents = 'none';
    document.body.appendChild(touchClone);
    item.style.opacity = '0.3';
  }, { passive: true });

  list.addEventListener('touchmove', e => {
    if (!touchClone) return;
    e.preventDefault();
    const y = e.touches[0].clientY;
    touchClone.style.top = y - 20 + 'px';
    list.querySelectorAll('.pl-detail-item').forEach(el => {
      el.classList.remove('drag-over');
      const rect = el.getBoundingClientRect();
      if (y > rect.top && y < rect.bottom && el !== touchItem) el.classList.add('drag-over');
    });
  }, { passive: false });

  list.addEventListener('touchend', async e => {
    if (!touchClone) return;
    touchClone.remove();
    touchClone = null;
    if (touchItem) touchItem.style.opacity = '';
    const overEl = list.querySelector('.drag-over');
    list.querySelectorAll('.pl-detail-item').forEach(el => el.classList.remove('drag-over'));
    if (!overEl) { touchItem = null; return; }
    const dropIdx = parseInt(overEl.dataset.idx);
    if (dragIdx === dropIdx) { touchItem = null; return; }

    const items = _currentPlaylistDetail.items;
    const ids = items.map(i => i.id);
    const [moved] = ids.splice(dragIdx, 1);
    ids.splice(dropIdx, 0, moved);

    try {
      const updated = await api(`/playlists/${playlistId}/reorder`, 'PUT', { itemIds: ids });
      _currentPlaylistDetail = updated;
      renderPlaylistDetail(updated);
    } catch (err) { toast(err.message, 'error'); }
    touchItem = null;
    dragIdx = null;
  });
}

async function playPlaylist(id) {
  try {
    const pl = await api(`/playlists/${id}`);
    playlistMode.name = pl.name || 'Playlist';
    await api(`/playlists/${id}/play`, 'POST');
    closeModal('cdDetailModal');
    showPageDirect('player');
    toast(`Playlist "${pl.name}" wird abgespielt`);
  } catch (err) { toast(err.message, 'error'); }
}

async function stopPlaylist() {
  try {
    await api('/playlists/stop', 'POST');
    playlistMode.active = false;
    updatePlaylistBanner();
  } catch (err) { toast(err.message, 'error'); }
}

async function removePlaylistItem(playlistId, itemId) {
  try {
    await api(`/playlists/${playlistId}/items/${itemId}`, 'DELETE');
    showPlaylistDetail(playlistId);
  } catch (err) { toast(err.message, 'error'); }
}

async function deletePlaylist(id) {
  if (!confirm(t('playlists.deleteConfirm'))) return;
  try {
    await api(`/playlists/${id}`, 'DELETE');
    closeModal('cdDetailModal');
    toast(t('playlists.deleted'));
    loadPlaylists();
  } catch (err) { toast(err.message, 'error'); }
}

async function showAddToPlaylist(slot, trackNumber) {
  try {
    const playlists = await api('/playlists');
    if (playlists.length === 0) {
      toast(t('playlists.createFirst'), 'error');
      return;
    }
    document.getElementById('modalTitle').textContent = t('playlists.addTo');
    document.getElementById('modalContent').innerHTML = playlists.map(pl => `
      <div class="card" style="cursor:pointer;margin-bottom:8px" onclick="addToPlaylist(${pl.id},${slot},${trackNumber})">
        <div style="font-weight:600">${escHtml(pl.name)}</div>
        <div style="font-size:0.75rem;color:var(--text-dim)">${escHtml(pl.description||'')}</div>
      </div>
    `).join('');
    document.getElementById('cdDetailModal').classList.add('active');
  } catch (err) { toast(err.message, 'error'); }
}

async function addToPlaylist(playlistId, slot, trackNumber) {
  try {
    await api(`/playlists/${playlistId}/items`, 'POST', { slot, track: trackNumber });
    toast(t('playlists.added'));
    closeModal('cdDetailModal');
  } catch (err) { toast(err.message, 'error'); }
}

// ── More ──
function showMoreTab(name) {
  document.querySelectorAll('.more-section').forEach(s => s.style.display = 'none');
  document.getElementById(`section-${name}`).style.display = 'block';
  document.querySelectorAll('#page-more .tab').forEach(t => t.classList.remove('active'));
  event.currentTarget.classList.add('active');
  if (name === 'history') loadHistory();
  if (name === 'ratings') loadRatings();
  if (name === 'stats') loadStats();
  if (name === 'scanner') loadScannerInMore();
  if (name === 'settings') loadSettings();
  if (name === 'cdeditor') loadCDEditor();
}

function loadMoreData() { loadHistory(); }

async function loadHistory() {
  try {
    const history = await api('/history?limit=50');
    const container = document.getElementById('historyList');
    if (history.length === 0) { container.innerHTML = `<div class="empty-state"><p>${t('history.empty')}</p></div>`; return; }
    container.innerHTML = history.map(h => {
      const cd = library.find(c => c.slot === h.slot);
      const coverUrl = cd?.cover_url || '';
      return `<div class="fav-item" onclick="loadAndPlayTrack(${h.slot},${h.track_number})">
        ${coverUrl ? `<img class="fav-cover" src="${escHtml(coverUrl)}" alt="" onerror="this.outerHTML='<div class=\\'fav-cover fav-no-cover\\'>${h.slot}</div>'">` : `<div class="fav-cover fav-no-cover">${h.slot}</div>`}
        <div class="fav-meta">
          <div class="fav-title">${escHtml(h.track_title||h.cd_title||`CD ${h.slot}`)}</div>
          <div class="fav-artist">${escHtml(h.cd_artist||'')} · Track ${h.track_number}</div>
          <div class="fav-slot">${formatDate(h.played_at)}</div>
        </div>
      </div>`;
    }).join('');
  } catch (err) { console.error(err); }
}

async function clearHistory() {
  if (!confirm(t('history.clearConfirm'))) return;
  try { await api('/history', 'DELETE'); toast(t('history.cleared')); loadHistory(); }
  catch (err) { toast(err.message, 'error'); }
}

let _favFilter = 'all';

async function loadFavoritesPage() {
  renderFavorites(document.getElementById('favoritesPageList'), _favFilter);
}

function filterFavorites(filter, btn) {
  _favFilter = filter;
  document.querySelectorAll('#favFilterBar .tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  loadFavoritesPage();
}

async function renderFavorites(container, filter) {
  if (!container) return;
  try {
    let favs = await api('/favorites');
    if (filter === 'cds') favs = favs.filter(f => !f.track_number || f.track_number === 0);
    else if (filter === 'tracks') favs = favs.filter(f => f.track_number > 0);
    if (favs.length === 0) { container.innerHTML = `<div class="empty-state"><p>${t('favorites.empty')}</p></div>`; return; }
    container.innerHTML = favs.map(f => {
      const isTrack = f.track_number > 0;
      const title = isTrack ? (f.track_title || `Track ${f.track_number}`) : (f.cd_title || `CD ${f.slot}`);
      const sub = isTrack
        ? `${escHtml(f.cd_title||`CD ${f.slot}`)} · Track ${f.track_number} · ${escHtml(f.cd_artist||'')}`
        : escHtml(f.cd_artist||'');
      const cd = library.find(c => c.slot === f.slot);
      const coverUrl = cd?.cover_url || '';
      return `<div class="fav-item" onclick="loadAndPlayTrack(${f.slot},${f.track_number||1})">
        ${coverUrl ? `<img class="fav-cover" src="${escHtml(coverUrl)}" alt="" onerror="this.outerHTML='<div class=\\'fav-cover fav-no-cover\\'>${f.slot}</div>'">` : `<div class="fav-cover fav-no-cover">${f.slot}</div>`}
        <div class="fav-meta">
          <div class="fav-title">${escHtml(title)}</div>
          <div class="fav-artist">${sub}</div>
          <div class="fav-slot">Slot ${f.slot}</div>
        </div>
        <button class="btn-icon" onclick="event.stopPropagation();removeFav(${f.slot},${f.track_number})" style="color:var(--red)">&#9829;</button>
      </div>`;
    }).join('');
  } catch (err) { console.error(err); }
}

async function removeFav(slot, track) {
  try {
    await api('/favorites/toggle', 'POST', { slot, track });
    loadFavoritesPage();
    const state = playerStates[activePlayer];
    if (state?.disc === slot && state?.track === track) updateFavButton(slot, track);
  } catch (err) { toast(err.message, 'error'); }
}

function loadScannerInMore() {
  const container = document.getElementById('scannerContent');
  const scannerPage = document.getElementById('page-scanner');
  if (container && scannerPage && !container.hasChildNodes()) {
    // Move scanner content into More tab
    while (scannerPage.children.length > 1) {
      container.appendChild(scannerPage.children[1]);
    }
  }
}

function starsHtml(rating) {
  return Array.from({length: 5}, (_, i) => i < rating ? '&#9733;' : '&#9734;').join('');
}

async function loadRatings() {
  try {
    const all = await api('/ratings');
    const container = document.getElementById('ratingsList');
    const filterVal = parseInt(document.getElementById('ratingsFilter')?.value) || 0;
    const viewVal = document.getElementById('ratingsView')?.value || 'all';

    let filtered = all;
    if (filterVal > 0) filtered = filtered.filter(r => r.rating >= filterVal);
    if (viewVal === 'tracks') filtered = filtered.filter(r => r.track_number > 0);
    if (viewVal === 'cds') filtered = filtered.filter(r => r.track_number === 0);

    if (filtered.length === 0) {
      container.innerHTML = `<div class="empty-state"><p>${t('ratings.empty')}</p></div>`;
      return;
    }
    container.innerHTML = filtered.map(r => {
      const isTrack = r.track_number > 0;
      const title = isTrack ? (r.track_title || `Track ${r.track_number}`) : (r.cd_title || `CD ${r.slot}`);
      const sub = isTrack
        ? `${escHtml(r.cd_title||`CD ${r.slot}`)} · Track ${r.track_number} · ${escHtml(r.cd_artist||'')}`
        : escHtml(r.cd_artist||'');
      const cd = library.find(c => c.slot === r.slot);
      const coverUrl = cd?.cover_url || '';
      return `<div class="fav-item" onclick="loadAndPlayTrack(${r.slot},${r.track_number||1})">
        ${coverUrl ? `<img class="fav-cover" src="${escHtml(coverUrl)}" alt="" onerror="this.outerHTML='<div class=\\'fav-cover fav-no-cover\\'>${r.slot}</div>'">` : `<div class="fav-cover fav-no-cover">${r.slot}</div>`}
        <div class="fav-meta">
          <div class="fav-title">${escHtml(title)}</div>
          <div class="fav-artist">${sub}</div>
          <div class="fav-slot">Slot ${r.slot}</div>
        </div>
        <div class="rating-display">${starsHtml(r.rating)}</div>
      </div>`;
    }).join('');
  } catch (err) { console.error(err); }
}

// ── Play Statistics ──

let statsData = null;
let currentStatsTab = 'overview';
let topListLimit = 10;
let topListView = 'cds';
let activityPeriod = 'daily';

function showStatsTab(name) {
  currentStatsTab = name;
  document.querySelectorAll('.stats-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.stats-tab').forEach(t => {
    if (t.textContent && t.getAttribute('onclick')?.includes(name)) t.classList.add('active');
  });
  renderStatsTab();
}

async function loadStats() {
  try {
    statsData = await api('/stats?top=' + (topListLimit === 9999 ? 99999 : topListLimit));
    renderStatsTab();
  } catch (err) { console.error(err); }
}

function renderStatsTab() {
  if (!statsData) return;
  const c = document.getElementById('statsContent');
  switch (currentStatsTab) {
    case 'overview': c.innerHTML = renderStatsOverview(); break;
    case 'toplist': c.innerHTML = renderStatsToplist(); break;
    case 'activity': c.innerHTML = renderStatsActivity(); break;
    case 'inventory': c.innerHTML = renderStatsInventory(); break;
  }
}

function renderStatsOverview() {
  const inv = statsData.inventory;
  const totalPlayTime = formatDuration(statsData.totalPlayTimeSec);
  const totalLibTime = formatDuration(inv.totalDurationSeconds);

  let html = `<div class="stats-grid">
    <div class="stat-card"><div class="stat-value">${inv.totalCDs}</div><div class="stat-label">${t('stats.cds')}</div></div>
    <div class="stat-card"><div class="stat-value">${inv.totalTracks}</div><div class="stat-label">${t('stats.tracks')}</div></div>
    <div class="stat-card"><div class="stat-value">${totalPlayTime}</div><div class="stat-label">${t('stats.playTime')}</div></div>
    <div class="stat-card"><div class="stat-value">${totalLibTime}</div><div class="stat-label">${t('stats.libTime')}</div></div>
    <div class="stat-card"><div class="stat-value">${inv.totalFavorites}</div><div class="stat-label">${t('stats.favorites')}</div></div>
    <div class="stat-card"><div class="stat-value">${inv.totalPlaylists}</div><div class="stat-label">${t('stats.playlists')}</div></div>
  </div>`;

  if (statsData.topCDs.length) {
    html += `<div class="card" style="margin-top:16px"><div class="card-header"><span class="card-title">${t('stats.topCDsQuick')}</span></div>`;
    html += statsData.topCDs.slice(0, 5).map((c, i) => `
      <div class="list-item" onclick="loadAndPlayCD(${c.slot})" style="cursor:pointer">
        <div class="top-rank">${i + 1}</div>
        ${c.cover_url ? `<img class="top-cover" src="${escHtml(c.cover_url)}" alt="">` : `<div class="top-cover-ph">${c.slot}</div>`}
        <div class="list-meta">
          <div class="list-primary">${escHtml(c.cd_title || 'CD ' + c.slot)}</div>
          <div class="list-secondary">${escHtml(c.cd_artist || '')} · ${c.play_count}x</div>
        </div>
      </div>`).join('');
    html += '</div>';
  }

  html += `<div style="margin-top:24px;text-align:right">
    <button class="btn btn-danger btn-sm" onclick="resetPlayStats()">${t('stats.reset')}</button>
  </div>`;
  return html;
}

async function resetPlayStats() {
  if (!confirm(t('stats.resetConfirm'))) return;
  try {
    await api('/stats/reset', 'DELETE');
    toast(t('stats.resetDone'));
    await loadStats();
  } catch (err) { toast(err.message, 'error'); }
}

function renderStatsToplist() {
  let html = `<div class="stats-controls">
    <div class="btn-group">
      <button class="btn btn-sm ${topListView === 'cds' ? 'btn-primary' : ''}" onclick="topListView='cds';renderStatsTab()">${t('stats.topCDs')}</button>
      <button class="btn btn-sm ${topListView === 'tracks' ? 'btn-primary' : ''}" onclick="topListView='tracks';renderStatsTab()">${t('stats.topTracks')}</button>
    </div>
    <div class="btn-group">
      ${[10, 25, 50, 100].map(n => `<button class="btn btn-sm ${topListLimit === n ? 'btn-primary' : ''}" onclick="changeTopLimit(${n})">Top ${n}</button>`).join('')}
      <button class="btn btn-sm ${topListLimit === 9999 ? 'btn-primary' : ''}" onclick="changeTopLimit(9999)">${t('stats.all')}</button>
    </div>
  </div>`;

  if (topListView === 'cds') {
    const items = statsData.topCDs.slice(0, topListLimit);
    if (!items.length) return html + `<div class="empty-state"><p>${t('stats.noData')}</p></div>`;
    html += items.map((c, i) => `
      <div class="list-item" onclick="loadAndPlayCD(${c.slot})" style="cursor:pointer">
        <div class="top-rank">${i + 1}</div>
        ${c.cover_url ? `<img class="top-cover" src="${escHtml(c.cover_url)}" alt="">` : `<div class="top-cover-ph">${c.slot}</div>`}
        <div class="list-meta">
          <div class="list-primary">${escHtml(c.cd_title || 'CD ' + c.slot)}</div>
          <div class="list-secondary">${escHtml(c.cd_artist || '')} · Slot ${c.slot}</div>
        </div>
        <div class="top-count"><div class="top-count-val">${c.play_count}x</div><div class="top-count-sub">${c.track_plays ? c.track_plays + ' Tracks' : ''}</div><div class="top-count-sub">${formatDate(c.last_played)}</div></div>
      </div>`).join('');
  } else {
    const items = statsData.topTracks.slice(0, topListLimit);
    if (!items.length) return html + `<div class="empty-state"><p>${t('stats.noData')}</p></div>`;
    html += items.map((tr, i) => `
      <div class="list-item" onclick="loadAndPlayTrack(${tr.slot},${tr.track_number})" style="cursor:pointer">
        <div class="top-rank">${i + 1}</div>
        ${tr.cover_url ? `<img class="top-cover" src="${escHtml(tr.cover_url)}" alt="">` : `<div class="top-cover-ph">${tr.slot}</div>`}
        <div class="list-meta">
          <div class="list-primary">${escHtml(tr.track_title || 'Track ' + tr.track_number)}</div>
          <div class="list-secondary">${escHtml(tr.cd_artist || '')} · ${escHtml(tr.cd_title || 'CD ' + tr.slot)} · Track ${tr.track_number}</div>
        </div>
        <div class="top-count"><div class="top-count-val">${tr.play_count}x</div><div class="top-count-sub">${formatDate(tr.last_played)}</div></div>
      </div>`).join('');
  }
  return html;
}

async function changeTopLimit(n) {
  topListLimit = n;
  if (n > statsData.topCDs.length || n > statsData.topTracks.length) {
    statsData = await api('/stats?top=' + (n === 9999 ? 99999 : n));
  }
  renderStatsTab();
}

function renderStatsActivity() {
  let html = `<div class="stats-controls">
    <div class="btn-group">
      ${['daily', 'weekly', 'monthly', 'yearly'].map(p =>
        `<button class="btn btn-sm ${activityPeriod === p ? 'btn-primary' : ''}" onclick="activityPeriod='${p}';renderStatsTab()">${t('stats.' + p)}</button>`
      ).join('')}
    </div>
  </div>`;

  const data = statsData[activityPeriod] || [];
  if (!data.length) return html + `<div class="empty-state"><p>${t('stats.noData')}</p></div>`;

  const maxPlays = Math.max(...data.map(d => d.play_count));

  html += `<div class="chart-container"><div class="bar-chart">`;
  for (const d of data) {
    const pct = maxPlays > 0 ? (d.play_count / maxPlays * 100) : 0;
    const label = activityPeriod === 'yearly' ? d.period : d.period.substring(5);
    html += `<div class="bar-col">
      <div class="bar-value">${d.play_count}</div>
      <div class="bar-fill" style="height:${Math.max(pct, 2)}%"></div>
      <div class="bar-label">${label}</div>
    </div>`;
  }
  html += `</div></div>`;

  html += `<div class="stats-table"><table>
    <thead><tr><th>${t('stats.period')}</th><th>${t('stats.plays')}</th><th>${t('stats.playTime')}</th><th>${t('stats.uniqueCDs')}</th><th>${t('stats.uniqueTracks')}</th></tr></thead><tbody>`;
  for (const d of [...data].reverse()) {
    html += `<tr><td>${d.period}</td><td>${d.play_count}</td><td>${formatDuration(d.play_time_sec)}</td><td>${d.unique_cds}</td><td>${d.unique_tracks}</td></tr>`;
  }
  html += `</tbody></table></div>`;
  return html;
}

function renderStatsInventory() {
  const inv = statsData.inventory;
  let html = `<div class="stats-grid">
    <div class="stat-card"><div class="stat-value">${inv.totalCDs}</div><div class="stat-label">${t('stats.cds')}</div></div>
    <div class="stat-card"><div class="stat-value">${inv.totalTracks}</div><div class="stat-label">${t('stats.tracks')}</div></div>
    <div class="stat-card"><div class="stat-value">${formatDuration(inv.totalDurationSeconds)}</div><div class="stat-label">${t('stats.totalDuration')}</div></div>
    <div class="stat-card"><div class="stat-value">${inv.totalPlaylists}</div><div class="stat-label">${t('stats.playlists')}</div></div>
    <div class="stat-card"><div class="stat-value">${inv.totalPlaylistItems}</div><div class="stat-label">${t('stats.playlistItems')}</div></div>
    <div class="stat-card"><div class="stat-value">${inv.totalFavorites}</div><div class="stat-label">${t('stats.favorites')}</div></div>
    <div class="stat-card"><div class="stat-value">${inv.totalRatings}</div><div class="stat-label">${t('stats.totalRatings')}</div></div>
    <div class="stat-card"><div class="stat-value">${inv.avgRating ? inv.avgRating.toFixed(1) + ' &#9733;' : '-'}</div><div class="stat-label">${t('stats.avgRating')}</div></div>
  </div>`;

  if (inv.genreDistribution && inv.genreDistribution.length) {
    const maxCount = Math.max(...inv.genreDistribution.map(g => g.count));
    html += `<div class="card" style="margin-top:16px"><div class="card-header"><span class="card-title">${t('stats.genreDistribution')}</span></div>`;
    html += inv.genreDistribution.map(g => `
      <div class="genre-bar-row">
        <span class="genre-bar-label">${escHtml(g.genre || t('stats.unknown'))}</span>
        <div class="genre-bar-track"><div class="genre-bar-fill" style="width:${(g.count / maxCount * 100)}%"></div></div>
        <span class="genre-bar-count">${g.count}</span>
      </div>`).join('');
    html += '</div>';
  }
  return html;
}

async function loadSettings() {
  try {
    const settings = await api('/settings');
    document.getElementById('settSerialPort').value = settings.serial_port || '/dev/ttyUSB0';
    document.getElementById('settBaudRate').value = settings.baud_rate || '9600';
    document.getElementById('settModel').value = settings.model || 'CAC-V3000';
    document.getElementById('settMaxDiscs').value = settings.max_discs || '300';
    document.getElementById('settWebPort').value = settings.web_port || '3000';
    document.getElementById('settMbAppName').value = settings.mb_app_name || 'CACController';
    document.getElementById('settMbAppVersion').value = settings.mb_app_version || '1.0';
    document.getElementById('settMbContact').value = settings.mb_contact || '';
    document.getElementById('settNodeName').value = settings.node_name || '';
    document.getElementById('settNodeRoom').value = settings.node_room || '';
    document.getElementById('settNodeApiKey').value = settings.node_api_key || '';
    document.getElementById('settStatsMinSeconds').value = settings.stats_min_seconds || '30';
    document.getElementById('settLanguage').value = getStoredLanguagePref();
  } catch (err) { console.error(err); }
}

async function saveSettings() {
  try {
    await api('/settings', 'PUT', {
      serial_port: document.getElementById('settSerialPort').value,
      baud_rate: document.getElementById('settBaudRate').value,
      model: document.getElementById('settModel').value,
      max_discs: document.getElementById('settMaxDiscs').value,
      web_port: document.getElementById('settWebPort').value,
      mb_app_name: document.getElementById('settMbAppName').value,
      mb_app_version: document.getElementById('settMbAppVersion').value,
      mb_contact: document.getElementById('settMbContact').value,
      node_name: document.getElementById('settNodeName').value,
      node_room: document.getElementById('settNodeRoom').value,
      node_api_key: document.getElementById('settNodeApiKey').value,
      stats_min_seconds: document.getElementById('settStatsMinSeconds').value,
      language: document.getElementById('settLanguage').value,
    });
    toast(t('settings.saved'), 'success');
  } catch (err) { toast(err.message, 'error'); }
}

function generateApiKey() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let key = '';
  for (let i = 0; i < 32; i++) key += chars[Math.floor(Math.random() * chars.length)];
  document.getElementById('settNodeApiKey').value = key;
}

// ── Backup ──
async function exportBackup() {
  try {
    const data = await api('/backup');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cac-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast(t('backup.exportDone'), 'success');
  } catch (err) { toast(err.message, 'error'); }
}

async function importBackup(fileInput) {
  const file = fileInput.files[0];
  if (!file) return;
  if (!confirm(t('backup.importConfirm'))) { fileInput.value = ''; return; }
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await api('/backup', 'POST', data);
    toast(t('backup.importDone'), 'success');
    setTimeout(() => location.reload(), 1500);
  } catch (err) {
    toast(t('backup.importError') + ': ' + err.message, 'error');
  }
  fileInput.value = '';
}

// ── Cover Backup ──
async function exportCovers() {
  try {
    const resp = await fetch('/api/backup/covers');
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      toast(err.error || t('backup.coversNone'), 'error');
      return;
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cac-covers-${new Date().toISOString().slice(0, 10)}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    toast(t('backup.coversExportDone'), 'success');
  } catch (err) { toast(err.message, 'error'); }
}

async function importCovers(fileInput) {
  const file = fileInput.files[0];
  if (!file) return;
  if (!confirm(t('backup.coversImportConfirm'))) { fileInput.value = ''; return; }
  try {
    const resp = await fetch('/api/backup/covers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip' },
      body: file
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error);
    toast(t('backup.coversImportDone', data.imported), 'success');
  } catch (err) {
    toast(t('backup.importError') + ': ' + err.message, 'error');
  }
  fileInput.value = '';
}

// ── Terminal ──
function appendTerminal(text) {
  const el = document.getElementById('termOutput');
  el.textContent += text + '\n';
  el.scrollTop = el.scrollHeight;
}

async function sendTerminal() {
  const input = document.getElementById('termInput');
  const cmd = input.value.trim();
  if (!cmd) return;
  input.value = '';
  appendTerminal(`> ${activePlayer}PS${cmd}`);
  try {
    const result = await api(`/player/${activePlayer}/raw`, 'POST', { command: cmd });
    if (result.response?.raw) appendTerminal(`< ${result.response.raw}`);
  } catch (err) { appendTerminal(`! ${err.message}`); }
}

// ── Modals ──
function closeModal(id) { document.getElementById(id).classList.remove('active'); }
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('active'); });
});

// ── Utilities ──
// ── CD Editor ──
const CDEDITOR_GENRES = [
  'Alternative', 'Ambient', 'Blues', 'Children\'s', 'Classical', 'Country',
  'Dance', 'Disco', 'Electronic', 'Folk', 'Funk', 'Gospel', 'Grunge',
  'Hip-Hop', 'House', 'Indie', 'Industrial', 'Jazz', 'K-Pop', 'Latin',
  'Lo-Fi', 'Metal', 'Musical', 'New Age', 'New Wave', 'Opera', 'Pop',
  'Post-Punk', 'Progressive Rock', 'Psychedelic', 'Punk', 'R&B', 'Reggae',
  'Rock', 'Schlager', 'Singer-Songwriter', 'Ska', 'Soul', 'Soundtrack',
  'Spoken Word', 'Swing', 'Synth-Pop', 'Techno', 'Trance', 'Trip-Hop',
  'Vocal', 'World'
];

const CDEDITOR_LABELS = [
  '4AD', 'A&M Records', 'Ariola', 'Arista', 'Atlantic', 'Avex',
  'BBC Records', 'BMG', 'Blue Note', 'Capitol', 'Chrysalis',
  'Columbia', 'Cooking Vinyl', 'Decca', 'Def Jam', 'Deutsche Grammophon',
  'Domino', 'Drag City', 'ECM', 'EMI', 'Elektra', 'Epic', 'Epitaph',
  'Factory', 'Fantasy', 'Fiction', 'Geffen', 'Harvest', 'Interscope',
  'Island', 'Jive', 'K-tel', 'London', 'MCA', 'MFSL', 'Matador',
  'Mercury', 'Merge', 'Motown', 'Mute', 'Nonesuch', 'Parlophone',
  'Philips', 'Polydor', 'Polystar', 'RCA', 'Reprise', 'Rhino',
  'Roadrunner', 'Rough Trade', 'Rykodisc', 'SONY', 'Sanctuary',
  'Secretly Canadian', 'Sire', 'Sony Music', 'Stiff', 'Sub Pop',
  'Sumerian', 'Telstar', 'Teldec', 'Universal', 'Vagrant', 'Verve',
  'Virgin', 'Warp', 'Warner Bros.', 'XL Recordings', 'ZTT'
];

let _cdeditorYearOpts = '', _cdeditorLabelOpts = '', _cdeditorGenreOpts = '';

// ── Combobox for selects ──
let _cdeComboData = { year: [], label: [], genre: [] };
let _cdeRecentlyUsed = { year: [], label: [], genre: [] };
const CDE_RECENT_MAX = 5;

function cdeComboCreate(field, slot) {
  return `<div class="cde-combo" data-field="${field}" data-slot="${slot}">
    <div class="cde-combo-display" onclick="cdeComboToggle(this)" tabindex="0" onkeydown="cdeComboKey(event,this)">—</div>
    <div class="cde-combo-drop">
      <div class="cde-combo-search"><input type="text" placeholder="${t('library.search')}" oninput="cdeComboFilter(this)" onkeydown="cdeComboSearchKey(event)"></div>
      <div class="cde-combo-opts"></div>
    </div>
  </div>`;
}

function cdeComboSetValue(combo, value) {
  const display = combo.querySelector('.cde-combo-display');
  display.textContent = value || '—';
  combo.dataset.value = value || '';
}

function cdeComboRenderOpts(combo) {
  const field = combo.dataset.field;
  const currentVal = combo.dataset.value || '';
  const opts = combo.querySelector('.cde-combo-opts');
  const searchVal = (combo.querySelector('.cde-combo-search input')?.value || '').toLowerCase();
  const items = _cdeComboData[field] || [];
  const recent = _cdeRecentlyUsed[field] || [];
  const filtered = searchVal ? items.filter(v => v.toLowerCase().includes(searchVal)) : items;

  let html = '';

  // recently used section (only when not searching)
  if (!searchVal && recent.length > 0) {
    html += `<div class="cde-combo-opt cde-combo-section">${t('cdeditor.recent')}</div>`;
    html += recent.map(v =>
      `<div class="cde-combo-opt cde-recent${v === currentVal ? ' selected' : ''}" data-val="${escAttr(v)}" onclick="cdeComboSelect(this)">${escHtml(v)}</div>`
    ).join('');
    html += `<div class="cde-combo-opt cde-combo-section">${t('cdeditor.allValues')}</div>`;
  }

  html += `<div class="cde-combo-opt${!currentVal ? ' selected' : ''}" data-val="" onclick="cdeComboSelect(this)">—</div>`;
  html += filtered.map(v =>
    `<div class="cde-combo-opt${v === currentVal ? ' selected' : ''}" data-val="${escAttr(v)}" onclick="cdeComboSelect(this)">${escHtml(v)}</div>`
  ).join('');
  html += `<div class="cde-combo-opt custom-opt" data-val="__custom__" onclick="cdeComboSelect(this)">+ ${t('cdeditor.custom')}</div>`;
  opts.innerHTML = html;

  // highlight first real match when searching (skip "—" placeholder)
  if (searchVal && filtered.length > 0) {
    const realOpts = [...opts.querySelectorAll('.cde-combo-opt[data-val]:not(.cde-combo-section):not(.custom-opt)')].filter(o => o.dataset.val !== '');
    opts.querySelectorAll('.highlight').forEach(el => el.classList.remove('highlight'));
    if (realOpts.length > 0) {
      realOpts[0].classList.add('highlight');
      realOpts[0].scrollIntoView({ block: 'nearest' });
    }
  } else {
    const sel = opts.querySelector('.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }
}

function cdeComboToggle(display) {
  const combo = display.closest('.cde-combo');
  const drop = combo.querySelector('.cde-combo-drop');
  const isOpen = drop.classList.contains('open');

  // close all others first
  document.querySelectorAll('.cde-combo-drop.open').forEach(d => d.classList.remove('open'));

  if (!isOpen) {
    drop.classList.add('open');
    const input = drop.querySelector('input');
    input.value = '';
    cdeComboRenderOpts(combo);
    input.focus();
  }
}

function cdeComboFilter(input) {
  const combo = input.closest('.cde-combo');
  cdeComboRenderOpts(combo);
}

function cdeComboSearchKey(e) {
  const combo = e.target.closest('.cde-combo');
  const opts = combo.querySelector('.cde-combo-opts');
  const selectable = [...opts.querySelectorAll('.cde-combo-opt[data-val]:not(.cde-combo-section)')];
  if (e.key === 'Enter') {
    e.preventDefault();
    const highlighted = opts.querySelector('.highlight');
    if (highlighted) cdeComboSelect(highlighted);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    combo.querySelector('.cde-combo-drop').classList.remove('open');
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (selectable.length === 0) return;
    const cur = opts.querySelector('.highlight');
    let idx = cur ? selectable.indexOf(cur) : -1;
    if (cur) cur.classList.remove('highlight');
    idx = e.key === 'ArrowDown' ? Math.min(idx + 1, selectable.length - 1) : Math.max(idx - 1, 0);
    selectable[idx].classList.add('highlight');
    selectable[idx].scrollIntoView({ block: 'nearest' });
  }
}

function cdeComboKey(e, display) {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cdeComboToggle(display); }
}

function cdeTrackRecent(field, val) {
  if (!val) return;
  const list = _cdeRecentlyUsed[field];
  const idx = list.indexOf(val);
  if (idx !== -1) list.splice(idx, 1);
  list.unshift(val);
  if (list.length > CDE_RECENT_MAX) list.pop();
}

function cdeComboSelect(optEl) {
  const combo = optEl.closest('.cde-combo');
  const val = optEl.dataset.val;
  const field = combo.dataset.field;
  const drop = combo.querySelector('.cde-combo-drop');
  drop.classList.remove('open');

  if (val === '__custom__') {
    cdeComboCustom(combo);
    return;
  }
  cdeComboSetValue(combo, val);
  cdeTrackRecent(field, val);
  cdeComboSave(combo);
}

function cdeComboCustom(combo) {
  const field = combo.dataset.field;
  const display = combo.querySelector('.cde-combo-display');
  const oldVal = combo.dataset.value || '';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cde-combo-display cdeditor-custom-input';
  input.style.cursor = 'text';
  display.style.display = 'none';
  combo.insertBefore(input, display);
  input.focus();

  const finish = (save) => {
    const val = input.value.trim();
    input.remove();
    display.style.display = '';
    if (save && val) {
      cdeditorAddCustomOption(field, val);
      cdeComboSetValue(combo, val);
      cdeComboSave(combo);
    }
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

function cdeComboSave(combo) {
  const slot = combo.dataset.slot;
  const field = combo.dataset.field;
  const value = combo.dataset.value || '';
  const display = combo.querySelector('.cde-combo-display');
  api(`/library/${slot}`, 'PUT', { [field]: value }).then(() => {
    display.classList.add('changed');
    combo.closest('.cdeditor-item').classList.add('cdeditor-saved');
    setTimeout(() => {
      display.classList.remove('changed');
      combo.closest('.cdeditor-item').classList.remove('cdeditor-saved');
    }, 1500);
    const cd = library.find(c => c.slot == slot);
    if (cd) cd[field] = value;
  }).catch(err => toast(err.message, 'error'));
}

// close combos on outside click
document.addEventListener('click', e => {
  if (!e.target.closest('.cde-combo')) {
    document.querySelectorAll('.cde-combo-drop.open').forEach(d => d.classList.remove('open'));
  }
});

function loadCDEditor() {
  const container = document.getElementById('cdeditorList');
  if (!library || library.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>${t('library.empty')}</p></div>`;
    document.getElementById('cdeditorCount').textContent = '';
    return;
  }

  // collect existing values for custom options
  const existingYears = new Set(), existingLabels = new Set(), existingGenres = new Set();
  for (const cd of library) {
    if (cd.year) { const m = (cd.year+'').match(/(\d{4})/); if (m) existingYears.add(m[1]); }
    if (cd.label) existingLabels.add(cd.label);
    if (cd.genre) existingGenres.add(cd.genre);
  }

  // merge with presets
  const allLabels = [...new Set([...CDEDITOR_LABELS, ...existingLabels])].sort();
  const allGenres = [...new Set([...CDEDITOR_GENRES, ...existingGenres])].sort();
  const currentYear = new Date().getFullYear();
  const allYears = [];
  for (let y = currentYear; y >= 1950; y--) allYears.push(String(y));
  for (const y of existingYears) { if (!allYears.includes(y)) allYears.push(y); }
  allYears.sort((a, b) => b - a);

  // store combo data for combobox rendering
  _cdeComboData.year = allYears;
  _cdeComboData.label = allLabels;
  _cdeComboData.genre = allGenres;

  // populate filter dropdowns (with "no value" option)
  fillCDEditorFilterSelect('cdeditorFilterYear', t('library.allYears'), [...existingYears].sort((a,b) => b-a));
  fillCDEditorFilterSelect('cdeditorFilterLabel', t('library.allLabels'), [...existingLabels].sort());
  fillCDEditorFilterSelect('cdeditorFilterGenre', t('library.allGenres'), [...existingGenres].sort());

  renderCDEditorList();
}

function renderCDEditorList() {
  const container = document.getElementById('cdeditorList');
  const filtered = getCDEditorFiltered();
  const countEl = document.getElementById('cdeditorCount');
  countEl.textContent = t('library.countOf', filtered.length, library.length);

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state"><p style="padding:16px;color:var(--text-dim)">${t('cdeditor.noResults')}</p></div>`;
    return;
  }

  container.innerHTML = filtered.map(cd => {
    const coverHtml = cd.cover_url
      ? `<img src="${escHtml(cd.cover_url)}" alt="" onerror="this.outerHTML='<span class=cdeditor-cover-ph>&#9834;</span>'">`
      : `<span class="cdeditor-cover-ph">&#9834;</span>`;
    return `<div class="cdeditor-item" data-slot="${cd.slot}">
      <div class="cdeditor-cover">${coverHtml}</div>
      <div class="cdeditor-body">
        <div class="cdeditor-row1">
          <input type="number" class="cdeditor-slot-input" data-field="slot" data-slot="${cd.slot}" value="${cd.slot}" min="1" max="500" onchange="cdeditorMoveSlot(this)" title="${t('cdeditor.slotMove')}">
          <input type="text" class="cdeditor-text-input cdeditor-title-input" data-field="title" data-slot="${cd.slot}" value="${escAttr(cd.title||'')}" placeholder="${t('cdeditor.cdTitle')}" onchange="cdeditorSaveText(this)">
        </div>
        <input type="text" class="cdeditor-text-input cdeditor-artist-input" data-field="artist" data-slot="${cd.slot}" value="${escAttr(cd.artist||'')}" placeholder="${t('cdeditor.artist')}" onchange="cdeditorSaveText(this)">
        <div class="cdeditor-row2">
          <div class="cdeditor-field">
            <span class="cdeditor-field-label">${t('cdeditor.year')}</span>
            ${cdeComboCreate('year', cd.slot)}
          </div>
          <div class="cdeditor-field">
            <span class="cdeditor-field-label">${t('cdeditor.label')}</span>
            ${cdeComboCreate('label', cd.slot)}
          </div>
          <div class="cdeditor-field">
            <span class="cdeditor-field-label">${t('cdeditor.genre')}</span>
            ${cdeComboCreate('genre', cd.slot)}
          </div>
        </div>
        <input type="text" class="cdeditor-text-input cdeditor-notes-input" data-field="notes" data-slot="${cd.slot}" value="${escAttr(cd.notes||'')}" placeholder="${t('cdeditor.notes')}" onchange="cdeditorSaveText(this)">
      </div>
    </div>`;
  }).join('');

  // set current values for combos
  for (const cd of filtered) {
    const item = container.querySelector(`.cdeditor-item[data-slot="${cd.slot}"]`);
    if (!item) continue;
    const yearVal = cd.year ? ((cd.year+'').match(/(\d{4})/)||[])[1] || '' : '';
    item.querySelectorAll('.cde-combo').forEach(combo => {
      const f = combo.dataset.field;
      if (f === 'year') cdeComboSetValue(combo, yearVal);
      else cdeComboSetValue(combo, cd[f] || '');
    });
  }
}

function getCDEditorFiltered() {
  const slotVal = (document.getElementById('cdeditorFilterSlot')?.value || '').trim();
  const titleVal = (document.getElementById('cdeditorFilterTitle')?.value || '').toLowerCase();
  const artistVal = (document.getElementById('cdeditorFilterArtist')?.value || '').toLowerCase();
  const yearVal = document.getElementById('cdeditorFilterYear')?.value || '';
  const labelVal = document.getElementById('cdeditorFilterLabel')?.value || '';
  const genreVal = document.getElementById('cdeditorFilterGenre')?.value || '';

  const sortField = document.getElementById('cdeditorSortField')?.value || 'slot';
  const sortDir = document.getElementById('cdeditorSortDir')?.value || 'asc';

  return [...library].filter(cd => {
    if (slotVal && String(cd.slot) !== slotVal) return false;
    if (titleVal && !(cd.title||'').toLowerCase().includes(titleVal)) return false;
    if (artistVal && !(cd.artist||'').toLowerCase().includes(artistVal)) return false;
    if (yearVal === '__empty__') { if (cd.year && cd.year.trim() && cd.year.trim() !== '-') return false; }
    else if (yearVal) { const m = (cd.year||'').match(/(\d{4})/); if (!m || m[1] !== yearVal) return false; }
    if (labelVal === '__empty__') { if (cd.label && cd.label.trim() && cd.label.trim() !== '-') return false; }
    else if (labelVal && cd.label !== labelVal) return false;
    if (genreVal === '__empty__') { if (cd.genre && cd.genre.trim() && cd.genre.trim() !== '-') return false; }
    else if (genreVal && cd.genre !== genreVal) return false;
    return true;
  }).sort((a, b) => {
    let va, vb;
    if (sortField === 'slot') {
      va = a.slot; vb = b.slot;
    } else if (sortField === 'year') {
      va = ((a.year||'').match(/(\d{4})/)||[])[1] || ''; vb = ((b.year||'').match(/(\d{4})/)||[])[1] || '';
    } else {
      va = (a[sortField]||'').toLowerCase(); vb = (b[sortField]||'').toLowerCase();
    }
    const cmp = sortField === 'slot' ? va - vb : String(va).localeCompare(String(vb));
    return sortDir === 'desc' ? -cmp : cmp;
  });
}

function applyCDEditorFilters() { renderCDEditorList(); }

function resetCDEditorSort() {
  document.getElementById('cdeditorSortField').value = 'slot';
  document.getElementById('cdeditorSortDir').value = 'asc';
  renderCDEditorList();
}

function resetCDEditorFilters() {
  document.getElementById('cdeditorFilterSlot').value = '';
  document.getElementById('cdeditorFilterTitle').value = '';
  document.getElementById('cdeditorFilterArtist').value = '';
  document.getElementById('cdeditorFilterYear').value = '';
  document.getElementById('cdeditorFilterLabel').value = '';
  document.getElementById('cdeditorFilterGenre').value = '';
  renderCDEditorList();
}

function cdeditorAddCustomOption(field, val) {
  // add to combo data (sorted) so all future renders include it
  if (!_cdeComboData[field].includes(val)) {
    _cdeComboData[field].push(val);
    _cdeComboData[field].sort((a, b) => field === 'year' ? b - a : a.localeCompare(b));
  }
  // add to filter dropdown
  const filterIds = { year: 'cdeditorFilterYear', label: 'cdeditorFilterLabel', genre: 'cdeditorFilterGenre' };
  const filterSel = document.getElementById(filterIds[field]);
  if (filterSel && ![...filterSel.options].some(o => o.value === val)) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = val;
    // insert sorted
    const valLower = val.toLowerCase();
    let inserted = false;
    for (let i = 1; i < filterSel.options.length; i++) {
      if (filterSel.options[i].textContent.toLowerCase() > valLower) {
        filterSel.insertBefore(opt, filterSel.options[i]);
        inserted = true;
        break;
      }
    }
    if (!inserted) filterSel.appendChild(opt);
  }
}

function cdeditorManageField(field) {
  const fieldLabels = { year: t('cdeditor.year'), label: t('cdeditor.label'), genre: t('cdeditor.genre') };
  // collect values with counts
  const counts = {};
  for (const cd of library) {
    const v = field === 'year' ? ((cd.year||'').match(/(\d{4})/)||[])[1] || '' : cd[field] || '';
    if (v) counts[v] = (counts[v] || 0) + 1;
  }
  const values = Object.keys(counts).sort((a, b) => a.localeCompare(b));

  document.getElementById('modalTitle').textContent = `${fieldLabels[field]} — ${t('cdeditor.manageValues')}`;
  document.getElementById('modalContent').innerHTML = values.length === 0
    ? `<p style="color:var(--text-dim)">${t('cdeditor.noResults')}</p>`
    : `<div class="cdeditor-manage-list">${values.map(v => `
      <div class="cdeditor-manage-item">
        <span class="cdeditor-manage-name">${escHtml(v)}</span>
        <span class="cdeditor-manage-count">${counts[v]}</span>
        <button class="btn btn-dim btn-sm" onclick="cdeditorRenameValue('${escAttr(field)}','${escAttr(v)}')">${t('cdeditor.rename')}</button>
        <button class="btn btn-danger btn-sm" onclick="cdeditorDeleteValue('${escAttr(field)}','${escAttr(v)}')">${t('cdeditor.delete')}</button>
      </div>`).join('')}
    </div>`;
  document.getElementById('cdDetailModal').classList.add('active');
}

async function cdeditorRenameValue(field, oldValue) {
  const fieldLabels = { year: t('cdeditor.year'), label: t('cdeditor.label'), genre: t('cdeditor.genre') };
  // show inline rename in modal
  const item = [...document.querySelectorAll('.cdeditor-manage-item')].find(el =>
    el.querySelector('.cdeditor-manage-name').textContent === oldValue
  );
  if (!item) return;
  const nameEl = item.querySelector('.cdeditor-manage-name');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'form-input';
  input.value = oldValue;
  input.style.cssText = 'font-size:0.85rem;padding:3px 6px;flex:1;min-width:0';
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  const doRename = async () => {
    const newValue = input.value.trim();
    if (!newValue || newValue === oldValue) {
      input.replaceWith(nameEl);
      return;
    }
    try {
      const result = await api('/library/bulk-update-field', 'POST', { field, oldValue, newValue });
      toast(t('cdeditor.renamed', result.changes, fieldLabels[field]));
      await loadLibrary();
      loadCDEditor();
      cdeditorManageField(field); // refresh modal
    } catch (err) { toast(err.message, 'error'); }
  };

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); doRename(); }
    if (e.key === 'Escape') { e.preventDefault(); input.replaceWith(nameEl); }
  });
  input.addEventListener('blur', doRename);
}

async function cdeditorDeleteValue(field, value) {
  const fieldLabels = { year: t('cdeditor.year'), label: t('cdeditor.label'), genre: t('cdeditor.genre') };
  const count = library.filter(cd => {
    const v = field === 'year' ? ((cd.year||'').match(/(\d{4})/)||[])[1] || '' : cd[field] || '';
    return v === value;
  }).length;
  if (!confirm(t('cdeditor.deleteConfirm', value, count))) return;
  try {
    const result = await api('/library/bulk-update-field', 'POST', { field, oldValue: value, newValue: '' });
    toast(t('cdeditor.deleted', result.changes, fieldLabels[field]));
    await loadLibrary();
    loadCDEditor();
    cdeditorManageField(field);
  } catch (err) { toast(err.message, 'error'); }
}

async function cdeditorSaveText(input) {
  const slot = input.dataset.slot;
  const field = input.dataset.field;
  const value = input.value;
  try {
    await api(`/library/${slot}`, 'PUT', { [field]: value || '' });
    input.classList.add('changed');
    input.closest('.cdeditor-item').classList.add('cdeditor-saved');
    setTimeout(() => {
      input.classList.remove('changed');
      input.closest('.cdeditor-item').classList.remove('cdeditor-saved');
    }, 1500);
    const cd = library.find(c => c.slot == slot);
    if (cd) cd[field] = value;
  } catch (err) { toast(err.message, 'error'); }
}

async function cdeditorMoveSlot(input) {
  const fromSlot = parseInt(input.dataset.slot);
  const toSlot = parseInt(input.value);
  if (toSlot === fromSlot) return;
  if (!toSlot || toSlot < 1 || toSlot > 500) {
    toast(t('cdeditor.invalidSlot'), 'error');
    input.value = fromSlot;
    return;
  }
  try {
    await api(`/library/${fromSlot}/move`, 'POST', { toSlot });
    toast(t('cdeditor.slotMoved', fromSlot, toSlot));
    await loadLibrary();
    loadCDEditor();
  } catch (err) {
    toast(err.message, 'error');
    input.value = fromSlot;
  }
}

function formatDuration(seconds) {
  if (!seconds) return '00:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString(getLanguage() === 'de' ? 'de-DE' : 'en-US',
    { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function escHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
function escAttr(str) { return str.replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function toast(message, type = '') {
  const container = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
