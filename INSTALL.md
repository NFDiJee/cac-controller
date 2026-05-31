# Installation auf dem Raspberry Pi

Diese Anleitung beschreibt die vollstaendige Installation des CAC Controllers auf einem Raspberry Pi (headless, ohne Monitor).

## Voraussetzungen

- Raspberry Pi (empfohlen: Pi 3/4/5 oder Zero 2 W) mit Raspberry Pi OS (Debian Bookworm oder neuer)
- SSH-Zugang zum Raspberry Pi
- USB-zu-Seriell-Adapter (RS-232C) am Raspberry Pi angeschlossen
- Serielles Kabel zum Pioneer CAC Wechsler (15-pol. D-Sub RS-232C)
- WLAN oder Ethernet-Verbindung

## Schritt 1: Raspberry Pi vorbereiten

Per SSH verbinden:
```bash
ssh pi@<IP_ADRESSE>
```

System aktualisieren:
```bash
sudo apt update && sudo apt upgrade -y
```

## Schritt 2: Node.js installieren

Node.js 20 LTS (oder neuer) installieren:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Version pruefen:
```bash
node --version   # mindestens v18.x
npm --version
```

## Schritt 3: Build-Tools installieren

Fuer die native SQLite-Erweiterung (better-sqlite3):
```bash
sudo apt install -y build-essential python3
```

## Schritt 4: Benutzer zur dialout-Gruppe hinzufuegen

Damit der Benutzer auf serielle Ports zugreifen kann:
```bash
sudo usermod -a -G dialout pi
```

**Wichtig:** Nach diesem Schritt einmal ab- und wieder anmelden oder `newgrp dialout` ausfuehren.

## Schritt 5: USB-Seriell-Adapter pruefen

Adapter einstecken und pruefen:
```bash
ls -la /dev/ttyUSB*
```

Sollte `/dev/ttyUSB0` anzeigen. Falls nicht, pruefen:
```bash
dmesg | grep tty
```

## Schritt 6: CAC Controller installieren

Option A - Von GitHub:
```bash
cd /opt
sudo git clone https://github.com/NFDiJee/cac-controller.git
sudo chown -R pi:pi /opt/cac-controller
cd /opt/cac-controller
npm install
```

Option B - Dateien manuell kopieren:
```bash
sudo mkdir -p /opt/cac-controller
# Dateien per SCP vom lokalen Rechner kopieren:
# scp -r ./cac-controller/* pi@<IP>:/opt/cac-controller/
cd /opt/cac-controller
npm install
```

## Schritt 7: Erster Test

Server manuell starten:
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

Im Browser oeffnen: `http://<PI_IP>:3000`

Mit `Ctrl+C` beenden.

## Schritt 8: Systemd-Service einrichten

Service-Datei kopieren:
```bash
sudo cp /opt/cac-controller/cac-controller.service /etc/systemd/system/
```

Falls der Benutzer nicht `pi` ist, die Service-Datei anpassen:
```bash
sudo nano /etc/systemd/system/cac-controller.service
# User= und Group= auf den richtigen Benutzer aendern
```

Service aktivieren und starten:
```bash
sudo systemctl daemon-reload
sudo systemctl enable cac-controller
sudo systemctl start cac-controller
```

Status pruefen:
```bash
sudo systemctl status cac-controller
```

Logs anzeigen:
```bash
sudo journalctl -u cac-controller -f
```

## Schritt 9: Autostart pruefen

Raspberry Pi neustarten:
```bash
sudo reboot
```

Nach dem Neustart sollte der CAC Controller automatisch laufen.
Pruefen: `http://<PI_IP>:3000`

## Schritt 10: Einstellungen anpassen

Im Browser unter **Mehr > Einstellungen**:

1. **Serieller Port** - Standard: `/dev/ttyUSB0`
2. **Baudrate** - `9600` fuer V3000/V3200/V5000, `4800` fuer V180M
3. **Modell** - Dein Pioneer-Modell auswaehlen
4. **Max. Discs** - 300 (V3000/V3200) oder 500 (V5000) oder 18 (V180M)
5. **Sprache** - Automatisch, Deutsch oder English
6. **Statistik Min. Sekunden** - Mindestspieldauer (Standard: 30s), damit ein Track in der Statistik gezaehlt wird

Nach Aenderungen: Service neu starten:
```bash
sudo systemctl restart cac-controller
```

## Schritt 11: CD-Datenbank aufbauen

### Variante A: Bestehende Daten importieren
Unter **Scanner > JSON Import** eine vorhandene `cds.json` hochladen.

### Variante B: CDs manuell katalogisieren
1. Unter **Scanner > MusicBrainz Suche** nach Album/Kuenstler suchen
2. Ergebnis auf einen Slot anwenden

### Variante C: CDs automatisch scannen
1. Unter **Scanner > Bereich scannen** Start- und End-Slot eingeben
2. Der Wechsler laedt jede CD, liest die TOC und katalogisiert sie

**Achtung:** Ein vollstaendiger Scan aller 300 Slots kann mehrere Stunden dauern (30-60 Sekunden pro CD fuer Laden/Lesen/Zuruecklegen).

## Schritt 12: Backup erstellen

Unter **Einstellungen > Backup** kann die gesamte Datenbank als JSON exportiert und spaeter wieder importiert werden:

- **Export** — Laedt eine JSON-Datei mit allen CDs, Tracks, Playlists, Favoriten, Bewertungen, Wiedergabeverlauf und Einstellungen herunter
- **Import** — Stellt eine zuvor exportierte Backup-Datei wieder her (ueberschreibt alle vorhandenen Daten)
- **Cover-Export** — Laedt ein ZIP-Archiv mit allen gespeicherten Cover-Bildern herunter
- **Cover-Import** — Stellt Cover-Bilder aus einem zuvor exportierten ZIP-Archiv wieder her

## Schritt 13: PWA auf dem Smartphone

Auf dem Smartphone die URL `http://<PI_IP>:3000` oeffnen:

- **iOS**: Teilen > Zum Home-Bildschirm
- **Android**: Menue > Zum Startbildschirm hinzufuegen

Die App laeuft dann wie eine native App im Vollbild.

---

## Fehlerbehebung

### Serieller Port nicht gefunden
```bash
# Alle USB-Geraete anzeigen
lsusb
# Serielle Ports anzeigen
ls -la /dev/ttyUSB* /dev/ttyACM* 2>/dev/null
# Kernel-Log pruefen
dmesg | tail -20
```

### Keine Verbindung zum Wechsler
```bash
# Port manuell testen
stty -F /dev/ttyUSB0 9600 cs8 -cstopb -parenb
echo -ne "1PS?X\r" > /dev/ttyUSB0
cat /dev/ttyUSB0
```

### Service startet nicht
```bash
sudo journalctl -u cac-controller --no-pager -n 50
```

### Port 3000 belegt
In den Einstellungen einen anderen Port waehlen (z.B. 8080), oder:
```bash
sudo lsof -i :3000
```

### WLAN-Stromsparmodus deaktivieren (empfohlen)
```bash
sudo iw wlan0 set power_save off
# Permanent in /etc/rc.local oder via systemd
```

### Raspberry Pi Zero: Langsame native Module
Falls `npm install` auf einem Pi Zero sehr lange dauert:
```bash
# Auf einem leistungsstaerkeren System kompilieren und uebertragen
# Oder prebuild-Binaries verwenden
npm install --build-from-source
```

---

## Updates

```bash
cd /opt/cac-controller
git pull
npm install
sudo systemctl restart cac-controller
```

## Deinstallation

```bash
sudo systemctl stop cac-controller
sudo systemctl disable cac-controller
sudo rm /etc/systemd/system/cac-controller.service
sudo systemctl daemon-reload
sudo rm -rf /opt/cac-controller
```
