// MusicBrainz API integration for CD metadata lookup

import * as db from './database.js';

const MB_BASE = 'https://musicbrainz.org/ws/2';
const COVER_BASE = 'https://coverartarchive.org';
const REQUEST_DELAY = 1100; // MusicBrainz rate limit: 1 request per second

let lastRequest = 0;

function getUserAgent() {
  const name = db.getSetting('mb_app_name') || 'CACController';
  const version = db.getSetting('mb_app_version') || '1.0';
  const contact = db.getSetting('mb_contact') || '';
  return contact ? `${name}/${version} (${contact})` : `${name}/${version}`;
}

async function rateLimitedFetch(url) {
  const now = Date.now();
  const elapsed = now - lastRequest;
  if (elapsed < REQUEST_DELAY) {
    await new Promise(r => setTimeout(r, REQUEST_DELAY - elapsed));
  }
  lastRequest = Date.now();

  console.log(`[MusicBrainz] Fetching: ${url}`);
  console.log(`[MusicBrainz] User-Agent: ${getUserAgent()}`);
  const response = await fetch(url, {
    headers: {
      'User-Agent': getUserAgent(),
      'Accept': 'application/json',
    },
  });

  console.log(`[MusicBrainz] Response: ${response.status} ${response.statusText}`);
  if (!response.ok) {
    const body = await response.text();
    console.log(`[MusicBrainz] Error body: ${body.substring(0, 200)}`);
    throw new Error(`MusicBrainz API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// Search for a release by disc ID (from TOC)
export async function lookupByDiscId(discId) {
  const data = await rateLimitedFetch(
    `${MB_BASE}/discid/${discId}?fmt=json&inc=recordings+artists+release-groups`
  );
  return data;
}

// Lookup by TOC sectors (fuzzy matching when exact disc ID not found)
export async function lookupByToc(firstTrack, lastTrack, leadOutSectors, trackOffsets) {
  const url = buildTocLookupUrl(firstTrack, lastTrack, leadOutSectors, trackOffsets);
  const data = await rateLimitedFetch(url);
  return data;
}

// Full disc lookup: try exact disc ID first, then TOC fuzzy match
export async function lookupDisc(discId, firstTrack, lastTrack, leadOutSectors, trackOffsets) {
  // 1. Try exact disc ID
  if (discId) {
    try {
      const data = await lookupByDiscId(discId);
      const releases = data?.disc?.['release-list'] || data?.['release-list'] || [];
      if (releases.length > 0) {
        console.log(`[MusicBrainz] Found by disc ID: ${releases[0].title}`);
        return releases[0];
      }
    } catch (err) {
      console.log(`[MusicBrainz] Disc ID lookup failed: ${err.message}`);
    }
  }

  // 2. Try TOC fuzzy match
  if (trackOffsets && trackOffsets.length > 0) {
    try {
      const data = await lookupByToc(firstTrack, lastTrack, leadOutSectors, trackOffsets);
      const releases = data?.releases || [];
      if (releases.length > 0) {
        console.log(`[MusicBrainz] Found by TOC: ${releases[0].title}`);
        return releases[0];
      }
    } catch (err) {
      console.log(`[MusicBrainz] TOC lookup failed: ${err.message}`);
    }
  }

  return null;
}

// Search for releases by text query
export async function searchRelease(query) {
  const encoded = encodeURIComponent(query);
  const data = await rateLimitedFetch(
    `${MB_BASE}/release/?query=${encoded}&fmt=json&limit=10`
  );
  return data.releases || [];
}

// Search by artist and album title
export async function searchByArtistAndTitle(artist, title) {
  const query = [];
  if (artist) query.push(`artist:"${artist}"`);
  if (title) query.push(`release:"${title}"`);
  return searchRelease(query.join(' AND '));
}

// Search by barcode/EAN
export async function searchByBarcode(barcode) {
  return searchRelease(`barcode:${barcode}`);
}

// Search by track count and total duration (for Pioneer scanner without per-track offsets)
export async function searchByTocInfo(trackCount, totalSeconds) {
  // MusicBrainz duration search uses milliseconds, allow ±30s tolerance
  const durationMs = totalSeconds * 1000;
  const tolerance = 30000;
  const minDur = durationMs - tolerance;
  const maxDur = durationMs + tolerance;

  // Search for releases with matching track count and duration range
  const query = `tracks:${trackCount} AND dur:[${minDur} TO ${maxDur}]`;
  console.log(`[MusicBrainz] Searching: ${query}`);
  const releases = await searchRelease(query);

  if (releases.length === 0) {
    // Retry with wider tolerance (±60s)
    const query2 = `tracks:${trackCount} AND dur:[${durationMs - 60000} TO ${durationMs + 60000}]`;
    console.log(`[MusicBrainz] Retry with wider tolerance: ${query2}`);
    const releases2 = await searchRelease(query2);
    if (releases2.length > 0) {
      console.log(`[MusicBrainz] Found ${releases2.length} results (wider tolerance), best: ${releases2[0].title} (score: ${releases2[0].score})`);
      return releases2[0];
    }
    console.log(`[MusicBrainz] No results found`);
    return null;
  }

  console.log(`[MusicBrainz] Found ${releases.length} results, best: ${releases[0].title} (score: ${releases[0].score})`);
  return releases[0];
}

// Get detailed release info
export async function getRelease(releaseId) {
  const data = await rateLimitedFetch(
    `${MB_BASE}/release/${releaseId}?fmt=json&inc=recordings+artists+release-groups+labels+media`
  );
  return data;
}

// Get cover art URLs
export async function getCoverArt(releaseId) {
  try {
    const response = await fetch(`${COVER_BASE}/release/${releaseId}`, {
      headers: { 'User-Agent': getUserAgent(), 'Accept': 'application/json' },
    });
    if (!response.ok) return null;
    const data = await response.json();
    const front = data.images?.find(img => img.front);
    return {
      front: front?.thumbnails?.['500'] || front?.thumbnails?.large || front?.image || null,
      images: data.images || [],
    };
  } catch {
    return null;
  }
}

// Calculate MusicBrainz Disc ID from TOC data
// Uses the same algorithm as libdiscid: SHA-1 of track offsets in sectors
import { createHash } from 'crypto';

export function calculateDiscId(firstTrack, lastTrack, leadOutSectors, trackOffsets) {
  // MusicBrainz disc ID: SHA-1 of a specific binary structure
  // Format: sprintf("%02X%02X%08X", firstTrack, lastTrack, leadOutSectors)
  // then for tracks 1..99: sprintf("%08X", offset[i]) (0 for non-existent tracks)
  let input = '';
  input += firstTrack.toString(16).toUpperCase().padStart(2, '0');
  input += lastTrack.toString(16).toUpperCase().padStart(2, '0');

  // Offsets array: index 0 = lead-out, index 1..99 = track offsets
  const offsets = new Array(100).fill(0);
  offsets[0] = leadOutSectors;
  for (let i = 0; i < trackOffsets.length; i++) {
    offsets[firstTrack + i] = trackOffsets[i];
  }

  for (let i = 0; i <= 99; i++) {
    input += offsets[i].toString(16).toUpperCase().padStart(8, '0');
  }

  // SHA-1 hash, base64 with MusicBrainz-specific URL-safe encoding
  const sha1 = createHash('sha1').update(input, 'ascii').digest('base64');
  // MusicBrainz uses a modified base64: + → . , / → _ , = → -
  return sha1.replace(/\+/g, '.').replace(/\//g, '_').replace(/=/g, '-');
}

// Convert Pioneer TOC time (min:sec:frames) to sector offset
// CD audio: 75 frames per second, starting at sector 150 (2 second lead-in)
export function timeToSectors(min, sec, frames) {
  return (min * 60 + sec) * 75 + frames;
}

// Build TOC lookup URL for MusicBrainz (fuzzy matching when exact disc ID fails)
export function buildTocLookupUrl(firstTrack, lastTrack, leadOutSectors, trackOffsets) {
  const toc = [firstTrack, lastTrack, leadOutSectors, ...trackOffsets].join('+');
  return `${MB_BASE}/discid/-?toc=${toc}&fmt=json&inc=recordings+artists+release-groups`;
}

// Parse MusicBrainz release into our CD format
export function parseReleaseToCD(release) {
  const medium = release.media?.[0];
  const tracks = medium?.tracks || [];
  const artistCredit = release['artist-credit'] || [];
  const artist = artistCredit.map(ac => ac.name || ac.artist?.name).join('');

  const releaseGroup = release['release-group'] || {};
  const labels = release['label-info'] || [];

  const parsedTracks = tracks.map((t, i) => {
    const trackArtist = t.recording?.['artist-credit']?.map(ac => ac.name || ac.artist?.name).join('') || artist;
    const durationMs = t.recording?.length || t.length || 0;
    return {
      track_number: t.position || i + 1,
      title: t.title || t.recording?.title || '',
      artist: trackArtist,
      duration_seconds: Math.round(durationMs / 1000),
      isrc: '',
    };
  });

  const totalDuration = parsedTracks.reduce((sum, t) => sum + t.duration_seconds, 0);

  return {
    cd: {
      title: release.title || '',
      artist: artist,
      year: release.date ? release.date.substring(0, 4) : '',
      genre: releaseGroup['primary-type'] || '',
      total_tracks: parsedTracks.length,
      total_duration_seconds: totalDuration,
      musicbrainz_release_id: release.id || '',
      barcode: release.barcode || '',
      label: labels[0]?.label?.name || '',
      country: release.country || '',
    },
    tracks: parsedTracks,
  };
}

// Search and return structured results for the frontend
export async function searchAndParse(query) {
  const releases = await searchRelease(query);
  const results = [];

  // Fetch full details for each release (sequentially for rate limiting)
  for (const release of releases.slice(0, 10)) {
    try {
      const full = await getRelease(release.id);
      const parsed = parseReleaseToCD(full);

      let coverUrl = null;
      try {
        const cover = await getCoverArt(release.id);
        coverUrl = cover?.front || null;
      } catch { /* ignore */ }

      results.push({
        ...parsed,
        cd: {
          ...parsed.cd,
          cover_url: coverUrl || '',
          format: full.media?.[0]?.format || '',
          status: full.status || '',
          date: full.date || '',
        },
        releaseId: release.id,
        score: release.score,
      });
    } catch (err) {
      console.log(`[MusicBrainz] Failed to fetch release ${release.id}: ${err.message}`);
    }
  }

  return results;
}

// Fetch full release details and parse
export async function fetchAndParse(releaseId) {
  const release = await getRelease(releaseId);
  const parsed = parseReleaseToCD(release);

  let coverUrl = null;
  try {
    const cover = await getCoverArt(releaseId);
    coverUrl = cover?.front || null;
  } catch { /* ignore */ }

  return {
    ...parsed,
    cd: { ...parsed.cd, cover_url: coverUrl || '' },
  };
}
