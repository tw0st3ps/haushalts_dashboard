# Haushalts-Dashboard

Eine kleine Webanwendung für den Haushalt: wiederkehrender Putzplan (Raum,
Aktivität, zuständige Person pro Wochentag), Essensplanung mit Wünschen,
Favoriten-Gerichte inkl. Zutaten und eine Einkaufsliste, die sich auch
automatisch aus dem Essensplan befüllen lässt.

Kein Login nötig — jeder im Heimnetz kann das Dashboard über den Browser
öffnen und bearbeiten. Alle Daten liegen in einer SQLite-Datei in einem
Docker-Volume und bleiben bei Neustarts/Updates erhalten.

## Aufbau

- `backend/` — FastAPI-Anwendung (Python), liefert die REST-API unter `/api/...`
  und die statische Oberfläche unter `/`
- `backend/static/` — Frontend (reines HTML/CSS/JavaScript, keine externen
  Abhängigkeiten, funktioniert offline im Heimnetz)
- `docker-compose.yml` — startet alles als ein Container, Port `8080`

## Deployment in einem Proxmox-LXC

### 1. LXC-Container anlegen

Im Proxmox-Webinterface: **Create CT**

- Template: Debian 12 (oder Ubuntu 22.04/24.04)
- Ressourcen: 1 CPU-Kern, 512 MB–1 GB RAM, 4 GB Disk reichen völlig aus
- Unprivilegierter Container ist ok, **aber** für Docker im LXC muss unter
  **Options → Features** die Option **Nesting** aktiviert werden (sonst
  startet der Docker-Daemon im Container nicht):

```bash
# auf dem Proxmox-Host, <CTID> durch die tatsächliche Container-ID ersetzen
pct set <CTID> --features nesting=1
```

Danach den Container starten und per Konsole (`pct enter <CTID>`) oder SSH
verbinden.

### 2. Docker im LXC installieren

```bash
apt update && apt install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
```

(Bei Ubuntu-Template die URL `https://download.docker.com/linux/ubuntu`
verwenden.)

### 3. Projekt in den Container kopieren

Am einfachsten mit `scp` von deinem Rechner aus, z. B.:

```bash
scp -r haushalt-app root@<LXC-IP>:/opt/haushalt-app
```

Alternativ das Verzeichnis direkt im LXC per `git clone` oder Datei-Upload
anlegen.

### 4. Starten

```bash
cd /opt/haushalt-app
docker compose up -d --build
```

Der Container startet automatisch neu (`restart: unless-stopped`), auch nach
einem Neustart des LXC/Hosts.

### 5. Im Heimnetz aufrufen

```
http://<LXC-IP>:8080
```

Am besten dem LXC im Proxmox-Netzwerk eine feste IP geben (statisch oder per
DHCP-Reservierung im Router), damit sich der Link nicht ändert. Optional
kannst du im Router/DNS einen lokalen Namen wie `haushalt.fritz.box`
darauf zeigen lassen.

## Updates einspielen

```bash
cd /opt/haushalt-app
# neue Dateien einspielen (scp/git pull), dann:
docker compose up -d --build
```

Die Datenbank bleibt dabei erhalten, da sie im Docker-Volume
`haushalt-data` liegt (nicht im Container-Dateisystem).

## Backup

Die komplette Datenbank ist eine einzelne SQLite-Datei im Volume. Sichern
z. B. so:

```bash
docker run --rm -v haushalt-app_haushalt-data:/data -v $(pwd):/backup \
  alpine cp /data/haushalt.db /backup/haushalt-backup-$(date +%F).db
```

## Ohne Docker testen (optional, z. B. lokal am eigenen Rechner)

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
DB_PATH=./haushalt.db uvicorn app.main:app --host 0.0.0.0 --port 8080
```

Danach `http://localhost:8080` öffnen.

## Funktionsüberblick

- **Übersicht** — heutige Putzaufgaben, heutiges Essen, offene
  Einkaufsartikel auf einen Blick
- **Putzplan** — wiederkehrender Wochenplan (Mo–So) mit Raum, Aktivität und
  zuständiger Person; Haken werden jede Woche automatisch zurückgesetzt,
  der Verlauf bleibt aber pro Woche gespeichert
- **Essensplan** — Wochenansicht mit Vor-/Zurück-Navigation, pro Tag ein
  Favorit auswählbar oder Freitext, plus Wünsche/Notizen und wer kocht
- **Favoriten** — Lieblingsgerichte mit Zutatenliste (Menge/Einheit) anlegen,
  bearbeiten, löschen
- **Einkaufsliste** — manuell Artikel hinzufügen, abhaken, erledigte
  löschen, oder per Klick automatisch aus den für die aktuelle Woche
  geplanten Gerichten befüllen
- **Einstellungen** — Haushaltsmitglieder (mit Farbe) und Räume verwalten

Keine Konten, kein Login — gedacht für den Betrieb im vertrauenswürdigen
Heimnetz.
