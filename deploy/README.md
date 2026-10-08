# Betrieb

Alles, was ein Server für das Open Layout Tool braucht, liegt hier: eine
Konfigurationsdatei, zwei Skripte und die Vorlagen für systemd und Caddy.
Dienste: `olt-server`, `olt-optimizer`, `olt-cloudjobs` und die tägliche Sicherung.

| Datei | |
|---|---|
| `olt.env.example` | Konfiguration, kommt nach `/etc/open-layout-tool/olt.env` |
| `setup.sh` | einmalige Einrichtung (darf wiederholt werden) |
| `deploy.sh` | nach jedem Update: Abhängigkeiten, Build, Neustart, Health-Check |
| `templates/` | systemd-Units, Caddy-Site; `@OLT_…@` wird aus der Konfiguration gefüllt |

## Aufbau

```
Internet ─▶ Caddy (TLS, Let's Encrypt)
             ├─ /            dist/ (die gebaute App, statisch)
             ├─ /api/*       olt-server     Node, Nutzer/Projekte/Revisionen, SQLite,
             │                              Punktwolken hochladen und ausliefern
             ├─ /optimizer/* olt-optimizer  Python, Optimierung, MDB, Gelände   ┐ nur mit
             └─ /data/km*    Km-Linien aus dist/                                  ┘ Sitzung

olt-cloudjobs (ohne Port): bereitet hochgeladene Punktwolken auf und rechnet lange Läufe darauf, Warteschlangen in derselben SQLite
```

Beide Dienste hören nur auf `OLT_BIND` (Standard `127.0.0.1`), nie öffentlich.
Caddy fragt für `/optimizer/*` und `/data/km*` per `forward_auth` beim
Projektserver (`/api/me`), ob die Anfrage eine gültige Sitzung trägt.

## Neuer Server

Voraussetzungen: Debian 12 oder Ubuntu 22.04/24.04, root, ein DNS-Eintrag für den
Hostnamen auf diesen Server, Ports 80 und 443 frei.

```bash
git clone https://github.com/Serigalan/open-layout-tool.git /opt/open-layout-tool
mkdir -p /etc/open-layout-tool
cp /opt/open-layout-tool/deploy/olt.env.example /etc/open-layout-tool/olt.env
$EDITOR /etc/open-layout-tool/olt.env          # mindestens OLT_DOMAIN
/opt/open-layout-tool/deploy/setup.sh
```

`setup.sh` installiert Node 22 (NodeSource), Python-venv, `mdbtools` und Caddy,
legt den Dienstnutzer `olt` und `/var/lib/open-layout-tool` an, kopiert die
NTv2-Gitter aus `grids/` dorthin, wo PROJ sie findet, baut die App, installiert
den Optimierer (editierbar, liest `src/constraints` direkt), richtet die
systemd-Units und die Caddy-Site ein und legt den ersten Admin an. Dessen
Startpasswort steht danach in `/var/lib/open-layout-tool/admin-start-password.txt`;
es muss bei der ersten Anmeldung geändert werden, die Datei danach löschen.

Weitere Nutzer legt ein Admin in der App an (Nutzerverwaltung).

## Update

```bash
cd /opt/open-layout-tool && deploy/deploy.sh --pull
```

Installiert npm- und pip-Abhängigkeiten nur, wenn sich ihre Lock-/Projektdatei
geändert hat, baut die App neben `dist/` und gleicht sie dann hinein ab (die Seite
ist während des Builds nie leer), startet die Dienste neu und prüft
`/api/health` und `/health`. Nur prüfen: `deploy/deploy.sh --check-only`.

Nach einer Änderung an der Konfiguration oder an `templates/`: `setup.sh` erneut
ausführen.

## Daten und Sicherung

| Was | Wo (Standard) |
|---|---|
| Datenbank | `/var/lib/open-layout-tool/olt.sqlite` (SQLite, WAL) |
| tägliche Kopie 03:30 | `/var/lib/open-layout-tool/backups/olt-JJJJ-MM-TT.sqlite`, 30 Tage |
| Gelände-Kacheln (Cache) | `/var/lib/open-layout-tool/terrain-cache` (bis ≈ 1,6 GB) |
| NTv2-Gitter für PROJ | `/var/lib/open-layout-tool/share/proj/` |
| Punktwolken | `/var/lib/open-layout-tool/clouds/<Projekt>/<Wolke>/` (`OLT_CLOUDS`), **nicht** in der täglichen Kopie |

Wiederherstellen: `systemctl stop olt-server`, Sicherung über `olt.sqlite` kopieren
(die `-wal`/`-shm`-Dateien daneben löschen), `systemctl start olt-server`.

## Punktwolken (Phase 13)

Eine hochgeladene Wolke liegt in `clouds/<Projekt>/<Wolke>/`:

| Datei | |
|---|---|
| `raw.part` | die hochgeladene Datei, bis sie aufbereitet ist (nur mit „Rohdatei aufbewahren“ danach noch) |
| `tiles-L0.bin` … `tiles-L4.bin` | die Kacheln der fünf Detailstufen: Original, 2-cm-Voxel, 8 cm, 32 cm, 1,28 m |
| `index-L0.json` … `index-L4.json` | wo welche Kachel in der Kacheldatei liegt |

Hochgeladen wird in Stücken von 8 MB über `olt-server` (fortsetzbar); danach
bereitet `olt-cloudjobs` die Wolke auf — höchstens zwei Aufträge zugleich, je in
einem eigenen Prozess, mit `CPUQuota=300%`, `Nice=10` und `MemoryMax=2G`. Ein
Neustart des Dienstes (etwa durch `deploy.sh`) unterbricht einen laufenden
Auftrag; er beginnt beim nächsten Start von vorn.

Daneben, in einer eigenen Warteschlange, die **langen Läufe** (AP 13.7): die
gleisweite Lichtraumprüfung und die Schienenverfolgung über die Wolken des
Projekts, gestartet aus der App von Admin oder Nutzern mit dem Recht
„Punktwolken bearbeiten“. Höchstens zwei zugleich (`OLT_CLOUDRUNS_PARALLEL`),
je in einem eigenen Prozess mit 320 MB Heap; ihr Ergebnis bleibt sieben Tage in
der Tabelle `cloud_run`. Ausgeliefert werden die
Kacheln von `olt-server` selbst, mit Prüfung der Projekt-Mitgliedschaft, nicht
von Caddy.

**Größenrechnung** (gemessen an einer Lieferung von 571 MB LAZ, 224 Mio. Punkte,
489 m Gleis; für 5 km hochgerechnet):

| | ohne Farbe | mit Farbe |
|---|---|---|
| Original (L0) | 8,1 GB | ≈ 12–14 GB |
| 2-cm-Voxel (L1) | 1,5 GB | ≈ 2,2 GB |
| L2–L4 | ≈ 0,15 GB | ≈ 0,2 GB |
| **je Projekt** | **≈ 10 GB** | **≈ 15 GB** |
| Rohdateien, falls aufbewahrt | 5,9 GB | ≈ 7 GB |

Je Projekt sind höchstens 25 GB erlaubt; vor jedem Hochladen prüft der Server
diese Quote und den freien Platz (es müssen danach noch 5 GB frei bleiben). Die
Nutzerverwaltung zeigt den freien Platz und je Projekt die Belegung, und warnt
unter 20 GB frei.

**Sicherung.** Die tägliche Kopie enthält nur die Datenbank (mit den Einträgen
der Wolken), nicht die Kacheln — sie lassen sich aus der Rohdatei neu erzeugen.
Wer Wolken sichern will, kopiert `clouds/` (oder nur die aufbewahrten
`raw.part`) gesondert, z. B. `rsync -a /var/lib/open-layout-tool/clouds/ <Ziel>/`.

Admin von Hand anlegen:
`cd tools/server && OLT_SERVER_DB=/var/lib/open-layout-tool/olt.sqlite runuser -u olt -- node bin/olt-server.mjs create-admin <login> [Name]`

## Caddy in einem Container (`OLT_CADDY=external`)

Läuft schon ein Caddy, der die Ports 80/443 hält (z. B. in Docker), schreibt
`setup.sh` die Site nur nach `$OLT_DATA/open-layout-tool.caddy`. Sie wird dort von
Hand eingebunden. `OLT_UPSTREAM` ist dann die Adresse, unter der der Container
den Host erreicht (z. B. das Gateway des Docker-Netzes, und `OLT_BIND` dieselbe
Adresse), `OLT_SITE_ROOT` der Pfad, unter dem `dist/` im Container eingehängt
ist, und `OLT_TRUST_PROXY` das Netz des Containers (sonst sieht die Login-Bremse
alle Anfragen von einer Adresse). `dist/` bleibt beim Deploy dasselbe Verzeichnis, ein Bind-Mount überlebt
den Build also.

## Lokale Entwicklung

`npm run dev` leitet `/api` an `OLT_API_TARGET` (Standard `http://127.0.0.1:8787`)
und `/optimizer` an `OLT_OPTIMIZER_TARGET` (Standard `http://127.0.0.1:8099`)
weiter, wie Caddy im Betrieb. Dienste lokal:

```bash
cd tools/server && npm ci && OLT_SERVER_INSECURE_COOKIE=1 OLT_SERVER_DB=/tmp/olt.sqlite node bin/olt-server.mjs serve
python3 -m venv .venv && .venv/bin/pip install -e 'tools/optimizer[terrain]' && .venv/bin/olt-optimizer-serve
```
