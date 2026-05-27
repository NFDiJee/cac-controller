// Pioneer CAC-V3000/V3200/V5000 Serial Protocol - Complete Implementation
// Based on official Pioneer Programming Manual (Version 2.0, May 1993)

export const MODELS = {
  'CAC-V180M': { baud: 4800, maxDiscs: 18, dualPlayer: false, hasVolume: false, hasSpeed: false },
  'CAC-V3000': { baud: 9600, maxDiscs: 300, dualPlayer: true, hasVolume: true, hasSpeed: true },
  'CAC-V3200': { baud: 9600, maxDiscs: 300, dualPlayer: true, hasVolume: true, hasSpeed: true },
  'CAC-V5000': { baud: 9600, maxDiscs: 500, dualPlayer: true, hasVolume: true, hasSpeed: true },
};

export const SERIAL_CONFIG = {
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  terminator: '\r',
  maxCommandLength: 20,
  responseTimeout: 2000,
  mechanicalTimeout: 45000,
};

// Execution Commands
export const CMD = {
  PLAYER_SELECT:    'PS',
  DISC_SELECT:      'ZS',
  DISC_RETURN:      'ZR',
  START:            'SA',
  REJECT:           'RJ',
  PLAY:             'PL',
  PAUSE:            'PA',
  SCAN_FORWARD:     'NF',
  SCAN_REVERSE:     'NR',
  SEARCH:           'SE',
  STOP_MARKER:      'SM',
  AUTO_CUE_SEARCH:  'QS',
  AUTO_CUE_STOP:    'QT',
  CUE_LEVEL:        'QL',
  BLOCK:            'BK',
  TIME:             'TM',
  TRACK:            'TR',
  INDEX:            'IX',
  CLEAR:            'CL',
  LEAD_OUT:         'LO',
  SPEED:            'SP',
  VOLUME:           'VL',
  DURATION:         'DU',
  FADE:             'FD',
  LIMIT_TIME:       'LT',
  COMM_MODE:        'CM',
  CHANGER_RESET:    '!!',
};

// Query Commands
export const QUERY = {
  JOB_STATUS:       '?J',
  PLAYER_MODE:      '?P',
  DISC_NUMBER:      '?Z',
  MECH_ERROR:       '?E',
  BLOCK_NUMBER:     '?B',
  TIME_CODE:        '?T',
  TRACK_NUMBER:     '?R',
  INDEX_NUMBER:     '?I',
  TOC_INFO:         '?Q',
  CATALOG:          '?G',
  MODEL_NAME:       '?X',
  COMM_MODE:        '?M',
  PLAY_TIME:        '?A',
  DISC_STATUS:      '?K',
};

// Player Mode Codes (?P response)
export const PLAYER_MODES = {
  'P01': { id: 'park',      label: 'Park',        description: 'Disc nicht rotierend' },
  'P02': { id: 'setup',     label: 'Set Up',      description: 'TOC wird gelesen' },
  'P03': { id: 'reject',    label: 'Reject',      description: 'Motor stoppt' },
  'P04': { id: 'play',      label: 'Play',        description: 'Wiedergabe' },
  'P06': { id: 'pause',     label: 'Pause',       description: 'Pausiert' },
  'P07': { id: 'search',    label: 'Search',      description: 'Suche' },
  'P08': { id: 'scan',      label: 'Scan',        description: 'Scan' },
  'P20': { id: 'unset',     label: 'Disc Unset',  description: 'Keine CD geladen' },
  'P21': { id: 'load',      label: 'Load',        description: 'CD wird geladen' },
  'P22': { id: 'unload',    label: 'Unload',      description: 'CD wird zurueckgelegt' },
};

// Error Codes
export const ERRORS = {
  'E00': 'Kommunikationsfehler',
  'E04': 'Funktion nicht verfuegbar',
  'E05': 'Argument fehlt',
  'E11': 'Disc nicht vorhanden',
  'E12': 'Adressfehler',
  'E13': 'Defokussierung',
  'E14': 'Spindel entsperrt',
  'E20': 'Wechsler-Panik',
  'E21': 'Tuer offen',
  'E22': 'Wechsler initialisiert',
  'E81': 'Kein Player verfuegbar',
  'E82': 'Pufferueberlauf (CDP)',
  'E83': 'Player-Fehler',
  'E84': 'Protokollfehler',
  'E85': 'Pufferueberlauf (Host)',
  'E86': 'SWING nicht sicher',
  'E87': 'SLIDE nicht sicher',
  'E88': 'Versionskonflikt',
  'E89': 'Keine Antwort',
  'E90': 'Backup-Daten defekt',
  'E91': 'Mechanik-Timeout',
  'E92': 'Disc kann nicht gegriffen werden',
  'E93': 'Rueckgabeadresse verloren',
  'E94': 'Vertikalbewegung blockiert',
  'E95': 'Software-Fehler',
  'E96': 'Startfehler',
  'E99': 'Player-Panik',
};

// Volume mapping (dB to argument value)
export const VOLUME_MAP = [
  { db: 0, value: 255 },
  { db: -1, value: 247 },
  { db: -3, value: 239 },
  { db: -6, value: 230 },
  { db: -10, value: 213 },
  { db: -20, value: 174 },
  { db: -30, value: 138 },
  { db: -40, value: 97 },
  { db: -50, value: 60 },
  { db: -60, value: 16 },
  { db: -70, value: 5 },
  { db: -80, value: 1 },
  { db: -Infinity, value: 0 },
];

// Build command string for dual-player models
export function buildCommand(playerId, ...commands) {
  const cmdStr = commands.join('');
  if (cmdStr.length > SERIAL_CONFIG.maxCommandLength) {
    throw new Error(`Command too long: ${cmdStr.length} > ${SERIAL_CONFIG.maxCommandLength}`);
  }
  return `${playerId}PS${cmdStr}${SERIAL_CONFIG.terminator}`;
}

// Build specific commands
export function cmdDiscSelect(playerId, discNumber) {
  const num = String(discNumber).padStart(3, '0');
  return buildCommand(playerId, `${num}${CMD.DISC_SELECT}`);
}

export function cmdDiscReturn(playerId) {
  return buildCommand(playerId, CMD.DISC_RETURN);
}

export function cmdStart(playerId) {
  return buildCommand(playerId, CMD.START);
}

export function cmdPlay(playerId) {
  return buildCommand(playerId, CMD.PLAY);
}

export function cmdPause(playerId) {
  return buildCommand(playerId, CMD.PAUSE);
}

export function cmdReject(playerId) {
  return buildCommand(playerId, CMD.REJECT);
}

export function cmdSearchTrack(playerId, trackNumber) {
  const num = String(trackNumber).padStart(2, '0');
  return buildCommand(playerId, `${CMD.TRACK}${num}${CMD.SEARCH}`);
}

export function cmdPlayTrack(playerId, trackNumber) {
  const num = String(trackNumber).padStart(2, '0');
  return buildCommand(playerId, `${CMD.START}${CMD.TRACK}${num}${CMD.SEARCH}${CMD.PLAY}`);
}

export function cmdScanForward(playerId) {
  return buildCommand(playerId, CMD.SCAN_FORWARD);
}

export function cmdScanReverse(playerId) {
  return buildCommand(playerId, CMD.SCAN_REVERSE);
}

export function cmdVolume(playerId, value) {
  const v = Math.max(0, Math.min(255, Math.round(value)));
  return buildCommand(playerId, `${v}${CMD.VOLUME}`);
}

export function cmdSpeed(playerId, percent) {
  const s = Math.max(90, Math.min(110, Math.round(percent)));
  return buildCommand(playerId, `${s}${CMD.SPEED}`);
}

export function cmdFade(playerId, targetVolume, durationSecs) {
  const v = Math.max(0, Math.min(255, Math.round(targetVolume)));
  const d = Math.max(1, Math.min(99, Math.round(durationSecs)));
  return buildCommand(playerId, `${d}${CMD.DURATION}${v}${CMD.FADE}`);
}

export function cmdClear(playerId) {
  return buildCommand(playerId, CMD.CLEAR);
}

export function cmdStopMarkerTrack(playerId, trackNumber) {
  const num = String(trackNumber).padStart(2, '0');
  return buildCommand(playerId, `${CMD.TRACK}${num}${CMD.STOP_MARKER}`);
}

export function cmdStopMarkerLeadOut(playerId) {
  return buildCommand(playerId, `${CMD.LEAD_OUT}${CMD.STOP_MARKER}`);
}

export function cmdAutoCueSearch(playerId, trackNumber) {
  const num = String(trackNumber).padStart(2, '0');
  return buildCommand(playerId, `${CMD.TRACK}${num}${CMD.AUTO_CUE_SEARCH}`);
}

export function cmdAutoCueStop(playerId, level) {
  const v = Math.max(0, Math.min(255, Math.round(level)));
  return buildCommand(playerId, `${v}${CMD.AUTO_CUE_STOP}`);
}

export function cmdCueLevel(playerId, level) {
  const v = Math.max(0, Math.min(255, Math.round(level)));
  return buildCommand(playerId, `${v}${CMD.CUE_LEVEL}`);
}

export function cmdLimitTime(playerId, hundredMs) {
  const v = Math.max(1, Math.min(99, Math.round(hundredMs)));
  return buildCommand(playerId, `${v}${CMD.LIMIT_TIME}`);
}

export function cmdChangerReset(playerId) {
  return buildCommand(playerId, CMD.CHANGER_RESET);
}

// Build query command
export function buildQuery(playerId, queryCmd) {
  return `${playerId}PS${queryCmd}${SERIAL_CONFIG.terminator}`;
}

// Parse response from the changer
export function parseResponse(raw) {
  const cleaned = raw.trim();

  // Error response
  if (/^E\d{2}$/.test(cleaned)) {
    return { type: 'error', code: cleaned, message: ERRORS[cleaned] || 'Unbekannter Fehler' };
  }

  // Job status
  if (cleaned === 'R') return { type: 'job', status: 'complete' };
  if (cleaned === 'B') return { type: 'job', status: 'busy' };

  // Player mode
  const modeMatch = cleaned.match(/^(\d+)PS(P[0-9A-F]{2})$/i);
  if (modeMatch) {
    const mode = PLAYER_MODES[modeMatch[2].toUpperCase()];
    return { type: 'mode', playerId: parseInt(modeMatch[1]), raw: modeMatch[2], ...(mode || { id: 'unknown', label: modeMatch[2] }) };
  }

  // Generic response with player prefix
  const prefixMatch = cleaned.match(/^(\d+)PS(.+)$/);
  if (prefixMatch) {
    const playerId = parseInt(prefixMatch[1]);
    const data = prefixMatch[2];

    // Disc number
    if (data === 'XXX') return { type: 'disc', playerId, disc: null };
    if (/^\d{3}$/.test(data)) return { type: 'disc', playerId, disc: parseInt(data) };

    // Track number
    if (data === 'XX') return { type: 'track', playerId, track: null };
    if (/^\d{2}$/.test(data)) return { type: 'track', playerId, track: parseInt(data) };

    // Time code (MMSS)
    if (/^\d{4}$/.test(data)) return { type: 'time', playerId, minutes: parseInt(data.slice(0, 2)), seconds: parseInt(data.slice(2, 4)) };

    // Block number
    if (/^\d{6}$/.test(data)) return { type: 'block', playerId, block: data };

    // TOC info (10 digits: first 2 = first track, next 2 = last track, last 6 = leadout)
    if (/^\d{10}$/.test(data)) {
      return {
        type: 'toc', playerId,
        firstTrack: parseInt(data.slice(0, 2)),
        lastTrack: parseInt(data.slice(2, 4)),
        leadOutMin: parseInt(data.slice(4, 6)),
        leadOutSec: parseInt(data.slice(6, 8)),
        leadOutFrames: parseInt(data.slice(8, 10)),
      };
    }

    // TOC track info (8 digits: 6 = absolute time + 2 = type)
    if (/^\d{8}$/.test(data)) {
      return {
        type: 'toc_track', playerId,
        min: parseInt(data.slice(0, 2)),
        sec: parseInt(data.slice(2, 4)),
        frames: parseInt(data.slice(4, 6)),
        trackType: data.slice(6, 8) === '00' ? 'audio' : 'data',
      };
    }

    // Player mode (without prefix handled above)
    if (/^P[0-9A-F]{2}$/i.test(data)) {
      const mode = PLAYER_MODES[data.toUpperCase()];
      return { type: 'mode', playerId, raw: data, ...(mode || { id: 'unknown', label: data }) };
    }

    // Model name
    if (/^P.{6}$/.test(data)) return { type: 'model', playerId, model: data };

    // Communication mode
    if (/^CM\d$/.test(data)) return { type: 'commMode', playerId, mode: parseInt(data[2]) };

    // Play time (10 digits)
    if (/^.{10}$/.test(data) && /\d/.test(data)) {
      return { type: 'playTime', playerId, raw: data };
    }

    // Disc status (8 chars)
    if (/^[01X]{8}$/i.test(data)) {
      return {
        type: 'discStatus', playerId,
        discSet: data[0] === '1',
        audioTrack: data[1] === '1',
        dataTrack: data[2] === '1',
        raw: data,
      };
    }

    return { type: 'data', playerId, raw: data };
  }

  // Receive completion
  if (cleaned === 'R') return { type: 'ack' };

  return { type: 'unknown', raw: cleaned };
}
