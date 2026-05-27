import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { EventEmitter } from 'events';
import { SERIAL_CONFIG, parseResponse } from './protocol.js';

export class SerialConnection extends EventEmitter {
  constructor(options = {}) {
    super();
    this.path = options.path || '/dev/ttyUSB0';
    this.baudRate = parseInt(options.baudRate) || 9600;
    this.port = null;
    this.parser = null;
    this.connected = false;

    // Per-player command queues (fire-and-forget, like the old project)
    this.queues = { 1: [], 2: [] };
    this.commandDelay = options.commandDelay || 200;
  }

  async connect() {
    if (this.port && this.port.isOpen) return;

    return new Promise((resolve, reject) => {
      this.port = new SerialPort({
        path: this.path,
        baudRate: this.baudRate,
        dataBits: SERIAL_CONFIG.dataBits,
        stopBits: SERIAL_CONFIG.stopBits,
        parity: SERIAL_CONFIG.parity,
        autoOpen: false,
      });

      // ReadlineParser handles buffering and line splitting
      this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\r' }));

      // All responses handled here - completely decoupled from commands
      this.parser.on('data', (line) => {
        const cleaned = line.trim();
        if (cleaned.length === 0) return;

        const parsed = parseResponse(cleaned);
        this.emit('response', { raw: cleaned, parsed });

        // Extract player ID and emit typed events
        const match = /^([12])PS/.exec(cleaned);
        if (match) {
          const playerId = parseInt(match[1]);
          this.emit('playerResponse', { playerId, raw: cleaned, parsed });
        }
      });

      this.port.on('error', (err) => {
        console.error('[Serial] Error:', err.message);
        if (this.listenerCount('error') > 0) {
          this.emit('error', err);
        }
      });

      this.port.on('close', () => {
        this.connected = false;
        console.log('[Serial] Port closed');
        this.emit('disconnected');
        this._scheduleReconnect();
      });

      this.port.open((err) => {
        if (err) {
          console.error('[Serial] Open failed:', err.message);
          this.emit('error', err);
          this._scheduleReconnect();
          reject(err);
          return;
        }
        this.connected = true;
        console.log(`[Serial] Connected: ${this.path} @ ${this.baudRate} baud`);
        this.emit('connected');
        resolve();
      });
    });
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      console.log('[Serial] Attempting reconnect...');
      try {
        await this.connect();
      } catch {
        // Will schedule another reconnect via close event
      }
    }, 5000);
  }

  disconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.port && this.port.isOpen) {
      this.port.close();
    }
  }

  // Fire-and-forget: queue command for a player
  send(playerId, command) {
    const pid = parseInt(playerId) || 1;
    const full = `${pid}PS${command}`;
    this.queues[pid].push(full);

    // Start processing if this is the only item
    if (this.queues[pid].length === 1) {
      this._processQueue(pid);
    }
  }

  _processQueue(playerId) {
    if (!this.queues[playerId].length) return;
    if (!this.port || !this.port.isOpen) {
      this.queues[playerId] = [];
      return;
    }

    const cmd = this.queues[playerId].shift();
    this.port.write(cmd + '\r', (err) => {
      if (err) console.error(`[Serial] Write error: ${err.message}`);
    });

    // Process next command after delay
    if (this.queues[playerId].length > 0) {
      setTimeout(() => this._processQueue(playerId), this.commandDelay);
    }
  }

  // Send with priority (inserted at front of queue)
  sendPriority(playerId, command) {
    const pid = parseInt(playerId) || 1;
    const full = `${pid}PS${command}`;
    this.queues[pid].unshift(full);

    if (this.queues[pid].length === 1) {
      this._processQueue(pid);
    }
  }

  get isConnected() {
    return this.connected && this.port && this.port.isOpen;
  }

  static async listPorts() {
    return SerialPort.list();
  }
}
