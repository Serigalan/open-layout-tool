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
       --corridor-cm 50 --uf 130 -o tracks_optimized.json
   ```
3. **Import** in der App: Datenaustausch → Tracks importieren
   (gleiche Id ⇒ Konfliktdialog, „importiert behalten" ersetzt den Track).

## Optionen

| Option | Bedeutung |
|---|---|
| `--corridor-cm` | max. Abrückung zur Bestandsachse in cm (Default 50) |
| `--uf {110,130,150}` | Überhöhungsfehlbetrag u_f in mm; 110 = Weichenbereich |
| `--per-curve` | nur Baseline: Geraden bleiben fix (Verhalten des App-Panels) |
| `--uebergang {bestand,bloss,auto}` | Übergangsbogen-Profil: wie vorhanden lassen, alle Rampen auf Bloss (k = 6 statt 8 → kürzere Rampen) oder automatisch die Variante mit höherer Engpass-v (Default: auto) |
| `--maxiter`, `--seed` | Differential-Evolution-Steuerung |

## Modell

* Variablen: Verschiebung s_i der inneren Geraden (parallel, ±Korridor),
  Radius R_j und Überhöhung u_j (u ≤ 160 mm, 5-mm-Raster) je Bogen.
* Zielfunktion: max min_j v_j (Engpass-v), Differential Evolution + Nelder-Mead-
  Politur, warm gestartet mit der Per-Bogen-Baseline (Ergebnis nie schlechter).
* Nebenbedingungen: Abrückung ≤ Korridor (beidseitig gesampelt), Elementlängen
  ≥ 0,2·v, Rampenlängen l ≥ k·v·Δu/1000 (k = 8 Klothoide, 6 Bloss; Δu = Über-
  höhungssprung über die jeweilige Rampe), Track-Endpunkte und Richtungen fix.
* **Korbbögen** werden unterstützt: mehrere gleichsinnige Bögen (optional mit
  Zwischen-Übergangsbögen) bilden eine Gruppe mit eigenen R_i und u_i je
  Teilbogen plus freien Sweep-Aufteilungen; die Überhöhung eines Teilbogens
  darf nur steigen, wenn die Rampen auf beiden Seiten existieren. S-Bögen ohne
  Zwischengerade werden abgelehnt.

## Verifikation

```bash
.venv/bin/python tests/verify.py
```
