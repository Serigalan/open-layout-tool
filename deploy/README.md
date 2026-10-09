# Betrieb

Alles, was ein Server für das Open Layout Tool braucht, liegt hier: eine
Konfigurationsdatei, zwei Skripte und die Vorlagen für systemd und Caddy.
Dienste: `olt-server`, `olt-optimizer`, `olt-cloudjobs` und die tägliche Sicherung —
je Instanz, siehe *Mehrere Instanzen*.

| Datei | |
|---|---|
| `olt.env.example` | Konfiguration, kommt nach `/etc/open-layout-tool/olt.env` |
| `setup.sh` | einmalige Einrichtung (darf wiederholt werden) |
| `deploy.sh` | nach jedem Update: Abhängigkeiten, Build, Sicherung der DB, Neustart, Health-Check |
| `release.sh` | gibt einen Stand für die Produktion frei: Tag `prod-JJJJ-MM-TT`, nur bei grüner CI |
| `monitor.sh` | Überwachung aller Instanzen der Maschine (Timer `olt-monitor.timer`) |
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
den Optimierer (editierbar, liest `src/core/constraints` direkt), richtet die
systemd-Units und die Caddy-Site ein und legt den ersten Admin an. Dessen
Startpasswort steht danach in `/var/lib/open-layout-tool/admin-start-password.txt`;
es muss bei der ersten Anmeldung geändert werden, die Datei danach löschen.

Weitere Nutzer legt ein Admin in der App an (Nutzerverwaltung).

## Update

```bash
cd /opt/open-layout-tool && deploy/deploy.sh --pull
```

Installiert npm- und pip-Abhängigkeiten nur, wenn sich ihre Lock-/Projektdatei
geändert hat (Python-Versionen aus `tools/optimizer/requirements.lock`), baut die
App neben `dist/` und gleicht sie dann hinein ab (die Seite ist während des Builds
nie leer), kopiert die Datenbank (`backups/olt-JJJJ-MM-TT-predeploy-HHMMSS.sqlite`),
startet die Dienste neu und prüft `/api/health` und `/health`. Nur prüfen:
`deploy/deploy.sh --check-only`. Welcher Stand läuft: `$OLT_DATA/.deploy-state/ref`
und `commit`.

Nach einer Änderung an der Konfiguration oder an `templates/`: `setup.sh` erneut
ausführen.

## Mehrere Instanzen: Test und Produktion

Auf einer Maschine laufen beliebig viele Instanzen nebeneinander, jede mit eigener
Konfiguration, eigenem Checkout, Nutzer, Daten, Ports und Units. `OLT_INSTANCE`
gibt ihr den Namen: `OLT_INSTANCE=prod` → Units `olt-prod-server`,
`olt-prod-optimizer`, `olt-prod-cloudjobs`, `olt-prod-server-backup.timer`, Nutzer
`olt-prod`, Daten `/var/lib/open-layout-tool-prod`. Ohne Namen gelten die
einfachen Namen (`olt-server` …). Beide Skripte nehmen die Konfiguration mit
`--config <datei>`:

```bash
deploy/setup.sh  --config /root/open-layout-tool-prod/olt.env
deploy/deploy.sh --config /root/open-layout-tool-prod/olt.env --ref prod-2026-10-09
```

`setup.sh` bricht ab, wenn eine Unit des gewünschten Namens zu einem anderen
Checkout gehört oder eine andere Instanz schon dieselbe Datenbank oder dieselben
Ports benutzt. Liegt der Checkout unter einem geschlossenen Verzeichnis (`/root`,
Modus 0700), gibt `setup.sh` dem Dienstnutzer per ACL nur das Durchgangsrecht
(`setfacl -m u:olt-prod:--x /root`), nicht das Lesen.

**Release-Weg.** Eine Instanz mit `OLT_TRACK=main` (Test) zieht mit `--pull` jeden
Stand von `main`. Eine mit `OLT_TRACK=tags` (Produktion) nimmt nur Tags `prod-…`:

1. Arbeit auf `main`, `deploy.sh --pull` auf dem Test, dort abnehmen.
2. `deploy/release.sh` (oder `release.sh <commit>`) — legt den nächsten freien Tag
   `prod-JJJJ-MM-TT` (dann `.2`, `.3`) an und pusht ihn, nur wenn die CI auf GitHub
   für den Commit grün ist.
3. Auf der Produktion `deploy.sh --config … --ref prod-JJJJ-MM-TT`. Das Skript prüft
   die CI noch einmal (übersteuerbar mit `--force`), checkt den Tag aus, sichert die
   Datenbank und startet neu.

**Zurück** auf den vorigen Stand: `deploy.sh --config … --ref <voriger Tag>`.
Migrationen laufen nur vorwärts — hat der neue Stand das Schema geändert, vorher
die Sicherung von vor dem Deploy zurückspielen (siehe unten).

**Auf dieser Maschine** (seit 2026-10-09):

| | Test | Produktion |
|---|---|---|
| Adresse | online.open-layout-tool.org | db-ec.open-layout-tool.org |
| Konfiguration | `/etc/open-layout-tool/olt.env` | `/root/open-layout-tool-prod/olt.env` |
| Checkout | `/opt/open-layout-tool` (folgt `main`) | `/root/open-layout-tool-prod/app` (nur Tags) |
| Units, Nutzer | `olt-*`, `olt` | `olt-prod-*`, `olt-prod` |
| Ports (an 172.18.0.1) | 8787, 8099 | 8788, 8100 |
| Daten | `/var/lib/open-layout-tool` | `/var/lib/open-layout-tool-prod` |
| Frontend im Caddy | `/srv/olt/test` | `/srv/olt/prod` |

## Daten und Sicherung

| Was | Wo (Standard) |
|---|---|
| Datenbank | `/var/lib/open-layout-tool/olt.sqlite` (SQLite, WAL) |
| tägliche Kopie 03:30 | `/var/lib/open-layout-tool/backups/olt-JJJJ-MM-TT.sqlite`, 30 Tage |
| Gelände-Kacheln (Cache) | `/var/lib/open-layout-tool/terrain-cache` (bis ≈ 1,6 GB) |
| NTv2-Gitter für PROJ | `/var/lib/open-layout-tool/share/proj/` |
| Punktwolken | `/var/lib/open-layout-tool/clouds/<Projekt>/<Wolke>/` (`OLT_CLOUDS`), **nicht** in der täglichen Kopie |

Dazu vor jedem Neustart durch `deploy.sh` eine Kopie
`olt-JJJJ-MM-TT-predeploy-HHMMSS.sqlite`, die wie die täglichen nach 30 Tagen geht.
Gesichert wird nur auf dieser Maschine; eine Sicherung außer Haus gibt es noch nicht.

Wiederherstellen (bei einer Instanz mit Namen: `olt-<name>-…` und deren `OLT_DATA`):
`systemctl stop olt-server olt-cloudjobs`, Sicherung über `olt.sqlite` kopieren
(die `-wal`/`-shm`-Dateien daneben löschen, Eigentümer der Dienstnutzer),
`systemctl start olt-server olt-cloudjobs`.

## Überwachung, Firewall, Logs

`deploy/monitor.sh <olt.env> …` prüft je Instanz: laufen die Dienste und der
Sicherungs-Timer, antworten Projektserver und Optimierer, antwortet
`https://<domain>/api/health` von außen durch Caddy, ist das Zertifikat noch
mindestens 14 Tage gültig, sind mindestens 20 GB frei. Einmal eingerichtet mit

```bash
deploy/monitor.sh --install /etc/open-layout-tool/olt.env /root/open-layout-tool-prod/olt.env
```

läuft es alle 5 Minuten (`olt-monitor.timer`, Skript nach
`/usr/local/lib/open-layout-tool/` kopiert — nach Änderungen `--install` wiederholen).
Ein Fehler macht `olt-monitor.service` *failed*: `systemctl --failed`,
`journalctl -u olt-monitor`. Benachrichtigen kann es, sobald in der Unit
`OLT_MONITOR_NOTIFY` steht (ein Befehl, der die Befunde auf stdin bekommt).

**Firewall** (auf dieser Maschine seit 2026-10-09, `ufw`): eingehend nur 22/tcp,
80/tcp, 443/tcp und 443/udp, dazu alles aus den Docker-Netzen `172.16.0.0/12`
(so erreicht `osrd-caddy` die Dienste an `172.18.0.1`). Die Dienste binden ohnehin
nie an `0.0.0.0`; die Firewall fängt einen Fehler darin ab.

**Journal** begrenzt auf 1 GB (`/etc/systemd/journald.conf.d/olt.conf`).

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
`setup.sh` die Site nur nach `$OLT_CADDY_DIR/open-layout-tool[-<instanz>].caddy`
und führt danach `OLT_CADDY_RELOAD` aus, falls gesetzt. `OLT_UPSTREAM` ist dann die
Adresse, unter der der Container den Host erreicht (z. B. das Gateway des
Docker-Netzes, und `OLT_BIND` dieselbe Adresse), `OLT_SITE_ROOT` der Pfad, unter
dem `dist/` im Container eingehängt ist, und `OLT_TRUST_PROXY` das Netz des
Containers (sonst sieht die Login-Bremse alle Anfragen von einer Adresse).
`dist/` bleibt beim Deploy dasselbe Verzeichnis, ein Bind-Mount überlebt den
Build also.

**Auf dieser Maschine** ist das der Container `osrd-caddy` eines anderen Projekts
(`/root/osrd/deploy/`). Eingehängt sind dort (`docker-compose.deploy.yml`):

| Host | im Container |
|---|---|
| `/etc/open-layout-tool/caddy/` (Site-Blöcke beider Instanzen) | `/etc/caddy/olt/` |
| `/opt/open-layout-tool/dist` | `/srv/olt/test` |
| `/root/open-layout-tool-prod/app/dist` | `/srv/olt/prod` |

Das OSRD-Caddyfile enthält nur `import /etc/caddy/olt/*.caddy`. Weil das ein
eingehängtes **Verzeichnis** ist, sieht Caddy neue oder geänderte Site-Dateien
nach `caddy reload` sofort (anders als das einzeln eingehängte Caddyfile, nach
dessen Änderung der Container neu erzeugt werden muss). **Achtung:** OSRDs eigenes
`setup.sh` schreibt das Caddyfile neu und verliert dabei die `import`-Zeile — danach
wieder anfügen und `docker restart osrd-caddy`.

## Lokale Entwicklung

`npm run dev` leitet `/api` an `OLT_API_TARGET` (Standard `http://127.0.0.1:8787`)
und `/optimizer` an `OLT_OPTIMIZER_TARGET` (Standard `http://127.0.0.1:8099`)
weiter, wie Caddy im Betrieb. Dienste lokal:

```bash
cd tools/server && npm ci && OLT_SERVER_INSECURE_COOKIE=1 OLT_SERVER_DB=/tmp/olt.sqlite node bin/olt-server.mjs serve
python3 -m venv .venv && .venv/bin/pip install -c tools/optimizer/requirements.lock -e 'tools/optimizer[terrain]' && .venv/bin/olt-optimizer-serve
```
