# olt-optimizer

Python-CLI zur Trassenoptimierung von Open-Layout-Tool-Tracks: maximiert die
Engpass-Geschwindigkeit `v = √(R·(u + u_f)/11,8)` über Radius, Überhöhung und
seitliche Verschiebung der Zwischengeraden — innerhalb eines Abrückungs-Korridors
zur Bestandsachse.

Der Geometrie-Kernel (`geometry.py`) war ursprünglich ein 1:1-Port der
App-Implementierung; seit AP 7.1 ist er die einzige. `tests/verify.py` prüft ihn
gegen die damals erzeugten Referenzwerte.

## Setup

```bash
cd tools/optimizer
python3 -m venv .venv
.venv/bin/pip install -e .
```

## Workflow

1. **Export** in der App: Datenaustausch → Tracks exportieren → `tracks.json`
2. **Optimieren:**
   ```bash
   .venv/bin/olt-optimize tracks.json --track <Name|Id> \
       --corridor-cm 50 --grenzwert reg -o tracks_optimized.json
   ```
3. **Import** in der App: Datenaustausch → Tracks importieren
   (gleiche Id ⇒ Konfliktdialog, „importiert behalten" ersetzt den Track).

## Optionen

| Option | Bedeutung |
|---|---|
| `--corridor-cm` | max. Abrückung zur Bestandsachse in cm (Default 50) |
| `--grenzwert {reg,discretion}` | gegen welche Grenze des Regelwerks gerechnet wird: `reg` = Regelwert (Default, kein Vorschlag schlechter als ein Hinweis), `discretion` = Ermessensgrenze (höchstens Warnungen, jede begründungspflichtig) |
| `--regelwerk` | Id des Regelkatalogs aus `src/constraints/` (Default `db-ril-800-0110`) |
| `--per-curve` | nur Baseline: Geraden bleiben fix (Verhalten des App-Panels) |
| `--uebergang {bestand,bloss,auto}` | Übergangsbogen-Profil: wie vorhanden lassen, alle Rampen auf Bloss, oder automatisch die zulässige Variante mit höherer Engpass-v (Default: auto). Bloss nur an der Ermessensgrenze: LP.UB.02 nennt einen Blossbogen auf der (in dieser App immer geraden) Rampe einen Sonderfall, am Regelwert rechnet `auto` deshalb nur den Bestand |
| `--maxiter`, `--seed` | Differential-Evolution-Steuerung |

## Modell

* Variablen: Verschiebung s_i der inneren Geraden (parallel, ±Korridor),
  Radius R_j und Überhöhung u_j je Bogen.
* Zielfunktion: max min_j v_j (Engpass-v), Differential Evolution + Nelder-Mead-
  Politur, warm gestartet mit der Per-Bogen-Baseline (Ergebnis nie schlechter).
* Nebenbedingungen: Abrückung ≤ Korridor (beidseitig gesampelt), Track-Endpunkte
  und Richtungen fix — und **jede Regel des Regelkatalogs** auf der gewählten
  Stufe. Kein Grenzwert steht im Code: ein Lauf liest
  `src/constraints/db-ril-800-0110.json` (im Paket über den Symlink
  `olt_optimizer/constraints`) und wertet ihn mit derselben Ausdruckssprache aus
  wie die App (`ruleexpr.py`, `katalog.py`). `grenzen.py` macht daraus die
  Schranken eines Laufs: Entwurfsgeschwindigkeit (40…300 km/h im 5-km/h-Raster),
  Überhöhung und Überhöhungsfehlbetrag (auch im Weichenbereich), Mindestelement-
  länge, Rampenlänge aus Überhöhungs- *und* Fehlbetragssprung, mittlere
  Rampenneigung (steilste und flachste), Vergleichsradius an Krümmungssprüngen,
  Zwischengerade zwischen Gegenbögen. Eine Regel, die es nicht einordnen kann,
  lehnt es ab, statt sie zu übergehen.
* Die Elemente eines Vorschlags tragen ihre Entwurfsgeschwindigkeit im Raster
  des Katalogs; `tests/katalog_check.py` prüft jeden Vorschlag danach mit einem
  Nachbau der App-Prüfung (`trassierungCheck.js`).
* **Korbbögen** werden unterstützt: mehrere gleichsinnige Bögen (optional mit
  Zwischen-Übergangsbögen) bilden eine Gruppe mit eigenen R_i und u_i je
  Teilbogen plus freien Sweep-Aufteilungen; die Überhöhung eines Teilbogens
  darf nur steigen, wenn die Rampen auf beiden Seiten existieren. S-Bögen ohne
  Zwischengerade werden abgelehnt.

## Verifikation

```bash
.venv/bin/python tests/verify.py           # Kernel, Läufe, Regelprüfung der Vorschläge
.venv/bin/python tests/verify_service.py   # der HTTP-Dienst
.venv/bin/python tests/vectors.py          # gemeinsame Testvektoren mit der App
```

`tests/vectors.py` liest `src/constraints/tests/` — Ausdrücke der Regelsprache und
Elementketten mit den erwarteten Befunden des Regelkatalogs. Die App liest dieselben
Dateien (`ruleExpr.vectors.test.js`, `trassierungCheck.vectors.test.js`); weichen
JavaScript und Python voneinander ab, schlägt eine der beiden Seiten fehl.
