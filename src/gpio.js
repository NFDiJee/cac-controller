import { getSetting } from './database.js';

let Gpio = null;
let relay = null;
let currentPin = null;

async function loadGpioLib() {
  if (Gpio !== null) return;
  try {
    const mod = await import('onoff');
    Gpio = mod.Gpio;
  } catch {
    Gpio = false;
    console.warn('[GPIO] onoff module not available — GPIO disabled');
  }
}

function getConfiguredPin() {
  const pin = getSetting('gpio_relay_pin');
  if (!pin || pin === '' || pin === '0') return null;
  return parseInt(pin);
}

export async function initGpio() {
  await loadGpioLib();
  const pin = getConfiguredPin();
  if (!pin || !Gpio) return;
  try {
    relay = new Gpio(pin, 'out');
    currentPin = pin;
    console.log(`[GPIO] Relay initialized on GPIO${pin}`);
  } catch (err) {
    console.warn(`[GPIO] Failed to initialize GPIO${pin}: ${err.message}`);
    relay = null;
    currentPin = null;
  }
}

function ensureRelay() {
  const pin = getConfiguredPin();
  if (!pin) throw new Error('GPIO pin not configured');
  if (!Gpio) throw new Error('GPIO not available (onoff module missing)');
  if (pin !== currentPin || !relay) {
    if (relay) { try { relay.unexport(); } catch {} }
    relay = new Gpio(pin, 'out');
    currentPin = pin;
  }
  return relay;
}

export function powerOn() {
  const r = ensureRelay();
  r.writeSync(1);
  console.log('[GPIO] Relay ON');
}

export function powerOff() {
  const r = ensureRelay();
  r.writeSync(0);
  console.log('[GPIO] Relay OFF');
}

export function getPowerStatus() {
  const pin = getConfiguredPin();
  if (!pin || !Gpio || !relay) return { configured: !!pin, on: false };
  try {
    return { configured: true, on: relay.readSync() === 1 };
  } catch {
    return { configured: true, on: false };
  }
}

export function cleanupGpio() {
  if (relay) {
    try { relay.unexport(); } catch {}
    relay = null;
    currentPin = null;
  }
}
