# CAC Controller - Installationsanleitung

Detaillierte Schritt-fuer-Schritt-Anleitung zur Installation des CAC Controllers auf einem Raspberry Pi. Der Controller steuert einen Pioneer CAC CD-Automatenwechsler (V3000, V3200, V5000 oder V180M) ueber eine serielle RS-232C-Verbindung.

---

## Inhaltsverzeichnis

1. [Uebersicht](#1-uebersicht)
2. [Voraussetzungen](#2-voraussetzungen)
3. [Raspberry Pi vorbereiten](#3-raspberry-pi-vorbereiten)
4. [Node.js installieren](#4-nodejs-installieren)
5. [Build-Tools installieren](#5-build-tools-installieren)
6. [Seriellen Port einrichten](#6-seriellen-port-einrichten)
7. [CAC Controller installieren](#7-cac-controller-installieren)
8. [Erster Start und Test](#8-erster-start-und-test)
9. [Systemd-Service einrichten](#9-systemd-service-einrichten)
10. [Einstellungen konfigurieren](#10-einstellungen-konfigurieren)
11. [Hub-Anbindung konfigurieren](#11-hub-anbindung-konfigurieren)
12. [CD-Datenbank aufbauen](#12-cd-datenbank-aufbauen)
13. [PWA auf Smartphone installieren](#13-pwa-auf-smartphone-installieren)
14. [Updates](#14-updates)
15. [Fehlerbehebung](#15-fehlerbehebung)
16. [Deinstallation](#16-deinstallation)

---

## 1. Uebersicht

### Was ist der CAC Controller?

Der CAC Controller ist eine Node.js-Webanwendung, die auf einem Raspberry Pi laeuft und einen Pioneer CAC CD-Automatenwechsler ueber die serielle Schnittstelle (RS-232C) steuert. Er bietet:

- **Web-Oberflaeche** — Responsives Dark-Theme-UI fuer Browser und Smartphone
- **Zwei-Player-Steuerung** — Beide Player des Wechslers gleichzeitig steuern
- **CD-Bibliothek** — Alle CDs katalogisieren mit Covers, Kuenstler und Track-Listen
- **MusicBrainz-Integration** — Automatische Metadaten-Suche
- **Scanner** — CDs automatisch einlesen und katalogisieren
- **Playlists** — Eigene Wiedergabelisten erstellen mit Drag-and-Drop-Sortierung
- **Statistiken** — Top-Tracks, Top-CDs, Top-Kuenstler, Genre-Verteilung und Aktivitaets-Diagramme
- **Backup / Restore** — Vollstaendiger Datenbank-Export und -Import als JSON; separater ZIP-Export/Import fuer Cover-Bilder
- **PWA** — Als App auf dem Smartphone installierbar

### Unterstuetzte Pioneer-Modelle

| Modell | Slots | Baudrate | Besonderheiten |
|--------|-------|----------|----------------|
| CAC-V3000 | 300 | 9600 | Standard-Referenzmodell |
| CAC-V3200 | 300 | 9600 | Wie V3000 |
| CAC-V5000 | 500 | 9600 | 500-Disc-Magazin |
| CAC-V180M | 18 | 4800 | Kompakt-Wechsler, andere Baudrate |

### Systemarchitektur

```
┌────────────────┐     ┌─────────────────┐     ┌──────────────────┐
│  Smartphone /  │     │  Raspberry Pi   │     │  Pioneer CAC     │
│  Tablet / PC   │────>│  CAC Controller │────>│  CD-Wechsler     │
│  (Browser)     │ HTTP│  (Node.js)      │ RS- │  (V3000/V5000/   │
│                │<────│  Port 3000      │ 232C│   V180M)         │
└────────────────┘ WS  └─────────────────┘     └──────────────────┘
```

---

## 2. Voraussetzungen

### Hardware

- **Raspberry Pi** — Empfohlen: Pi 3B+, Pi 4, Pi 5 oder Zero 2 W
  - Pi Zero (erste Generation) funktioniert, ist aber deutlich langsamer bei der Installation
  - Mindestens 512 MB RAM
- **MicroSD-Karte** — Mindestens 8 GB, empfohlen 16 GB oder mehr
- **Netzteil** — Passendes USB-Netzteil fuer das Pi-Modell
- **USB-zu-Seriell-Adapter** — USB-A auf RS-232C (DB9 oder DB25)
  - Chipsets: FTDI FT232R, Prolific PL2303 oder CH340 (alle Linux-kompatibel)
  - Wird als `/dev/ttyUSB0` erkannt
- **Serielles Kabel** — RS-232C-Kabel zum Pioneer-Wechsler
  - 15-poliger D-Sub-Stecker (Pioneer-Seite)
  - 9-poliger D-Sub-Stecker (Adapter-Seite) oder 25-polig je nach Adapter
  - Belegung: TX (Pin 2), RX (Pin 3), GND (Pin 5) — gekreuzt (Nullmodem)
- **Netzwerkverbindung** — WLAN oder Ethernet
- **Pioneer CAC Wechsler** — Eingeschaltet und betriebsbereit

### Software

- **Raspberry Pi OS** — Lite oder Desktop (Debian Bookworm oder neuer empfohlen)
- **SSH-Zugang** — Aktiviert (bei Raspberry Pi Imager unter Einstellungen)
- **Internetzugang** — Fuer die Installation von Paketen

### Netzwerk

- Der Raspberry Pi muss im selben Netzwerk wie das Steuerungsgeraet (Smartphone/PC) sein
- Empfohlen: Statische IP-Adresse fuer den Pi (siehe Abschnitt 3)
- Standard-Port: 3000 (konfigurierbar)

---

## 3. Raspberry Pi vorbereiten

### 3.1 Betriebssystem installieren

1. **Raspberry Pi Imager** herunterladen: https://www.raspberrypi.com/software/
2. Raspberry Pi OS Lite (64-bit) auf die MicroSD-Karte schreiben
3. Im Imager unter **Einstellungen** (Zahnrad-Symbol):
   - Hostname setzen (z.B. `cac-wohnzimmer`)
   - SSH aktivieren
   - Benutzername und Passwort setzen (Standard: `pi`)
   - WLAN konfigurieren (SSID und Passwort)
   - Locale/Zeitzone setzen

### 3.2 Per SSH verbinden

```bash
ssh pi@<IP_ADRESSE>
```

Falls die IP nicht bekannt ist:
```bash
# Vom lokalen Rechner aus (gleich nach dem ersten Boot):
ping cac-wohnzimmer.local
# oder im Router die DHCP-Lease-Liste pruefen
```

### 3.3 System aktualisieren

```bash
sudo apt update && sudo apt upgrade -y
```

### 3.4 Statische IP-Adresse konfigurieren (empfohlen)

Fuer Raspberry Pi OS Bookworm (NetworkManager):

```bash
# Aktuelle Verbindung anzeigen:
nmcli connection show

# Statische IP setzen (Beispiel fuer WLAN):
sudo nmcli connection modify "preconfigured" \
  ipv4.method manual \
  ipv4.addresses "192.168.1.100/24" \
  ipv4.gateway "192.168.1.1" \
  ipv4.dns "192.168.1.1"

# Verbindung neu starten:
sudo nmcli connection down "preconfigured"
sudo nmcli connection up "preconfigured"
```

**Hinweis:** Den Verbindungsnamen (`preconfigured`) durch den tatsaechlichen Namen ersetzen (siehe `nmcli connection show`).

### 3.5 WLAN-Stromsparmodus deaktivieren (empfohlen)

Der Stromsparmodus kann zu Verzoegerungen und Verbindungsabbruechen fuehren:

```bash
# Aktuellen Status pruefen:
iw wlan0 get power_save

# Deaktivieren:
sudo iw wlan0 set power_save off
```

Permanent deaktivieren:
```bash
sudo tee /etc/NetworkManager/conf.d/wifi-powersave.conf > /dev/null << 'EOF'
[connection]
wifi.powersave = 2
EOF
sudo systemctl restart NetworkManager
```

---

## 4. Node.js installieren

### 4.1 Node.js 20 LTS installieren

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 4.2 Installation pruefen

```bash
node --version
# Erwartete Ausgabe: v20.x.x (mindestens v18.x)

npm --version
# Erwartete Ausgabe: 10.x.x
```

### 4.3 Alternative: Node.js ueber nvm

Falls die NodeSource-Methode Probleme macht:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
```

---

## 5. Build-Tools installieren

Die native SQLite-Erweiterung (`better-sqlite3`) muss kompiliert werden:

```bash
sudo apt install -y build-essential python3
```

Auf einem frischen Raspberry Pi OS sind diese Pakete meist schon vorhanden. Der Befehl stellt sicher, dass alle benoetigten Compiler und Header installiert sind.

---

## 6. Seriellen Port einrichten

### 6.1 Benutzer zur dialout-Gruppe hinzufuegen

Damit der CAC Controller auf den seriellen Port zugreifen kann:

```bash
sudo usermod -a -G dialout pi
```

**Wichtig:** Abmelden und neu anmelden, damit die Gruppenänderung wirksam wird:

```bash
# Entweder neu anmelden:
exit
ssh pi@<IP_ADRESSE>

# Oder nur die Gruppe aktualisieren:
newgrp dialout
```

Gruppenmitgliedschaft pruefen:
```bash
groups
# Sollte "dialout" enthalten
```

### 6.2 USB-Seriell-Adapter anschliessen und pruefen

1. USB-Seriell-Adapter am Raspberry Pi einstecken
2. Pruefen, ob er erkannt wird:

```bash
# USB-Geraete anzeigen:
lsusb
# Sollte den Adapter zeigen, z.B.:
# Bus 001 Device 003: ID 0403:6001 Future Technology Devices International, Ltd FT232 Serial (UART) IC

# Seriellen Port pruefen:
ls -la /dev/ttyUSB*
# Erwartete Ausgabe: /dev/ttyUSB0

# Falls nicht gefunden, Kernel-Log pruefen:
dmesg | grep -i tty
```

### 6.3 Serielles Kabel anschliessen

1. Den USB-Seriell-Adapter mit dem seriellen Kabel verbinden
2. Das serielle Kabel am **RS-232C**-Anschluss des Pioneer-Wechslers einstecken
3. Den Pioneer-Wechsler einschalten

### 6.4 Serielle Verbindung testen (optional)

Manuelle Pruefung, ob die Kommunikation funktioniert:

```bash
# Port konfigurieren (Beispiel fuer V3000 mit 9600 Baud):
stty -F /dev/ttyUSB0 9600 cs8 -cstopb -parenb

# Status abfragen (sendet "Player 1 Status" Kommando):
echo -ne "1PS?X\r" > /dev/ttyUSB0

# Antwort lesen (3 Sekunden warten):
timeout 3 cat /dev/ttyUSB0
# Sollte eine Antwort wie "1PS..." zurueckgeben
```

---

## 7. CAC Controller installieren

### Option A: Von GitHub (empfohlen)

```bash
cd /opt
sudo git clone https://github.com/NFDiJee/cac-controller.git
sudo chown -R pi:pi /opt/cac-controller
cd /opt/cac-controller
npm install
```

Die Installation von `npm install` dauert auf einem Raspberry Pi einige Minuten (auf einem Pi Zero bis zu 10-15 Minuten), da `better-sqlite3` nativ kompiliert wird.

### Option B: Manuell kopieren

Falls kein Git verfuegbar oder gewuenscht:

```bash
# Auf dem lokalen Rechner:
scp -r ./cac-controller/* pi@<PI_IP>:/opt/cac-controller/

# Auf dem Raspberry Pi:
cd /opt/cac-controller
npm install
```

### Installation pruefen

```bash
ls -la /opt/cac-controller/
# Sollte enthalten: server.js, package.json, src/, public/, ...

ls -la /opt/cac-controller/node_modules/
# Sollte die installierten Pakete zeigen
```

---

## 8. Erster Start und Test

### 8.1 Server manuell starten

```bash
cd /opt/cac-controller
node server.js
```

Erwartete Ausgabe:
```
[Server] Initializing database...
[Server] CAC Controller running on http://0.0.0.0:3000
[Server] Model: CAC-V3000
[Server] Serial: /dev/ttyUSB0 @ 9600 baud
```

### 8.2 Im Browser oeffnen

Auf dem Smartphone/PC im Browser oeffnen:

```
http://<PI_IP>:3000
```

Beispiel: `http://192.168.1.100:3000`

Du solltest das CAC Controller Dashboard sehen mit:
- Player-Karten fuer Player 1 und Player 2
- Transport-Controls (Play, Stop, Pause, Next, Previous)
- Navigation (Bibliothek, Scanner, Playlists, Einstellungen)

### 8.3 Erste Verbindung testen

1. Im Browser auf **Play** druecken
2. Der Wechsler sollte eine CD laden und abspielen
3. Die Player-Karte sollte den Status aktualisieren (Disc, Track, Zeit)

### 8.4 Server stoppen

Im Terminal `Ctrl+C` druecken, um den Server zu beenden.

---

## 9. Systemd-Service einrichten

Ein systemd-Service stellt sicher, dass der CAC Controller automatisch beim Booten startet und bei Abstuerzen neu gestartet wird.

### 9.1 Service-Datei kopieren

```bash
sudo cp /opt/cac-controller/cac-controller.service /etc/systemd/system/
```

### 9.2 Service-Datei anpassen (falls noetig)

Falls der Benutzer nicht `pi` ist:

```bash
sudo nano /etc/systemd/system/cac-controller.service
```

Inhalt der Service-Datei:
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

`User=` und `Group=` auf den richtigen Benutzer aendern.

### 9.3 Service aktivieren und starten

```bash
# Systemd-Konfiguration neu laden:
sudo systemctl daemon-reload

# Service beim Booten aktivieren:
sudo systemctl enable cac-controller

# Service jetzt starten:
sudo systemctl start cac-controller
```

### 9.4 Status pruefen

```bash
sudo systemctl status cac-controller
```

Erwartete Ausgabe:
```
● cac-controller.service - CAC Controller - Pioneer CD Autochanger Controller
     Loaded: loaded (/etc/systemd/system/cac-controller.service; enabled)
     Active: active (running) since ...
```

### 9.5 Logs anzeigen

```bash
# Aktuelle Logs live verfolgen:
sudo journalctl -u cac-controller -f

# Letzte 50 Zeilen:
sudo journalctl -u cac-controller --no-pager -n 50
```

### 9.6 Autostart testen

```bash
sudo reboot
```

Nach dem Neustart (ca. 30-60 Sekunden) sollte `http://<PI_IP>:3000` wieder erreichbar sein.

---

## 10. Einstellungen konfigurieren

Im Browser unter **Mehr > Einstellungen** (Zahnrad-Symbol) koennen folgende Einstellungen angepasst werden:

### 10.1 Serieller Port

| Einstellung | Standard | Beschreibung |
|-------------|----------|--------------|
| Port | `/dev/ttyUSB0` | Serieller Port des USB-Adapters |
| Baudrate | `9600` | `9600` fuer V3000/V3200/V5000, `4800` fuer V180M |

### 10.2 Geraeteeinstellungen

| Einstellung | Standard | Beschreibung |
|-------------|----------|--------------|
| Modell | `CAC-V3000` | Pioneer-Modell auswaehlen |
| Max. Discs | `300` | Anzahl Slots: 300 (V3000/V3200), 500 (V5000), 18 (V180M) |

### 10.3 Netzwerk

| Einstellung | Standard | Beschreibung |
|-------------|----------|--------------|
| Port | `3000` | HTTP-Server-Port |
| Sprache | `auto` | Automatisch, Deutsch oder Englisch |

### 10.4 Statistik

| Einstellung | Standard | Beschreibung |
|-------------|----------|--------------|
| Statistik Min. Sekunden | `30` | Mindestspieldauer in Sekunden, damit ein Track in der Statistik gezaehlt wird |

### 10.5 Aenderungen uebernehmen

Nach Aenderungen an Port oder seriellen Einstellungen den Service neu starten:

```bash
sudo systemctl restart cac-controller
```

---

## 11. Hub-Anbindung konfigurieren

Falls ein [CAC Hub](https://github.com/NFDiJee/cac-controller-hub) eingesetzt wird, muss der Node einen API-Key haben.

### 11.1 API-Key generieren

1. Im Browser unter **Einstellungen** den Abschnitt **Hub / Netzwerk** oeffnen
2. **Node-Name** eingeben (z.B. "Wohnzimmer")
3. **Raum** eingeben (z.B. "Erdgeschoss")
4. **API-Key generieren** klicken — erzeugt einen zufaelligen 32-stelligen Key
5. **Speichern** klicken

### 11.2 API-Key notieren

Den generierten API-Key kopieren — er wird spaeter im Hub beim Hinzufuegen des Nodes benoetigt.

### 11.3 Verbindung testen

Vom Hub-Pi oder einem anderen Rechner im Netzwerk:

```bash
curl -H "X-API-Key: DEIN_API_KEY" http://<NODE_IP>:3000/api/node/info
```

Erwartete Antwort:
```json
{
  "name": "Wohnzimmer",
  "room": "Erdgeschoss",
  "model": "CAC-V3000",
  "version": "1.0.0"
}
```

---

## 12. CD-Datenbank aufbauen

Nach der Installation ist die CD-Bibliothek leer. Es gibt drei Wege, sie zu befuellen:

### 12.1 CDs automatisch scannen

Der Scanner laesst den Wechsler jede CD laden, die TOC (Table of Contents) lesen und die CD zuruecklegen:

1. Im Browser unter **Scanner > Bereich scannen**
2. **Start-Slot** eingeben (z.B. `1`)
3. **End-Slot** eingeben (z.B. `300`)
4. **Scan starten** klicken

**Dauer:** Ca. 30-60 Sekunden pro CD (Laden + TOC lesen + Zuruecklegen). Ein vollstaendiger Scan von 300 Slots dauert ca. 3-5 Stunden.

**Hinweis:** Der Scan kann jederzeit abgebrochen und spaeter fortgesetzt werden. Bereits gescannte CDs bleiben erhalten.

### 12.2 MusicBrainz-Suche

Fuer einzelne CDs koennen Metadaten automatisch gesucht werden:

1. Im Browser unter **Scanner > MusicBrainz Suche**
2. Nach **Album** oder **Kuenstler** suchen
3. Ergebnis auswaehlen
4. Auf einen Slot anwenden

### 12.3 JSON-Import

Falls bereits eine Datenbank aus einer frueheren Installation vorliegt:

1. Im Browser unter **Scanner > JSON Import**
2. `cds.json`-Datei auswaehlen
3. **Importieren** klicken

---

## 13. PWA auf Smartphone installieren

Der CAC Controller kann als Progressive Web App (PWA) auf dem Smartphone installiert werden:

### iOS (Safari)

1. `http://<PI_IP>:3000` im Safari oeffnen
2. **Teilen**-Symbol antippen (Quadrat mit Pfeil)
3. **Zum Home-Bildschirm** waehlen
4. Namen eingeben und **Hinzufuegen** tippen

### Android (Chrome)

1. `http://<PI_IP>:3000` in Chrome oeffnen
2. **Drei-Punkte-Menue** antippen
3. **Zum Startbildschirm hinzufuegen** waehlen
4. **Hinzufuegen** tippen

Die App laeuft dann im Vollbildmodus wie eine native App.

---

## 14. Updates

### Vom GitHub-Repository

```bash
cd /opt/cac-controller
git pull
npm install
sudo systemctl restart cac-controller
```

### Manuell

1. Neue Dateien auf den Pi kopieren (per SCP oder USB)
2. `npm install` ausfuehren (falls Abhaengigkeiten geaendert)
3. Service neu starten: `sudo systemctl restart cac-controller`

---

## 15. Fehlerbehebung

### 15.1 Service startet nicht

```bash
# Logs pruefen:
sudo journalctl -u cac-controller --no-pager -n 50

# Service-Status:
sudo systemctl status cac-controller

# Manuell starten fuer detaillierte Fehlerausgabe:
cd /opt/cac-controller && node server.js
```

### 15.2 Serieller Port nicht gefunden

```bash
# Alle USB-Geraete anzeigen:
lsusb

# Serielle Ports auflisten:
ls -la /dev/ttyUSB* /dev/ttyACM* 2>/dev/null

# Kernel-Log pruefen:
dmesg | grep -i tty

# Benutzer in dialout-Gruppe?
groups
```

**Loesung:** Adapter abstecken, 5 Sekunden warten, wieder einstecken. Falls `/dev/ttyUSB1` statt `ttyUSB0`: In den Einstellungen den Port aendern.

### 15.3 Keine Verbindung zum Wechsler

```bash
# Serielle Verbindung manuell testen:
stty -F /dev/ttyUSB0 9600 cs8 -cstopb -parenb
echo -ne "1PS?X\r" > /dev/ttyUSB0
timeout 3 cat /dev/ttyUSB0
```

**Moegliche Ursachen:**
- Falsches Kabel (kein Nullmodem-Kabel)
- Falsche Baudrate (4800 statt 9600 oder umgekehrt)
- Wechsler ausgeschaltet oder im Standby
- TX/RX vertauscht

### 15.4 Port 3000 belegt

```bash
# Prozess auf Port 3000 finden:
sudo lsof -i :3000

# Falls ein alter Prozess laeuft, Service stoppen:
sudo systemctl stop cac-controller
```

Alternativ: In den Einstellungen einen anderen Port waehlen (z.B. 8080).

### 15.5 npm install schlaegt fehl

```bash
# Build-Tools pruefen:
gcc --version
python3 --version

# Falls nicht vorhanden:
sudo apt install -y build-essential python3

# Node-Modules loeschen und neu installieren:
rm -rf node_modules package-lock.json
npm install
```

### 15.6 WLAN bricht ab

```bash
# Stromsparmodus pruefen:
iw wlan0 get power_save

# Deaktivieren (siehe Abschnitt 3.5)
sudo iw wlan0 set power_save off
```

### 15.7 Raspberry Pi Zero: Langsame Installation

Auf einem Pi Zero (erste Generation) kann `npm install` bis zu 15 Minuten dauern. Alternativen:

1. **Cross-Compilation:** Auf einem leistungsstaerkeren Rechner kompilieren und `node_modules/` per SCP uebertragen
2. **Swap vergroessern:**
```bash
sudo dphys-swapfile swapoff
sudo nano /etc/dphys-swapfile
# CONF_SWAPSIZE=1024
sudo dphys-swapfile setup
sudo dphys-swapfile swapon
```

---

## 16. Deinstallation

### Service entfernen

```bash
sudo systemctl stop cac-controller
sudo systemctl disable cac-controller
sudo rm /etc/systemd/system/cac-controller.service
sudo systemctl daemon-reload
```

### Dateien loeschen

```bash
sudo rm -rf /opt/cac-controller
```

### Node.js entfernen (optional)

```bash
sudo apt purge -y nodejs
sudo rm -rf /usr/lib/node_modules
```

---

*CAC Controller v1.0.0 — Copyright (c) 2025 Dirk Jensen*
*MIT License*
