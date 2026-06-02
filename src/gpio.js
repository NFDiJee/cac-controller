import { execSync } from 'child_process';
import { getSetting } from './database.js';

let initialized = false;
let available = false;

function getConfiguredPin() {
  const pin = getSetting('gpio_relay_pin');
  if (!pin || pin === '' || pin === '0') return null;
  return parseInt(pin);
}

export async function initGpio() {
  const pin = getConfiguredPin();
  if (!pin) return;
  try {
    // Read current pin state before setting as output (to preserve relay state across restarts)
    let wasHigh = false;
    try {
      const out = execSync(`pinctrl get ${pin}`, { encoding: 'utf-8' });
      wasHigh = out.includes('hi');
    } catch { /* pin may not be readable yet */ }

    execSync(`pinctrl set ${pin} op`, { stdio: 'ignore' });

    // Restore previous state (pinctrl set op resets to LOW)
    if (wasHigh) {
      execSync(`pinctrl set ${pin} dh`, { stdio: 'ignore' });
    }

    available = true;
    initialized = true;
    console.log(`[GPIO] Relay initialized on GPIO${pin} (pinctrl), state: ${wasHigh ? 'ON' : 'OFF'}`);
  } catch (err) {
    console.warn(`[GPIO] pinctrl not available: ${err.message}`);
    available = false;
  }
}

export function powerOn() {
  const pin = getConfiguredPin();
  if (!pin) throw new Error('GPIO pin not configured');
  if (!available) throw new Error('GPIO not available');
  execSync(`pinctrl set ${pin} dh`);
  console.log('[GPIO] Relay ON');
}

export function powerOff() {
  const pin = getConfiguredPin();
  if (!pin) throw new Error('GPIO pin not configured');
  if (!available) throw new Error('GPIO not available');
  execSync(`pinctrl set ${pin} dl`);
  console.log('[GPIO] Relay OFF');
}

export function getPowerStatus() {
  const pin = getConfiguredPin();
  if (!pin || !available) return { configured: !!pin, on: false };
  try {
    const out = execSync(`pinctrl get ${pin}`, { encoding: 'utf-8' });
    const isHigh = out.includes('hi');
    return { configured: true, on: isHigh };
  } catch {
    return { configured: !!pin, on: false };
  }
}

export function cleanupGpio() {
  // Do NOT turn off the relay on shutdown/restart — preserve power state
  // The relay state persists at the hardware level
}
