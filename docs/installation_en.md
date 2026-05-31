# CAC Controller - Installation Guide

Detailed step-by-step guide for installing the CAC Controller on a Raspberry Pi. The controller operates a Pioneer CAC CD autochanger (V3000, V3200, V5000, or V180M) via a serial RS-232C connection.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [Preparing the Raspberry Pi](#3-preparing-the-raspberry-pi)
4. [Installing Node.js](#4-installing-nodejs)
5. [Installing Build Tools](#5-installing-build-tools)
6. [Setting Up the Serial Port](#6-setting-up-the-serial-port)
7. [Installing the CAC Controller](#7-installing-the-cac-controller)
8. [First Start and Testing](#8-first-start-and-testing)
9. [Setting Up the Systemd Service](#9-setting-up-the-systemd-service)
10. [Configuring Settings](#10-configuring-settings)
11. [Configuring Hub Connection](#11-configuring-hub-connection)
12. [Building the CD Database](#12-building-the-cd-database)
13. [Installing PWA on Smartphone](#13-installing-pwa-on-smartphone)
14. [Updates](#14-updates)
15. [Troubleshooting](#15-troubleshooting)
16. [Uninstallation](#16-uninstallation)

---

## 1. Overview

### What is the CAC Controller?

The CAC Controller is a Node.js web application that runs on a Raspberry Pi and controls a Pioneer CAC CD autochanger via the serial interface (RS-232C). It provides:

- **Web Interface** — Responsive dark-theme UI for browsers and smartphones
- **Dual Player Control** — Control both players of the changer simultaneously
- **CD Library** — Catalog all CDs with covers, artist info, and track lists
- **MusicBrainz Integration** — Automatic metadata lookup
- **Scanner** — Automatically read and catalog CDs
- **Playlists** — Create custom playback lists with drag-and-drop reordering
- **Statistics** — Top tracks, top CDs, top artists, genre distribution, and activity charts
- **Backup / Restore** — Full database export and import as JSON; separate ZIP export/import for cover images
- **PWA** — Installable as an app on smartphones

### Supported Pioneer Models

| Model | Slots | Baud Rate | Notes |
|-------|-------|-----------|-------|
| CAC-V3000 | 300 | 9600 | Standard reference model |
| CAC-V3200 | 300 | 9600 | Same as V3000 |
| CAC-V5000 | 500 | 9600 | 500-disc magazine |
| CAC-V180M | 18 | 4800 | Compact changer, different baud rate |

### System Architecture

```
┌────────────────┐     ┌─────────────────┐     ┌──────────────────┐
│  Smartphone /  │     │  Raspberry Pi   │     │  Pioneer CAC     │
│  Tablet / PC   │────>│  CAC Controller │────>│  CD Changer      │
│  (Browser)     │ HTTP│  (Node.js)      │ RS- │  (V3000/V5000/   │
│                │<────│  Port 3000      │ 232C│   V180M)         │
└────────────────┘ WS  └─────────────────┘     └──────────────────┘
```

---

## 2. Prerequisites

### Hardware

- **Raspberry Pi** — Recommended: Pi 3B+, Pi 4, Pi 5, or Zero 2 W
  - Pi Zero (first generation) works but is significantly slower during installation
  - Minimum 512 MB RAM
- **MicroSD Card** — Minimum 8 GB, recommended 16 GB or more
- **Power Supply** — Appropriate USB power supply for your Pi model
- **USB-to-Serial Adapter** — USB-A to RS-232C (DB9 or DB25)
  - Chipsets: FTDI FT232R, Prolific PL2303, or CH340 (all Linux-compatible)
  - Will be recognized as `/dev/ttyUSB0`
- **Serial Cable** — RS-232C cable to the Pioneer changer
  - 15-pin D-Sub connector (Pioneer side)
  - 9-pin D-Sub connector (adapter side) or 25-pin depending on adapter
  - Pinout: TX (Pin 2), RX (Pin 3), GND (Pin 5) — crossed (null modem)
- **Network Connection** — WiFi or Ethernet
- **Pioneer CAC Changer** — Powered on and operational

### Software

- **Raspberry Pi OS** — Lite or Desktop (Debian Bookworm or newer recommended)
- **SSH Access** — Enabled (in Raspberry Pi Imager under settings)
- **Internet Access** — For installing packages

### Network

- The Raspberry Pi must be on the same network as the control device (smartphone/PC)
- Recommended: Static IP address for the Pi (see Section 3)
- Default port: 3000 (configurable)

---

## 3. Preparing the Raspberry Pi

### 3.1 Installing the Operating System

1. Download **Raspberry Pi Imager**: https://www.raspberrypi.com/software/
2. Flash Raspberry Pi OS Lite (64-bit) to the MicroSD card
3. In the Imager under **Settings** (gear icon):
   - Set hostname (e.g., `cac-livingroom`)
   - Enable SSH
   - Set username and password (default: `pi`)
   - Configure WiFi (SSID and password)
   - Set locale/timezone

### 3.2 Connect via SSH

```bash
ssh pi@<IP_ADDRESS>
```

If the IP is unknown:
```bash
# From your local machine (right after first boot):
ping cac-livingroom.local
# or check your router's DHCP lease list
```

### 3.3 Update the System

```bash
sudo apt update && sudo apt upgrade -y
```

### 3.4 Configure Static IP Address (Recommended)

For Raspberry Pi OS Bookworm (NetworkManager):

```bash
# Show current connection:
nmcli connection show

# Set static IP (example for WiFi):
sudo nmcli connection modify "preconfigured" \
  ipv4.method manual \
  ipv4.addresses "192.168.1.100/24" \
  ipv4.gateway "192.168.1.1" \
  ipv4.dns "192.168.1.1"

# Restart connection:
sudo nmcli connection down "preconfigured"
sudo nmcli connection up "preconfigured"
```

**Note:** Replace the connection name (`preconfigured`) with your actual name (see `nmcli connection show`).

### 3.5 Disable WiFi Power Saving (Recommended)

Power saving mode can cause delays and connection drops:

```bash
# Check current status:
iw wlan0 get power_save

# Disable:
sudo iw wlan0 set power_save off
```

Make it permanent:
```bash
sudo tee /etc/NetworkManager/conf.d/wifi-powersave.conf > /dev/null << 'EOF'
[connection]
wifi.powersave = 2
EOF
sudo systemctl restart NetworkManager
```

---

## 4. Installing Node.js

### 4.1 Install Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 4.2 Verify Installation

```bash
node --version
# Expected output: v20.x.x (minimum v18.x)

npm --version
# Expected output: 10.x.x
```

### 4.3 Alternative: Node.js via nvm

If the NodeSource method causes issues:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
```

---

## 5. Installing Build Tools

The native SQLite extension (`better-sqlite3`) needs to be compiled:

```bash
sudo apt install -y build-essential python3
```

On a fresh Raspberry Pi OS, these packages are usually already present. This command ensures all required compilers and headers are installed.

---

## 6. Setting Up the Serial Port

### 6.1 Add User to dialout Group

So the CAC Controller can access the serial port:

```bash
sudo usermod -a -G dialout pi
```

**Important:** Log out and back in for the group change to take effect:

```bash
# Either re-login:
exit
ssh pi@<IP_ADDRESS>

# Or just update the group:
newgrp dialout
```

Verify group membership:
```bash
groups
# Should include "dialout"
```

### 6.2 Connect and Check USB-Serial Adapter

1. Plug the USB-serial adapter into the Raspberry Pi
2. Check if it is recognized:

```bash
# List USB devices:
lsusb
# Should show the adapter, e.g.:
# Bus 001 Device 003: ID 0403:6001 Future Technology Devices International, Ltd FT232 Serial (UART) IC

# Check serial port:
ls -la /dev/ttyUSB*
# Expected output: /dev/ttyUSB0

# If not found, check kernel log:
dmesg | grep -i tty
```

### 6.3 Connect the Serial Cable

1. Connect the USB-serial adapter to the serial cable
2. Plug the serial cable into the **RS-232C** port on the Pioneer changer
3. Power on the Pioneer changer

### 6.4 Test Serial Connection (Optional)

Manually verify that communication works:

```bash
# Configure port (example for V3000 at 9600 baud):
stty -F /dev/ttyUSB0 9600 cs8 -cstopb -parenb

# Query status (sends "Player 1 Status" command):
echo -ne "1PS?X\r" > /dev/ttyUSB0

# Read response (wait 3 seconds):
timeout 3 cat /dev/ttyUSB0
# Should return a response like "1PS..."
```

---

## 7. Installing the CAC Controller

### Option A: From GitHub (Recommended)

```bash
cd /opt
sudo git clone https://github.com/NFDiJee/cac-controller.git
sudo chown -R pi:pi /opt/cac-controller
cd /opt/cac-controller
npm install
```

The `npm install` process takes several minutes on a Raspberry Pi (up to 10-15 minutes on a Pi Zero), as `better-sqlite3` is compiled natively.

### Option B: Manual Copy

If Git is not available or preferred:

```bash
# On your local machine:
scp -r ./cac-controller/* pi@<PI_IP>:/opt/cac-controller/

# On the Raspberry Pi:
cd /opt/cac-controller
npm install
```

### Verify Installation

```bash
ls -la /opt/cac-controller/
# Should contain: server.js, package.json, src/, public/, ...

ls -la /opt/cac-controller/node_modules/
# Should show installed packages
```

---

## 8. First Start and Testing

### 8.1 Start the Server Manually

```bash
cd /opt/cac-controller
node server.js
```

Expected output:
```
[Server] Initializing database...
[Server] CAC Controller running on http://0.0.0.0:3000
[Server] Model: CAC-V3000
[Server] Serial: /dev/ttyUSB0 @ 9600 baud
```

### 8.2 Open in Browser

On your smartphone/PC, open in the browser:

```
http://<PI_IP>:3000
```

Example: `http://192.168.1.100:3000`

You should see the CAC Controller dashboard with:
- Player cards for Player 1 and Player 2
- Transport controls (Play, Stop, Pause, Next, Previous)
- Navigation (Library, Scanner, Playlists, Settings)

### 8.3 Test First Connection

1. Press **Play** in the browser
2. The changer should load a CD and start playing
3. The player card should update with status (disc, track, time)

### 8.4 Stop the Server

Press `Ctrl+C` in the terminal to stop the server.

---

## 9. Setting Up the Systemd Service

A systemd service ensures the CAC Controller starts automatically on boot and restarts on crashes.

### 9.1 Copy Service File

```bash
sudo cp /opt/cac-controller/cac-controller.service /etc/systemd/system/
```

### 9.2 Adjust Service File (If Needed)

If your user is not `pi`:

```bash
sudo nano /etc/systemd/system/cac-controller.service
```

Contents of the service file:
```ini
[Unit]
Description=CAC Controller - Pioneer CD Autochanger Controller
After=network.target

[Service]
Type=simple
User=pi
Group=pi
WorkingDirectory=/opt/cac-controller
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Change `User=` and `Group=` to the correct user.

### 9.3 Enable and Start the Service

```bash
# Reload systemd configuration:
sudo systemctl daemon-reload

# Enable service on boot:
sudo systemctl enable cac-controller

# Start service now:
sudo systemctl start cac-controller
```

### 9.4 Check Status

```bash
sudo systemctl status cac-controller
```

Expected output:
```
● cac-controller.service - CAC Controller - Pioneer CD Autochanger Controller
     Loaded: loaded (/etc/systemd/system/cac-controller.service; enabled)
     Active: active (running) since ...
```

### 9.5 View Logs

```bash
# Follow current logs live:
sudo journalctl -u cac-controller -f

# Last 50 lines:
sudo journalctl -u cac-controller --no-pager -n 50
```

### 9.6 Test Autostart

```bash
sudo reboot
```

After reboot (approx. 30-60 seconds), `http://<PI_IP>:3000` should be accessible again.

---

## 10. Configuring Settings

In the browser under **More > Settings** (gear icon), the following settings can be adjusted:

### 10.1 Serial Port

| Setting | Default | Description |
|---------|---------|-------------|
| Port | `/dev/ttyUSB0` | Serial port of the USB adapter |
| Baud Rate | `9600` | `9600` for V3000/V3200/V5000, `4800` for V180M |

### 10.2 Device Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Model | `CAC-V3000` | Select Pioneer model |
| Max Discs | `300` | Number of slots: 300 (V3000/V3200), 500 (V5000), 18 (V180M) |

### 10.3 Network

| Setting | Default | Description |
|---------|---------|-------------|
| Port | `3000` | HTTP server port |
| Language | `auto` | Automatic, German, or English |

### 10.4 Statistics

| Setting | Default | Description |
|---------|---------|-------------|
| Stats Min Seconds | `30` | Minimum play duration in seconds for a track to count in statistics |

### 10.5 Apply Changes

After changes to port or serial settings, restart the service:

```bash
sudo systemctl restart cac-controller
```

---

## 11. Configuring Hub Connection

If a [CAC Hub](https://github.com/NFDiJee/cac-controller-hub) is being used, the node must have an API key.

### 11.1 Generate API Key

1. In the browser under **Settings**, open the **Hub / Network** section
2. Enter a **Node Name** (e.g., "Living Room")
3. Enter a **Room** (e.g., "Ground Floor")
4. Click **Generate API Key** — creates a random 32-character key
5. Click **Save**

### 11.2 Note the API Key

Copy the generated API key — it will be needed later when adding the node in the Hub.

### 11.3 Test Connection

From the Hub Pi or another machine on the network:

```bash
curl -H "X-API-Key: YOUR_API_KEY" http://<NODE_IP>:3000/api/node/info
```

Expected response:
```json
{
  "name": "Living Room",
  "room": "Ground Floor",
  "model": "CAC-V3000",
  "version": "1.0.0"
}
```

---

## 12. Building the CD Database

After installation, the CD library is empty. There are three ways to populate it:

### 12.1 Automatic CD Scanning

The scanner has the changer load each CD, read the TOC (Table of Contents), and return the CD:

1. In the browser under **Scanner > Scan Range**
2. Enter **Start Slot** (e.g., `1`)
3. Enter **End Slot** (e.g., `300`)
4. Click **Start Scan**

**Duration:** Approx. 30-60 seconds per CD (load + read TOC + return). A full scan of 300 slots takes about 3-5 hours.

**Note:** The scan can be paused at any time and resumed later. Already scanned CDs are preserved.

### 12.2 MusicBrainz Search

For individual CDs, metadata can be searched automatically:

1. In the browser under **Scanner > MusicBrainz Search**
2. Search by **album** or **artist**
3. Select a result
4. Apply to a slot

### 12.3 JSON Import

If a database from a previous installation exists:

1. In the browser under **Scanner > JSON Import**
2. Select a `cds.json` file
3. Click **Import**

---

## 13. Installing PWA on Smartphone

The CAC Controller can be installed as a Progressive Web App (PWA) on your smartphone:

### iOS (Safari)

1. Open `http://<PI_IP>:3000` in Safari
2. Tap the **Share** icon (square with arrow)
3. Select **Add to Home Screen**
4. Enter a name and tap **Add**

### Android (Chrome)

1. Open `http://<PI_IP>:3000` in Chrome
2. Tap the **three-dot menu**
3. Select **Add to Home Screen**
4. Tap **Add**

The app then runs in full-screen mode like a native app.

---

## 14. Updates

### From GitHub Repository

```bash
cd /opt/cac-controller
git pull
npm install
sudo systemctl restart cac-controller
```

### Manual Update

1. Copy new files to the Pi (via SCP or USB)
2. Run `npm install` (if dependencies changed)
3. Restart service: `sudo systemctl restart cac-controller`

---

## 15. Troubleshooting

### 15.1 Service Does Not Start

```bash
# Check logs:
sudo journalctl -u cac-controller --no-pager -n 50

# Service status:
sudo systemctl status cac-controller

# Start manually for detailed error output:
cd /opt/cac-controller && node server.js
```

### 15.2 Serial Port Not Found

```bash
# List all USB devices:
lsusb

# List serial ports:
ls -la /dev/ttyUSB* /dev/ttyACM* 2>/dev/null

# Check kernel log:
dmesg | grep -i tty

# Is user in dialout group?
groups
```

**Solution:** Unplug the adapter, wait 5 seconds, plug it back in. If `/dev/ttyUSB1` appears instead of `ttyUSB0`: change the port in settings.

### 15.3 No Connection to Changer

```bash
# Manually test serial connection:
stty -F /dev/ttyUSB0 9600 cs8 -cstopb -parenb
echo -ne "1PS?X\r" > /dev/ttyUSB0
timeout 3 cat /dev/ttyUSB0
```

**Possible causes:**
- Wrong cable (not a null modem cable)
- Wrong baud rate (4800 instead of 9600 or vice versa)
- Changer powered off or in standby
- TX/RX swapped

### 15.4 Port 3000 in Use

```bash
# Find process on port 3000:
sudo lsof -i :3000

# If an old process is running, stop the service:
sudo systemctl stop cac-controller
```

Alternatively: choose a different port in settings (e.g., 8080).

### 15.5 npm install Fails

```bash
# Check build tools:
gcc --version
python3 --version

# If not installed:
sudo apt install -y build-essential python3

# Delete node_modules and reinstall:
rm -rf node_modules package-lock.json
npm install
```

### 15.6 WiFi Disconnects

```bash
# Check power saving mode:
iw wlan0 get power_save

# Disable (see Section 3.5)
sudo iw wlan0 set power_save off
```

### 15.7 Raspberry Pi Zero: Slow Installation

On a Pi Zero (first generation), `npm install` can take up to 15 minutes. Alternatives:

1. **Cross-compilation:** Compile on a more powerful machine and transfer `node_modules/` via SCP
2. **Increase swap:**
```bash
sudo dphys-swapfile swapoff
sudo nano /etc/dphys-swapfile
# CONF_SWAPSIZE=1024
sudo dphys-swapfile setup
sudo dphys-swapfile swapon
```

---

## 16. Uninstallation

### Remove Service

```bash
sudo systemctl stop cac-controller
sudo systemctl disable cac-controller
sudo rm /etc/systemd/system/cac-controller.service
sudo systemctl daemon-reload
```

### Delete Files

```bash
sudo rm -rf /opt/cac-controller
```

### Remove Node.js (Optional)

```bash
sudo apt purge -y nodejs
sudo rm -rf /usr/lib/node_modules
```

---

*CAC Controller v1.0.0 — Copyright (c) 2025 Dirk Jensen*
*MIT License*
