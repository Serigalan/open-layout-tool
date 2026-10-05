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

## Elemente verbinden (`POST /splice`)

Seit AP 12.4 rechnet der Dienst auch die Konstruktion von „Elemente verbinden"
(`olt_optimizer/splice.py`); in der App gibt es keine zweite Fassung mehr. Vier
Fälle: Bogen zwischen zwei Geraden (mit Übergangsbögen, auch ungleich lang),
zwei Bögen über eine Zwischengerade, zwei Bögen über einen einzigen
Übergangsbogen (Korb- oder S-Bogen) und ein neuer Bogen zwischen Bogen und
Gerade. Passt ein Bogen nicht auf die gewählten Elemente, nennt die Antwort den
größten Radius, der passt (`params.rMax`). Prüfung:
`WEBSITE/.venv/bin/python tools/optimizer/tests/verify_splice.py`; die
Antworten, gegen die die App testet, schreibt `tests/splice_fixture.py`.

## Trassieren aus Achspunkten (`POST /align`)

Seit AP 12.5 rechnet der Dienst aus gemessenen Achspunkten (Punktdatei oder
Messachse des Projekts, Rechtswert/Hochwert in Fahrtrichtung) eine Trassierung
(`olt_optimizer/alignment_fit.py`): Krümmungsbild aus Pfeilhöhen auf 10-m-Sehnen,
Geraden nach dem Verfahren des Auftraggebers (Fenster 6 m, 1 cm um die
Ausgleichsgerade, Schritt 0,5 m, Pfeilhöhe des Kreises < 3 mm, mindestens 20 m,
6 m Abstand — alles einstellbar), dazwischen Bögen mit Übergangsbögen über
`fit_curve_group`, R, L₁ und L₂ nach kleinsten Quadraten an die Punkte
ausgeglichen (Nelder-Mead); ein Übergangsbogen, den die Punkte nicht zeigen,
entfällt (L = 0). Beginnen oder enden die Punkte in einem Bogen, wird er vom
Tangentenpunkt der Geraden aus angepasst und am ersten bzw. letzten Punkt
geschnitten. Geraden lassen sich als Stationsbereiche vorgeben (`straights`),
dann entfällt die Suche. Passt zwischen zwei automatisch gefundenen Geraden kein
Bogen (Versatz statt Richtungsänderung), werden sie zu einer zusammengefasst und
die Stelle genannt (`merged`). Die Antwort trägt neben der Elementkette die
Krümmung und die Abweichung jedes Punkts sowie Maximum und RMS je Element; eine
Trassierung, die sich nicht bilden lässt, kommt mit `error` und dem
Krümmungsbild zurück, damit die Geraden von Hand korrigiert werden können.

Tragen die Punkte als dritten Wert eine Höhe (SO der tieferen Schiene, wie die
Punktdatei sie hat), leitet `olt_optimizer/gradient_fit.py` daraus die
Gradiente ab (`gradient`): die Punkte werden auf die gefundene Kette
stationiert und zu Höhen je Meter zusammengefasst; im Neigungsbild (Steigung
auf 15 m) sind gleichbleibende Neigungen Plateaus und Ausrundungen Rampen.
Plateaus ab 20 m bekommen eine Ausgleichsgerade, benachbarte Geraden schneiden
sich im Neigungswechsel, die Tangentenlänge der Ausrundung wird an die Höhen
ausgeglichen und als Radius gerundet (ab 2000 m auf 100 m). Kurze Neigungen
zwischen zwei Ausrundungen, die das Neigungsbild verwischt, werden gesucht, wo
die Höhen dazwischen über der Toleranz (`heightTolerance`, 2 cm) liegen. Am
Messdatensatz 5550L trifft das die Soll-Gradiente aus der GRA auf rund einen
Meter in der Lage der Neigungswechsel.

Trägt jeder Punkt als vierten Wert die Überhöhung (mm, positiv bei höherer
linker Schiene — das Vorzeichen der App), bekommt jede Gerade und jeder Bogen
den Median der Punkte darauf, ohne je 5 m an den Enden (dort läuft die Rampe),
auf 5 mm gerundet (`elementCants`). Übergangsbögen tragen keine eigene, sie
rampen zwischen ihren Nachbarn; nur ein Übergangsbogen an einem offenen Ende
beginnt oder endet mit der Überhöhung, die die Punkte dort haben
(`cantStart`/`cantEnd`).

Läuft wie ein Optimiererlauf in einem eigenen Prozess unter der Frist und den
Plätzen; rund 2 s je km mit fünf Bögen. Prüfung:
`WEBSITE/.venv/bin/python tools/optimizer/tests/verify_align.py`; die Antwort,
gegen die die App testet, schreibt `tests/align_fixture.py`.
