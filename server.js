import express from 'express';
import { createServer } from 'http';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, getAllSettings } from './src/database.js';
import { SerialConnection } from './src/serial.js';
import { PlayerManager } from './src/player.js';
import { CDScanner } from './src/scanner.js';
import { WebSocketManager } from './src/websocket.js';
import { createRoutes } from './src/routes.js';
import { initGpio, cleanupGpio } from './src/gpio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Initialize database
console.log('[Server] Initializing database...');
initDatabase();
const settings = getAllSettings();

// Initialize serial connection
const serial = new SerialConnection({
  path: settings.serial_port || '/dev/ttyUSB0',
  baudRate: parseInt(settings.baud_rate) || 9600,
});

// Initialize player manager
const playerManager = new PlayerManager(serial);

// Initialize CD scanner
const scanner = new CDScanner(serial, {
  playerId: parseInt(settings.player1_id) || 1,
  playerManager,
});

// Setup Express
const app = express();
const server = createServer(app);

app.use(express.json({ limit: '10mb' }));
app.use(express.static(join(__dirname, 'public')));

// API routes
app.use(createRoutes(playerManager, scanner, serial));

// SPA fallback
app.get('{*path}', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// Setup WebSocket
const wsManager = new WebSocketManager(server, playerManager, scanner);

// Connect serial and start polling
async function start() {
  const port = parseInt(settings.web_port) || 3000;

  await initGpio();

  server.listen(port, '0.0.0.0', () => {
    console.log(`[Server] CAC Controller running on http://0.0.0.0:${port}`);
    console.log(`[Server] Model: ${settings.model}`);
    console.log(`[Server] Serial: ${settings.serial_port} @ ${settings.baud_rate} baud`);
  });

  // Register error handler before connecting to prevent unhandled errors
  serial.on('error', (err) => {
    wsManager.broadcast({ type: 'serialError', data: { message: err.message } });
  });

  try {
    await serial.connect();
    playerManager.startPolling();
  } catch (err) {
    console.warn(`[Server] Serial connection failed: ${err.message}`);
    console.warn('[Server] Running without serial connection. Configure in settings.');
  }

  serial.on('connected', () => {
    console.log('[Server] Serial port connected');
    playerManager.startPolling();
    wsManager.broadcast({ type: 'serialConnected' });
  });

  serial.on('disconnected', () => {
    console.log('[Server] Serial port disconnected');
    playerManager.stopPolling();
    wsManager.broadcast({ type: 'serialDisconnected' });
  });

  serial.on('response', ({ raw, parsed }) => {
    wsManager.broadcast({ type: 'serialResponse', data: { raw, parsed } });
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  playerManager.stopPolling();
  cleanupGpio();
  serial.disconnect();
  process.exit(0);
});

process.on('SIGTERM', () => {
  playerManager.stopPolling();
  cleanupGpio();
  serial.disconnect();
  process.exit(0);
});

start();
