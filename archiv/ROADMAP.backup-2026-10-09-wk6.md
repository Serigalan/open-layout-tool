# Roadmap Open Layout Tool

Stand 2026-10-09.

**Phase 10, Mehrbenutzer und Varianten, ist gebaut und live** (2026-10-01). **Phase 11,
Punktwolke im Querschnitt, ist gebaut und live** (2026-10-02, AP 11.1–11.5; E57 als AP 11.6
und die Originalauflösung als AP 11.7 am 2026-10-05). **Phase 12,
Gleisachse aus der Punktwolke und Trassierung daraus, ist gebaut** bis auf das optionale
AP 12.6 (AP 12.1–12.5, 2026-10-05).
Daneben die kleineren Punkte unten. Alles Erledigte
steht nur als Kurzhinweis da, die vollständigen Fassungen liegen in
`archiv/ROADMAP.archiv-2026-10-01.md`. Das Entscheidungslog am Ende ist vollständig.

**Phase 13, Punktwolken auf dem Server, 3D-Ansicht und Neureferenzieren, ist gebaut und live**
(spezifiziert 2026-10-08, Entscheidungen 203–216): eine Wolke einmal hochladen und im Projekt
teilen, in 3D ansehen und über Passpunkte in das System einer anderen bringen. Teil A und der
Betrieb (AP 13.1–13.6, 13.16; Entscheidungen 220–228), die 3D-Ansicht (AP 13.8–13.11, 229–236),
die langen Läufe auf dem Server (AP 13.7, 237–238) und das Neureferenzieren (AP 13.12–13.15,
239–244) — alles am 2026-10-08. Offen: Abnahme; eine Lieferung mit RGB, um den Speicher mit Farbe
zu messen; eine echte Wolke im lokalen System.

**Paket WH, Höhen in Weichen, ist gebaut und live** (2026-10-09, AP WH.1–WH.5, Entscheidungen
256–264; offen: Abnahme): Punktpaare auf den Schwellen in beide Richtungen, Sperre je Weiche,
Begründung für Neigungswechsel in der Weiche.

**Paket RT, Routen, ist gebaut und live** (2026-10-08, AP RT.1–RT.6, Entscheidungen 248–255;
offen: Abnahme): benannte Folgen zusammenhängender Gleise, wählbar in Höhenprofil (bearbeitbar),
Querprofil und 3D-Gleissicht; die Gleissicht als Link mit Station.

**Paket V, Bestandsachse und Verschiebewerte, ist gebaut und live** (2026-10-07, Entscheidungen
193–200; offen: Abnahme).

**Paket N, bestehende Elemente neu verbinden, ist gebaut und live** (2026-10-07, Entscheidungen
186–192; offen: Abnahme): ein Stück Gleis wird durch die Konstruktion von „Zwei Gleise zusammenfügen“ ersetzt,
innerhalb einer einstellbaren Abweichung zur alten Achse und regelkonform bei einer gewünschten
Geschwindigkeit.

**Paket S, „Elemente verbinden“ robust, ist gebaut und live** (2026-10-07, AP S.1–S.7,
Entscheidungen 179–184); offen ist die Abnahme durch den Auftraggeber.

**Stand in einem Absatz.** Das Werkzeug trassiert, setzt Weichen und Kreuzungen, verbindet und
optimiert Gleise, führt Höhen, Bahnsteige und Querprofile, liest MDB, OSRD und weitere
Formate und exportiert Pläne. Optimierer, MDB-Konvertierung und Geländehöhen laufen als
Python-Dienst auf dem Server; alles andere läuft im Browser, und gespeichert wird
auf dem Projektserver: nur mit Login, Projekte mit Varianten und Revisionen, Arbeitskopie im
Browser, Einchecken und Zusammenführen (Phase 10).

| | Paket | Umfang | Status |
|---|---|---|---|
| ✓ | Produktivserver `db-ec.open-layout-tool.org` (AP P.0–P.10) | mittel | **live seit 2026-10-09** auf `prod-2026-10-09.2`; Roadmap in `/root/open-layout-tool-prod/ROADMAP.md`. Freigabe für die Produktion: `deploy/release.sh`, dort `deploy.sh --config … --ref <tag>` |
| ✓ | Höhen auf 0,1 mm (4 Nachkommastellen) | klein | gebaut und ausgerollt am 2026-10-09 (Entscheidung 265): Tabelle zeigt und nimmt 4 Stellen, Lösen/Einfügen eines Punkts, Weichenkopplung und Weichenverbindung angleichen runden auf 0,1 mm; Stationen bleiben auf mm. `heightUtils.roundHeight` |
| ✓ | Ausrundung: Länge maßgebend | klein | gebaut und ausgerollt am 2026-10-09 (Entscheidung 266): Vermerk `la` am Höhenpunkt (Regelwert-Knopf, wenn die 20 m den Ausschlag geben, oder Länge l_a in der Tabelle eingegeben); der Store rechnet R bei jeder Änderung einer angrenzenden Neigung neu. `gradientCheck.lengthGovernedRadii` |
| ✓ | Fehler: Weichenverbindung mit Weiche im Übergangsbogen | klein | behoben und ausgerollt am 2026-10-09 (Entscheidung 267): WA in einer Klothoide wurde wie eine Gerade geteilt (Sehnen, alte Radien), WE auf dem Radius am WA weitergerechnet (SBSS: 0,40 m neben dem Gleis → Querstück, Knicke ~90°). `sCurve.splitAtToe` teilt an der Station, `bentOnto` biegt die Weiche auf das Klothoidenstück (`stemRoute1/2`) |
| ✓ | Trackeditor: 3 Nachkommastellen, Spalte Vergleichsradius | klein | gebaut und ausgerollt am 2026-10-09 (Entscheidung 268): Länge und Radius zeigen 3 Stellen, beim Bearbeiten den vollen Wert; neue letzte Spalte r_w (LP.UB.01), jedes Feld auf der Linie zwischen den Zeilen der beiden Elemente, gefärbt nach den Übergangsregeln. `EditCell digits`, `boundaryScope` |
| ✓ | Paket WK · Kopplungspunkte an der ldS (AP WK.1–WK.5) | mittel–groß | spezifiziert, gebaut und ausgerollt am 2026-10-09 (Entscheidungen 269–275; WK.5: in der Weichenverbindung führt das bearbeitete Gleis); offen: Abnahme |
| ✓ | Paket WH · Höhen in Weichen (AP WH.1–WH.5) | mittel–groß | spezifiziert, gebaut und ausgerollt am 2026-10-09 (Entscheidungen 256–264); offen: Abnahme |
| ✓ | Zwei Gleise zusammenfügen: Übergangsbogen je Seite, Form je Seite | klein–mittel | gebaut und ausgerollt am 2026-10-08 (Entscheidung 247): je Abgang/Ankunft eigener Schalter, eigene Form (Klothoide/Bloss) und Länge; Dienst `transitionDep`/`transitionArr`, Regellängen je Form. `SpliceSettings.jsx`, `splice.js`, `olt_optimizer/splice.py` |
| ✓ | Höhenplan: Tabellenansicht, Station der Neigungswechsel, Vorgabe zweier Werte | mittel | gebaut und ausgerollt am 2026-10-08 (Entscheidung 246): Umschalter Grafik/Tabelle; Tabelle mit Station, Höhe, Neigung davor/danach, R, T; „Vorgegeben“ (Station + Höhe, Station + Neigung davor/danach, Höhe + Neigung davor/danach, beide Neigungen) — diese zwei sind eingebbar, die anderen folgen, Nachbarpunkte bleiben; in der Grafik Stationsfeld für einen gewählten Punkt. `ElevationTable.jsx`, `heightUtils` (`solveHeightPoint`, `pointGrades`) |
| ✓ | Phase 13 · Punktwolken auf dem Server, 3D-Ansicht, Neureferenzieren (AP 13.1–13.16) | groß | spezifiziert, gebaut und ausgerollt am 2026-10-08 (Entscheidungen 203–244); offen: Abnahme, Lieferung mit RGB zum Messen |
| ✓ | Mindestelementlänge vor WA nach der Geschwindigkeit des abzweigenden Gleises | klein | gebaut am 2026-10-08 (Entscheidung 219); Weiche auf Gleis und Weichenverbindung |
| ✓ | Weichenverbindung: gleiche Überhöhung nur an der ldS, nicht am WA | klein | gebaut am 2026-10-08 (Entscheidung 218) |
| ✓ | Weiche auf Gleis: Schieber, Mindestelementlänge vor WA | klein | gebaut am 2026-10-08 (Entscheidung 217); Schieber wie in der Weichenverbindung, rastet nur auf gültigen Stellen ein |
| ✓ | Paket V · Bestandsachse und Verschiebewerte (AP V.1–V.5) | groß | spezifiziert, gebaut und ausgerollt am 2026-10-07 (Entscheidungen 193–200); offen: Abnahme |
| ✓ | Paket N · Bestehende Elemente neu verbinden (AP N.1–N.2) | mittel–groß | spezifiziert, gebaut und ausgerollt am 2026-10-07 (Entscheidungen 186–192); offen: Abnahme |
| ✓ | Paket S · Elemente verbinden robust (AP S.1–S.7) | groß | gebaut und ausgerollt am 2026-10-07 (Entscheidungen 179–184); offen: Abnahme |
| ▶ | Phase 12 · Gleisachse aus der Punktwolke, Trassierung daraus (AP 12.1–12.5) | groß | spezifiziert am 2026-10-05 (Entscheidungen 128–138), AP 12.1–12.5 gebaut (140–143); offen: 12.6 (optional) |
| ✓ | Phase 10 · Mehrbenutzer und Varianten (AP 10.1–10.10) | groß | gebaut und ausgerollt am 2026-10-01 (Entscheidungen 87–112) |
| ✓ | Phase 11 · Punktwolke im Querschnitt (AP 11.1–11.7) | groß | gebaut und ausgerollt am 2026-10-02; E57 und Originalauflösung am 2026-10-05 nachgereicht (Entscheidungen 114–126, 144, 145) |
| — | Folgepakete Phase 10 | unklar | ~~Mitglieder je Projekt~~ (gebaut 2026-10-02, Entscheidung 127); offen: Rechte/Sperren je Variante, Planfarben aus Vergleich (99, 100) |
| ✓ | AP 9.8 · Topologie-Schema nach Streckengleisen | mittel | gebaut am 2026-10-01 (Entscheidung 113) |
| — | AP 6.3 · MDB — Restfragen | klein | gebaut, drei Fragen offen — siehe *Weitere offene Punkte* |
| ✓ | Höhenplan-Regeln Ril 800.0110 (Längsneigung, Ausrundung) | mittel | gebaut am 2026-10-06 (Entscheidungen 147–153); Katalog 0.4.0, HP.LN.01–03, HP.AR.01–05 |
| ✓ | Gekoppelte Gradiente in Weichen | mittel | gebaut am 2026-10-06 (Entscheidungen 154–158); ldS hinter WE für alle Weichenformen im Katalog 0120 (0.3.1) |
| ✓ | Weichenverbindung im Bogen angleichen | mittel | gebaut am 2026-10-06 (Entscheidungen 159–163); Weichendialog fragt nach dem Anlegen, Höhenprofil-Panel listet alle Weichenverbindungen |
| ✓ | ABW mit geradem Zweig als EW mit getauschten Gleisen | mittel | gebaut am 2026-10-06 (Entscheidungen 164–165); in allen drei Weichendialogen, Weichenverbindung erkennt und gleicht sie an |
| ✓ | Querprofil: Gleis aus der Liste öffnet das Overlay; ab 1 m vor dem Gleisende die anschließenden Gleise | klein | gebaut am 2026-10-06; über Stoß, Link und die Fahrwege einer Weiche (`tracksOnFrom`), ◀/▶ wechselt bei nur einem Gleis von selbst |
| ✓ | Weichenverbindung hält die Mindestelementlänge | mittel | gebaut am 2026-10-06 (Entscheidung 166); dabei behoben: der Dialog las den Klick als Station im Gleis statt im Element |
| ✓ | Elemente verbinden: Gleisabstand halten, größter Radius | groß | gebaut am 2026-10-06 (Entscheidungen 167–169); Dienst `clearance.py`, braucht das Ausrollen des Optimierdienstes |
| ✓ | Weichenverbindung: WA auf den Elementwechsel, Gleisnamen im Dialog | klein | gebaut am 2026-10-06 (Entscheidung 170); Schieber misst WA ab dem Elementwechsel und erreicht ihn exakt |
| ✓ | Gradiente beim Teilen in einer Ausrundung | klein | behoben am 2026-10-06: ein Schnitt (WA einer Weiche, gelöschtes Element) in einer Ausrundung teilt sie mit, jede Hälfte behält ihr Stück der Parabel (vorher Stufe bis 0,59 m im Projekt SBSS); Zusammenfügen macht sie wieder eins |
| ✓ | Elemente verbinden übernimmt beide Gradienten | klein | gebaut am 2026-10-06 (Entscheidung 171) |
| ✓ | Höhenprofil: Station unter dem Mauszeiger auf der Karte | klein | gebaut am 2026-10-06; Punkt auf dem Gleis, Linie mit Station und Höhe im Profil |
| ✓ | Elemente löschen: mehrere auf einmal, Höhenpunkt an jedem Schnitt | klein | gebaut am 2026-10-06 (Entscheidung 172) |
| ✓ | Höhenprofil: Ausrundung nach Regelwert | klein | gebaut am 2026-10-07 (Entscheidung 174); Knopf „Regelwert“ neben R, für alle gewählten Punkte |
| ✓ | Übergangsbögen: folgen dem Radius im Trackeditor; Prüfung, Regel- und Mindestlänge beim Verbinden | mittel | gebaut am 2026-10-07 (Entscheidungen 175–177); „Gerade/Bogen verbinden“ und „Zwei Gleise zusammenfügen“, jede Längenregel mit Formel und Wert unter den Knöpfen |
| ✓ | Zusammenfügen: Regellänge einmalig gesetzt, kleine Längenknöpfe mit maßgebender Regel, Längen auch ohne Lösung | klein | gebaut am 2026-10-07 (Entscheidung 185) |
| ✓ | Zusammenfügen: Abgang ist das Element, dessen Ende zur Lücke zeigt | klein | behoben am 2026-10-07 (Entscheidung 178); umgekehrt geklickt fand der Dienst keine Lösung (SBSS) |
| — | Gleichartige Elemente zusammenfassen | unklar | Idee vom 2026-09-22, nicht spezifiziert |

---

## Paket WK — Kopplungspunkte an der ldS

*Vom Auftraggeber gewünscht am 2026-10-09: „Bei der ldS die Punkte sollen nicht zu löschen sein. Aber
die sollen mit einem anderen Punkt auf dem Track gekoppelt werden. Dieser Punkt wird in der
Fortführung der Gradiente festgelegt. Bei diesem Punkt kann deszufolge nur die Stationierung und eine
Gradiente angepasst werden. Das funktioniert bei Weichenverbindungen teilweise nicht. Daher werden bei
Weichenverbindungen diese Punkte an den Weichenanfangspunkt gekoppelt.“ Im selben Gespräch in vier
Rückfragen geklärt (Entscheidungen 269–274).*

**Ziel.** Kein Neigungswechsel an WA und ldS einer Weiche: die Punkte dort sind keine Eingabe mehr,
sondern folgen aus Punkten außerhalb der Weiche. Bearbeitet wird vor dem WA und hinter der ldS.

**ldS-Punkte** (Entscheidung 269). Stamm- und Zweiggleis haben **immer** einen Punkt an der ldS. Beide
sind **nicht löschbar und nur Anzeige** (Höhe, Station, Ausrundung): der im Stammgleis liegt auf der
Geraden des Stammgleises (270), der im Zweiggleis (PZ_lds) auf der Weichenebene über ihm (257).

**Stammgleis** (Entscheidung 270). Q ist der letzte Punkt vor dem WA, P der erste hinter der ldS.
**WA und ldS liegen auf der Geraden Q → P**, zwischen allen vier Punkten dieselbe Neigung; Q und P
sind normale Punkte. Allgemein: jeder WA- und ldS-Punkt liegt auf der Geraden zwischen dem nächsten
freien Punkt davor und dahinter entlang des Fahrwegs (Zulauf → Stammgleis → über den WA der nächsten
Weiche weiter), auch über mehrere dicht folgende Weichen. Ein Paarpunkt zwischen WA und ldS (mit
Begründung, 261) ist ein freier Punkt und teilt die Gerade. Gibt es vor dem WA keinen Punkt (offenes
Ende, nicht gekoppelte Weiche), ist der WA selbst frei.

**Zweiggleis** (Entscheidung 271). WA vom Stammgleis, PZ_lds aus der Ebene. **PZN_lds**, der erste
Punkt hinter der ldS, liegt auf der **Fortführung** der Gradiente, mit der das Zweiggleis in die ldS
läuft. Eingebbar sind nur seine **Station** und die **Neigung danach** — der nächste Punkt bleibt, so
bestimmt jede die andere (Schnitt der Fortführung mit der Geraden zum nächsten Punkt); die Höhe ist
Anzeige. Gibt es bis zum Gleisende keinen Punkt, ist das Gleisende PZN_lds; ist es der **WA der
nachfolgenden Weiche**, steht dieser WA damit fest, und deren Stammgleis läuft auf derselben
Fortführung bis zu seinem P (das dann wie PZN_lds nur Station und Neigung danach hat).

**Weichenverbindung** (Entscheidung 272; das Verbindungsgleis ist Zweig beider Weichen). Liegen
**mehr als 20 m** zwischen den beiden ldS, gibt es dort **genau einen Punkt M**, Kopplungspunkt beider
Weichen: der Schnitt der beiden Fortführungen, nur Anzeige; schneiden sie sich nicht zwischen den ldS,
gibt es keinen, und die Gradiente läuft gerade von ldS zu ldS. Bei **20 m oder weniger** (auch bei
Überlappung, 264) gibt es keinen Punkt dazwischen: die **führende Weiche** — deren Stammgleis im
Projekt zuerst kommt — legt mit ihrer Fortführung den **WA der anderen** fest, und die Gerade Q₂ → P₂
des anderen Stammgleises wird **parallel verschoben**, bis sie durch diesen WA geht (Q₂ und P₂ ändern
ihre Höhe um dasselbe Maß).

**Wer führt** (Entscheidung 275, nachgetragen am selben Tag; ersetzt in 272 „Stammgleis im Projekt
zuerst“). *Auftraggeber: „Wenn ich eine Weichenverbindung habe und die Höhen im Stammgleis ändere,
soll im Zweiggleis alles mitgezogen werden und auch bei der folgenden Weiche … dann das Nachbargleis
zu dem manuell geänderten Gleis.“* Es führt die Weiche, **deren Seite das Schreiben geändert hat**:
ein Punkt der Geraden durch ihren WA (von Q bis P, über welche Gleise der Fahrweg auch läuft) oder ihre
eigenen Punkte im Verbindungsgleis zwischen WA und ldS. Die andere folgt: ihr WA auf der Fortführung,
Q₂ und P₂ um dasselbe Maß. Hat das Schreiben **keine oder beide** Seiten geändert (Geometrie, „Weichen
jetzt koppeln“, ein Punkt weit weg), führt die Weiche, die den WA der anderen **schon festlegt** — so
bleibt ein von Hand geführter Zustand stehen; legt keine oder beide ihn fest, die mit dem Stammgleis
im Projekt zuerst. Über 20 m bleibt es bei M (272), dort führt keine. Eigene Annahmen: zwei
Weichenverbindungen auf denselben beiden Gleisen (PEK switch.010/011 und 012/013 teilen sich über
track.001 ein Q) — ein freier Punkt, an dem zwei geführte Geraden enden, bleibt stehen, beide Geraden
drehen um ihn; bis zu 24 Durchgänge statt 6, weil sich die Änderung im Ring erst nach mehreren
Durchgängen beruhigt.

**Sperre entfällt** (Entscheidung 273, ersetzt 260). Checkbox, Ablehnung im Speicher und die Meldung
der gesperrten Weiche fallen weg; `heightsLocked` in bestehenden Projekten wird nicht mehr gelesen.

**Bestehende Projekte** (Entscheidung 274). Beim nächsten Schreiben an einer Weiche oder mit „Weichen
jetzt koppeln“ gelten die neuen Regeln; Höhen ändern sich dabei, Kompatibilität ist nicht verlangt.

**Fehler, mit WK.5 behoben.** Bei überlappenden Weichenverbindungen (der Regelfall: PEK switch.010/011,
012/013) gab die führende Weiche nichts weiter — die ldS-Station, auf mm gerundet, lag knapp hinter
der letzten Schwelle, die Ebene gab dort keine Höhe (`switchGradient.ldsPlaneHeight` nimmt jetzt die
Schwelle selbst). Und M über 20 m sprang zwischen den beiden Weichen um 0,1 mm hin und her (Höhe an
der gerundeten Station statt am Schnitt), sodass Koppeln nie zur Ruhe kam.

**Wie gebaut.** `utils/switchChain.js`: ein Index der gekoppelten Weichen aus der Geometrie (Stoßenden
am WA, ldS-Stationen, Zweige), daraus die Rolle jedes gespeicherten Punkts (WA, ldS, Ebene, frei). Eine
„Kette“ läuft von einem WA- oder ldS-Punkt in beide Richtungen über gebundene Punkte bis zum nächsten
freien Punkt, über den WA einer Weiche vom Zulauf ins Stammgleis und zurück; ein WA, den man über
einen Zweig erreicht, ist ein fester Endpunkt (sonst gehörte er zwei Geraden). Endet sie an der
ldS eines Zweigs, von hinten erreicht, trägt sie dessen Fortführung, und ihr freies Ende rückt darauf.
Die Fortführung nimmt den letzten gespeicherten Punkt mindestens 2 m vor der ldS (ein Paarpunkt 0,2 m
davor gab in PEK bei Überlappung 26 m Höhenfehler). `coupleSwitchHeights` je Weiche: Paare (Zweig
führend), ldS-Punkt im Stammgleis, Geraden durch WA und ldS, Paare (Stammgleis führend), Zweig hinter
der ldS; die führende Weiche einer Weichenverbindung ≤ 20 m lässt die andere danach noch einmal
koppeln; wiederholt, bis sich nichts mehr ändert (höchstens 6 Durchgänge). Bei Überlappung (264)
bekommt die Weiche, deren ldS-Schwelle in der anderen liegt, auch im Stammgleis keinen ldS-Punkt.
`heightRoles` sagt Profil und Tabelle, was gesperrt und was Fortführung ist; `pendingTurnouts` zählt,
was „Weichen jetzt koppeln“ ändern würde. PEK Vorlage (13 Weichen): 41 Punkte ändern sich, größte
Änderung 2,54 m an switch.008/009 (der nächste freie Punkt vor den beiden dicht folgenden WA liegt
2,4 km zurück), Fortführung hinter switch.009 +1,47 m; ein zweiter Lauf ändert nichts. PEK Bestand
(69 Weichen): erster Lauf 0,55 s, danach 30–40 ms. Im Browser geprüft (Vorlage): Rollen als Hinweis an
jedem Punkt, ldS nur Anzeige, M der Weichenverbindung switch.003/004 nur Station/Höhe als Anzeige und
nicht löschbar, Fortführungspunkt hinter switch.009 per Station (Höhe folgt) und Neigung danach (rückt
an den Schnitt) verschoben, Tabelle gibt nur diese beiden frei.

### Arbeitspakete

| AP | Inhalt | Ort |
|---|---|---|
| WK.1 ✓ | Kopplungsmodell: Rollen der Punkte (WA, ldS, Fortführung, M), Geraden über Weichen hinweg, Fortführung im Zweig, Weichenverbindung (M bzw. führende Weiche und Parallelverschiebung), ldS-Punkte in beiden Gleisen; im Speicher nach jedem Schreiben; Tests | `utils/switchGradient.js`, `utils/switchChain.js`, `storage.js` |
| WK.2 ✓ | Sperre entfernen (Checkbox, Speicher, Profil, Prüfung, Texte) | `storage.js`, `EditElementPanel/`, `ElevationOverlay.jsx`, `GradientFindings.jsx` |
| WK.3 ✓ | Höhenprofil und Tabelle: gekoppelte Punkte nur Anzeige und nicht löschbar, Fortführungspunkte mit Station und Neigung danach, Hinweise | `ElevationOverlay.jsx`, `ElevationTable.jsx` |
| WK.4 ✓ | „Weichen jetzt koppeln“ und Befunde nach dem neuen Modell; Browserprüfung an PEK Bestand; ausrollen | `ElevationPanel.jsx`, `GradientFindings.jsx` |
| WK.5 ✓ | Weichenverbindung: das bearbeitete Gleis führt, die andere Weiche und ihr Gleis folgen (275); ldS-Ebene bei Überlappung, M am Schnitt, Ring zweier Verbindungen; Tests (synthetisch und alle kurzen Verbindungen in PEK Vorlage) | `utils/switchChain.js`, `utils/switchGradient.js` |

---

## Paket WH — Höhen in Weichen

*Vom Auftraggeber gewünscht am 2026-10-09: „Man darf in Weichen auch einen Ausrundungsradius setzen,
muss dann nur eine Begründung geben. Außerdem soll man auch im Zweiggleis einer Weiche die
Höhenpunkte verändern können. Dann muss aber auch immer das Stammgleis der Weiche mitgeführt werden.
Wird ein Punkt bei einer Weiche zwischen WA und ldS gesetzt, dann muss dieser Punkt an der gleichen
Stelle im anderen Gleis erzeugt werden.“ Geklärt am selben Tag: **beide Richtungen** gleichberechtigt,
eine **Checkbox zum Sperren** der Höhen einer Weiche, und die **Schwellenlage** als „gleiche Stelle“
(Entscheidungen 256–264).*

**Ziel.** Stamm- und Zweiggleis einer Weiche liegen von WA bis zur ldS auf einer Ebene (Entscheidung
154). Bisher führte nur das Stammgleis, der Zweig war dort gesperrt, und die „gleiche Stelle“ war die
rechtwinklige Schwelle zum Stammgleis. Jetzt sind beide Gleise eingebbar, jeder Höhenpunkt im
Weichenbereich hat einen Partner auf derselben Schwelle im anderen Gleis, Neigungswechsel und
Ausrundungen in der Weiche lassen sich begründen, und die Höhen einer Weiche lassen sich sperren.

**Schwellenlage** (Entscheidung 256). Bezugslinie ist die **Winkelhalbierende**: die Linie, deren
Punkte von Stamm- und Zweiggleisachse gleich weit entfernt sind. Am WA fällt sie mit dem Stammgleis
zusammen, am WE läuft sie in Richtung der Halbierenden des Weichenwinkels, bei der symmetrischen
Weiche ist sie die Symmetrieachse. Schwelle k liegt bei **s_k = 0,3 + 0,6 · k** entlang dieser Linie
ab WA und steht **rechtwinklig zu ihr an ihrer Stelle**; wo sie die Gleisachsen schneidet, liegen die
beiden Punkte eines Paars. Die **ldS** bleibt, wo der Katalog sie hat (WE + `lds` entlang des
Stammgleises): die Schwelle durch diesen Stammgleispunkt, rechtwinklig zur Winkelhalbierenden dort;
das Raster endet mit der letzten Schwelle davor. Es gibt keine Einstellungen, und nichts davon wird
gespeichert — die Schwellen werden aus der Geometrie abgeleitet (`utils/switchSleepers.js`).

**Höhe über die Schwelle** (Entscheidung 257). Die Schwelle ist eine Gerade in der örtlichen Ebene
der Weiche am Fußpunkt P im Stammgleis: **z_Q = z_P + g · a + u/1500 · y**, mit g der Längsneigung
des Stammgleises in P, u seiner Überhöhung, a und y den Anteilen von P→Q längs und quer zum
Stammgleis. Bei rechtwinkliger Schwelle ist a = 0, das ist Entscheidung 154. Der Anteil g · a bleibt
unter 1 mm; die schräge Schwelle zählt vor allem für die Lage des Partners (EW 500-1:12: rund 5 cm
am WE).

**Punktpaare** (Entscheidung 258). Jeder Höhenpunkt im Weichenbereich (hinter WA bis zur ldS) sitzt
auf einer Schwelle und hat auf derselben Schwelle im anderen Gleis einen Partner. Ein Punkt, der
dort gesetzt oder hin verschoben wird, rastet auf die nächste Schwelle ein (höchstens 0,3 m); der
Partner entsteht mit der Höhe aus der Ebene. Höhe, Ausrundung, Begründung, Verschieben und Löschen
wirken auf beide. Das Zweiggleis hat immer einen Punkt an der ldS (wie bisher); das Stammgleis nur,
wo er gebraucht wird. Tangentenpunkte von Ausrundungen müssen nicht auf Schwellen liegen.

**Wer führt** (Entscheidung 259). **Beide Gleise sind eingebbar.** Nach jedem Schreiben stellt der
Speicher fest, welches Gleis einer Weiche sich geändert hat: hat sich nur das Zweiggleis geändert,
führt es, und das Stammgleis folgt; in allen anderen Fällen führt das Stammgleis — auch wenn sich
Lage oder Überhöhung geändert haben. Das führende Gleis bestimmt, welche Schwellen Punkte tragen;
das andere bekommt dieselben, mit Höhen aus der Ebene, im selben Rückgängig-Schritt. In
Weichenstraßen wird weitergereicht (der Zweig der einen ist das Stammgleis der nächsten), jede
Weiche einmal je Schreiben.

**Sperren** (Entscheidung 260). Checkbox **„Höhen der Weiche sperren“** (`heightsLocked` an der
Weiche) unter Bearbeiten › Weiche und im Höhenprofil, sobald ein Punkt im Weichenbereich gewählt ist.
Gesperrt sind alle Punkte vom WA (dem Stoß) bis zur ldS in beiden Gleisen: im Profil und in der
Tabelle nicht eingebbar, und ein Schreiben, das sie trotzdem ändern würde (etwa über den Stoß eines
Nachbargleises, Verschiebewerte, Weichenverbindung angleichen), lehnt der Speicher ab und sagt
welche Weiche. Lage und Überhöhung bleiben änderbar; die Höhen stehen dann, und die Prüfung meldet
**„Weichenebene verletzt“** mit der Abweichung an jeder Schwelle.

**Begründung** (Entscheidung 261). Ein Neigungswechsel im Weichenbereich (Punkt oder Ausrundung, die
hineinreicht) bleibt erlaubt; HP.AR.06 warnt, bis am Punkt eine **Begründung** steht (`reason` am
Höhenpunkt, ein Text je Paar, auf den Partner gespiegelt). Mit Begründung ist er „begründet“ und
keine Warnung mehr; Höhenprofil und Bänder zeigen die Begründung beim Neigungswechsel (der
Planexport hat keinen Höhenplan).

**Ausrundung unter dem Regelwert** (Entscheidung 262). In der Weiche ist ein Ausrundungshalbmesser
unter dem Regelwert (Tabelle 12) ein **Fehler**, den keine Begründung behebt (HP.AR.07 neu) — die Ril
lässt Ausrundungen in Weichen nur mit r_a ≥ Regelwert zu.

**Überlappende Weichenbereiche** (Entscheidung 264). Reichen zwei Weichen von beiden Enden in ein
Gleis und überlappen sich ihre Bereiche (das Verbindungsgleis einer Weichenverbindung, zwischen den
beiden ldS), tragen die langen Schwellen dort alle drei Gleise. Jede Weiche behält ihr Raster bis zur
Mitte der Überlappung; jede Schwelle darin koppelt das gemeinsame Gleis an das andere Gleis beider
Weichen, eine Eingabe auf einem der drei nimmt die beiden anderen mit.

**Bestehende Projekte** (Entscheidung 263). Punkte im Weichenbereich, die nicht auf einer Schwelle
liegen, rasten beim nächsten Schreiben an der Weiche (oder mit „Alle Weichen koppeln“) auf die
nächste Schwelle ein, die Höhe bleibt; die ldS-Punkte rücken auf die schräge Schwelle (wenige cm).

**Wie gebaut.** `utils/switchSleepers.js` verfolgt die Winkelhalbierende ab WA in Schritten von
1 m (Richtung = Mittel der beiden Gleistangenten an den Fußpunkten, nach jedem Schritt auf gleichen
Abstand zurückgesetzt) und liest Schwellen, ldS und die Schwelle durch einen beliebigen Gleispunkt aus
diesen Stützpunkten; gegen die geschlossene Lösung (Parabel zwischen Gerade und Kreis) auf < 1 mm
geprüft. Zwischengespeichert je Weiche und Gleisgeometrie (die Höhen ändern sie nicht); PEK Bestand,
68 Weichen: 0,44 s beim ersten Öffnen. `switchGradient.js`: `switchCouplings` gibt jeder Kopplung ihr Raster bis zur
Mitte einer Überlappung und dahinter die Schwellen der Nachbarweiche durch ihren eigenen Rahmen gelegt
(„Gastschwellen“, 264), `pairedHeights(c, leader)` legt die Paare, `coupleSwitchHeights(before, after)` im
Speicher erkennt das führende Gleis und reicht über geänderte Gleise weiter;
`lockedHeightsChanged` vergleicht die gebauten Höhen an WA und jeder Schwelle samt der gespeicherten
Punkte, `planeDeviations` meldet > 1 mm. Eine abgelehnte Änderung ist ein Schritt der Art „refused“
im Hinweis über der Karte. Katalog 0.6.0: Kontext `justified`, HP.AR.06 mit Begründung „ok“,
HP.AR.07 neu. Im Browser geprüft an PEK Halle–Könnern (Vorlage): Einfügen per Doppelklick im
Zweig → Partner im Stammgleis auf derselben Schwelle, ein Rückgängig für beide; ldS des Zweigs
+50 mm → Stammgleis bekommt dort einen Punkt; Sperre per Checkbox (Profil und Bearbeiten), Ablehnung
mit Hinweis; Begründung im Profil → auf beiden Punkten, HP.AR.06 weg, Marke in den Bändern.

### Arbeitspakete

| AP | Inhalt | Ort |
|---|---|---|
| WH.1 ✓ | Schwellenmodell: Winkelhalbierende, Raster 0,3 + 0,6 · k, ldS-Schwelle, Fußpunkte und Stationen in beiden Gleisen, nächste Schwelle, Höhe über die Schwelle; die Kopplung rechnet damit statt mit der rechtwinkligen Schwelle; Tests | `utils/switchSleepers.js`, `switchGradient.js` |
| WH.2 ✓ | Punktpaare in beide Richtungen: führendes Gleis erkennen, Einrasten, Partner anlegen/verschieben/löschen, Höhe, Ausrundung und Begründung spiegeln, Weichenstraßen; Profil und Tabelle geben die Zweigpunkte frei, zeigen „Schwelle k“ | `switchGradient.js`, `storage.js`, `ElevationOverlay.jsx`, `ElevationTable.jsx` |
| WH.3 ✓ | Sperre: `heightsLocked`, Checkbox unter Bearbeiten › Weiche und im Höhenprofil, Ablehnen im Speicher mit Hinweis, Prüfung „Weichenebene verletzt“ | `storage.js`, `EditElementPanel/`, `gradientCheck.js` |
| WH.4 ✓ | Begründung am Höhenpunkt, HP.AR.06 mit Begründung, HP.AR.07 (Regelwert in der Weiche), Plan | `db-ril-800-0110.json`, `gradientCheck.js`, `ElevationOverlay.jsx`, Plan |
| WH.5 ✓ | Überlappung bei Weichenverbindungen: drei Gleise auf den gemeinsamen Schwellen (Entscheidung 264, korrigiert) | `switchGradient.js` (`reach`, `slots`, Gastschwellen), `ElevationOverlay.jsx` |

---

## Paket RT — Routen

*Vom Auftraggeber gewünscht am 2026-10-08: „Ich brauche unter Bearbeiten nun die Möglichkeit Routen
zu erstellen. Das ist die Kombination von verschiedenen Tracks, die zusammenhängen. Diese kann man
dann zum Beispiel beim Querprofil oder beim Höhenprofil auswählen. Außerdem soll man die auch beim
3D-Viewer auswählen können. Beim 3D-Viewer soll es auch die Möglichkeit geben, die Gleissicht mit
einem bestimmten Meter in dem Link weiterzugeben.“ Geklärt am selben Tag: das Höhenprofil einer
Route ist **bearbeitbar**, das Querprofil blickt **in Routenrichtung** (Entscheidungen 248–255).*

**Ziel.** Eine **Route** ist eine benannte Folge zusammenhängender Gleise — über Stöße, Links und
die Fahrwege von Weichen — mit einer eigenen Stationierung ab 0 in ihrer Richtung. Sie wird unter
Bearbeiten angelegt und ist überall wählbar, wo heute ein Gleis entlang abgegangen wird:
Höhenprofil, Querprofil, Gleissicht im 3D-Fenster. Die Gleissicht lässt sich als Link an einer
Station weitergeben.

**Datenmodell** (Entscheidung 248). Neue Sammlung `routes` im Projekt, im Merge ein ganzes Objekt:

```
{ id, name, trackIds: [id, …] }      // in Fahrtrichtung der Route
```

Die Richtung jedes Gleises in der Route wird **nicht gespeichert**, sondern beim Lesen aus den
Anschlüssen bestimmt (welches Ende von Gleis i an Gleis i+1 anschließt, `tracksOnFrom`); eine Route
aus einem einzigen Gleis läuft in dessen Richtung. So bleibt sie richtig, wenn ein Gleis umgedreht
wird. Zwei aufeinanderfolgende Gleise ohne Anschluss: die Route ist **unterbrochen** — sie wird
weiter gezeigt, die Lücke benannt, und das Bearbeiten bietet an, sie zu schließen.

**Gleise, die es nicht mehr gibt** (Entscheidung 249). Teilt eine Änderung ein Gleis der Route
(Weiche gesetzt, Element gelöscht) oder legt sie es mit einem anderen zusammen, ersetzt der
Speicher es **im selben Schritt** durch die Gleise, die jetzt dort liegen, in der Reihenfolge
längs des alten Gleises (Geometrie, wie `merge/remap.js` Bahnsteige trägt); ebenso beim
Zusammenführen von Varianten. Wird ein Gleis ganz gelöscht, fällt es aus der Route, und sie ist
dort unterbrochen.

**Anlegen** (Entscheidung 250). Bearbeiten › Route › „Routen“: Liste mit Name, Länge, Anzahl Gleise,
Zustand; Neu, Umbenennen, Gleise neu wählen, Umkehren, Löschen, auf der Karte zeigen. Gewählt wird
auf der Karte, Gleis für Gleis in Fahrtrichtung; liegt ein geklicktes Gleis nicht am Ende der
bisherigen Route, wird der **kürzeste zusammenhängende Weg** dorthin ergänzt (über die Fahrwege
der Weichen, nicht über den Herzstückwinkel hinweg). „Letztes entfernen“ nimmt das zuletzt
gewählte Stück wieder weg. Die Route wird in der Karte als breite Linie mit Richtungspfeil
gezeigt.

**Höhenprofil** (Entscheidung 251). In der Gleisliste des Höhenprofils stehen die Routen oben. Das
Profil einer Route ist dasselbe Overlay wie für ein Gleis — ein Gleis ist eine Route aus einem
Stück: Höhenpunkte aller Gleise über der Routenstation, an einem Anschluss ein Punkt, Neigungen,
Ausrundungen und ihre Überschneidungen über die Gleisgrenzen hinweg, Gleisgrenzen als
beschriftete Linien. **Bearbeiten** wie bisher; jede Änderung landet im Gleis, dem der Punkt
gehört (an einem Anschluss in allen, wie heute). Ein Punkt verschiebt sich nur innerhalb seines
Gleises, ein Doppelklick fügt ihn in das Gleis an dieser Stelle ein; an einem Gleisübergang
bleibt die Station fest (wie heute an einem Gleisanschluss), Höhe, Neigungen und Ausrundung
sind eingebbar. Die Regelprüfung läuft je Gleis wie heute
und wird auf die Route abgebildet; die Bestandsachse wird gegen die ganze Route gelegt.

**Querprofil** (Entscheidung 252). Gleis oder Route wählbar; mit einer Route läuft der Schieber
über die ganze Route, ◀/▶ gehen über die Gleisgrenzen ohne Rückfrage. Wo die Route ein Gleis gegen
seine Richtung befährt, wird das Bild **gespiegelt**: links bleibt links in Fahrtrichtung der
Route. Die Station, die das Querprofil an andere Fenster meldet (Höhenprofil, 3D), bleibt
Gleis + Station; die Route kommt dazu.

**3D-Fenster** (Entscheidung 253). In der Gleissicht stehen Routen neben den Gleisen; die Gleissicht
einer Route geht durchgehend über ihre Gleise, der Schieber über die Routenstation. Die Routen
kommen mit dem Projekt aus dem Hauptfenster bzw. aus dem eingecheckten Stand.

**Link mit Station** (Entscheidung 254). Die Adresse des 3D-Fensters kann eine Gleissicht tragen:
`walk=route:<id>` oder `walk=track:<id>`, `at=<Station>` und, damit das Bild dasselbe ist,
Blickrichtung, Neigung, Querversatz und Augenhöhe. „Link zu dieser Stelle kopieren“ in der
Gleissicht gibt die Adresse für Projektmitglieder; bei den Freigabelinks (Entscheidung 214) kann
„an der aktuellen Gleissicht öffnen“ angehakt werden. Geöffnet stellt sich das Fenster dorthin,
sobald Gleise und Wolke geladen sind; fehlt Gleis oder Route im Stand, öffnet es wie bisher und
sagt es.

**Rechte** (Entscheidung 255). Routen sind Projektdaten wie Gleise: anlegen darf, wer die Variante
bearbeiten darf; sie gehen mit Einchecken, Zusammenführen und Rückgängig.

**Wie gebaut.** `utils/routes.js` löst eine Route über `tracksOnFrom` auf (Teile mit Richtung,
Versatz, Länge, Lücken), findet den kürzesten Weg (Dijkstra über Gleisenden, Kosten = Gleislänge)
und ersetzt verschwundene Gleise geometrisch (`piecesAlong`: alle 5 m und an der Mitte jedes
Kandidaten), in `mutate` und in `carryReferences`. Das Höhenprofil arbeitet immer auf
`routeProfile` (ein Gleis = Route aus einem Stück); die Tabelle löst entlang der Route und schreibt
über `writePoint` in das Gleis des Punkts. Das Querprofil dreht in Gegenrichtung die Blickrichtung
des Schnitts um 180° (Wolke, Gelände, Nachbargleise, Schienenerkennung folgen von selbst; die
Lichtraumprüfung spiegelt die Wolkenpunkte zurück in den Gleisrahmen). Das 3D-Fenster setzt die
Abtastungen der Gleise zur Route zusammen (`routeSamples`, Querneigung in Gegenrichtung
gespiegelt); die Adresse trägt `walk`, `at`, `yaw`, `pitch`, `across`, `h`. Geprüft im Browser an
PEK Bestand (Route über drei Gleise, alle gegen ihre Richtung) und an 5550 L geteilt in zwei Gleise
mit der Wolke 5550R km 4: Mitglieder- und Freigabelink (ohne Anmeldung) öffnen an derselben
Station.

### Arbeitspakete

| AP | Inhalt | Ort |
|---|---|---|
| RT.1 ✓ | Datenmodell: `utils/routes.js` (auflösen, Richtung, Lücken, Station ↔ Gleis + Station, kürzester Weg, Ersetzen durch Geometrie), Speicher mit Reparatur in `mutate`, Merge-Sammlung und `carryReferences`, Validator, Schrittname, `useRoutes`; Tests | `src/utils`, `storage.js` |
| RT.2 ✓ | Bearbeiten › Routen: Liste, Anlegen per Karte mit Ergänzen des Wegs, Umbenennen, Umkehren, Löschen, Kartenanzeige | `EditElementPanel/RoutesForm.jsx` |
| RT.3 ✓ | Querprofil entlang einer Route, gespiegelt in Gegenrichtung | `CrossSectionOverlay.jsx`, `CrossSectionPanel.jsx` |
| RT.4 ✓ | Höhenprofil einer Route, bearbeitbar; Gleisprofil als Route aus einem Stück (`utils/routeProfile.js`), Tabelle | `ElevationOverlay.jsx`, `ElevationTable.jsx`, `ElevationPanel.jsx` |
| RT.5 ✓ | 3D-Gleissicht entlang einer Route | `cloud3d/` |
| RT.6 ✓ | Link mit Station: Adresse lesen und schreiben, Knopf in der Gleissicht, Freigabelink | `cloud3d/channel.js`, `Cloud3dApp.jsx`, `SharePanel.jsx` |

---

## Phase 13 — Punktwolken auf dem Server, 3D-Ansicht, Neureferenzieren

*Vom Auftraggeber gewünscht und geklärt am 2026-10-08 (Entscheidungen 203–216). Teil A
(AP 13.1–13.6) und Teil D (AP 13.16) gebaut am 2026-10-08 (Entscheidungen 220–228, je AP ein
Commit), Teil B (AP 13.8–13.11) am selben Tag (Entscheidungen 229–236), AP 13.7 und Teil C
(AP 13.12–13.15) ebenso (Entscheidungen 237–244). Offen: Abnahme; eine Lieferung mit RGB, um den
Speicher mit Farbe zu messen; eine echte Wolke im lokalen System.*

**Ziel.** Eine Punktwolke wird **einmal hochgeladen** und steht dann **allen Mitgliedern des
Projekts** zur Verfügung — im Querprofil, in einer **3D-Ansicht** und für die
**Neureferenzierung**: über Passpunkte wird eine Wolke in das System einer anderen gebracht.
Bearbeiten dürfen nur der Admin und Nutzer mit dem Recht dazu. Der lokale Import ohne Server
bleibt mit allem, was er heute kann.

**Vorgaben** (Auftraggeber, 2026-10-08):

1. Geteiltes Arbeiten: eine Wolke auf dem Server, für alle Mitglieder des Projekts (Entscheidung 203).
2. Lokale Funktionen bleiben bestehen (Entscheidung 204).
3. RGB wird gebraucht (Entscheidungen 207, 215).
4. Eine Lieferung hat rund 500 MB, ein Projekt rund 5 km.
5. Alles, was Punktwolken ändert, dürfen nur der Admin und berechtigte Nutzer (Entscheidungen 203, 216).

**Warum Passpunkte nicht nur im Querprofil.** Eine Scheibe von ±5 cm zeigt quer und Höhe, aber
nicht die Lage längs: ein Schienenkopf sieht in ihr gleich aus, ob die zweite Wolke 30 cm längs
verschoben ist oder nicht. Paare aus Querprofilen an mehreren Stationen (50–200 m auseinander)
bestimmen Verschiebung quer, Höhe und Drehung; die Längsverschiebung auf einer Geraden nur ein
punktförmiger Gegenstand (Mast, Signal, Bahnsteigende), gewählt in 3D. Daher die 3D-Ansicht vor
der Neureferenzierung.

**Warum die Ansicht nicht auf dem Server gerechnet wird.** Der Server hat keine Grafikkarte
(6 Kerne, 11 GB, mit OSRD geteilt), jede Kamerabewegung ginge über das Netz, und die Last wüchse
mit jedem Nutzer. Der Server hält und bereitet die Daten auf und rechnet lange Läufe; gezeichnet
und geschnitten wird im Browser.

**Gemessen am 2026-10-08** an `5550L_00000500_DB_Ref.laz` (571 MB, 224,5 Mio. Punkte, 489 m
Gleis, kein RGB), Querprofile alle 10 m entlang der Messachse der Datei:

| | 2-cm-Voxel | Original |
|---|---|---|
| Punkte behalten | 39,9 Mio. (18 %) | 224,5 Mio. |
| Kacheln je Lieferung | 142 MB | 790 MB |
| Import in Node | 6 min | 12 min |
| Gelesen je Querprofil (Median, Spanne) | 0,75 MB (0,4–1,3) | 3,9 MB (2,2–12,7) |
| Punkte in der ±5-cm-Scheibe | 7 200 (4 400–12 100) | 40 000 (20 000–181 000) |
| Kacheln je Querprofil (±10 und ±20 m) | 10 (7–23) | 10 (7–23) |

Die Scheibe selbst ist klein (~60 kB); übertragen werden die 2 × 2 m großen Kacheln, durch die
sie läuft — beim Weiterschalten etwa alle 2 m neue. Eine gleisweite Prüfung über 5 km läse
1,5 GB (Voxel) bzw. 8 GB (Original) — daher lange Läufe auf dem Server.

**Speicher je Projekt (5 km)**, hochgerechnet; mit RGB geschätzt (1,5–2 B je Punkt für die Farbe):

| | ohne RGB | mit RGB |
|---|---|---|
| Kacheln Original | 8,1 GB | ~12–14 GB |
| Kacheln 2-cm-Voxel | 1,5 GB | ~2,2 GB |
| Detailstufen 8 cm – 1,28 m | ~0,15 GB | ~0,2 GB |
| **Summe ohne Rohdatei** | **~10 GB** | **~15 GB** |
| Rohdateien, falls aufbewahrt | 5,9 GB | ~7 GB |
| Aufbereitung | ~2,5 h (1 Job), ~1,3 h (2 Jobs) | etwas länger |

Frei sind 168 GB — rund zehn Projekte mit Farbe. Quote je Projekt 25 GB. Hochladen von 500 MB:
~1,5 min bei 50 Mbit/s, ~7 min bei 10 Mbit/s.

**Aufbau.**

```
Browser                                          Server (olt-server + Dienst olt-cloudjobs)
───────                                          ──────────────────────────────────────────
Upload (fortsetzbar, 8-MB-Stücke)  ───────────►  Rohdatei → Warteschlange → Aufbereitung
                                                    ├─ L0 Original   (2-m-Kacheln, bitgenau)
                                                    ├─ L1 2-cm-Voxel (2-m-Kacheln)
                                                    └─ L2–L4 8 cm / 32 cm / 1,28 m (8/32/128 m)
Querprofil, 3D  ◄── Range-Anfragen, Projektrechte ── Kacheln + index.json je Detailstufe
      └─ OPFS als Cache (LRU)
Lange Läufe (Lichtraum gleisweit,  ───────────►  Serverjob, derselbe JS-Code wie im Browser
Schienenverfolgung)               ◄── Ergebnis
Neureferenzierung (Matrix)         ───────────►  an der Wolke gespeichert, wirkt beim Lesen überall
Lokale Wolke (nur dieses Gerät)  ── alles wie heute, im Browser
```

**Rechte** (Entscheidungen 203, 216):

| | Projektmitglied | Admin oder „Punktwolken bearbeiten“ |
|---|---|---|
| Querprofil mit Wolke, Lichtraum an der Station, 3D-Ansicht, Messen | ✓ | ✓ |
| Hochladen, lokal einlesen, löschen | — | ✓ |
| Neu referenzieren, Verlauf zurücknehmen | — | ✓ |
| Serverjobs starten (gleisweite Prüfung, Verfolgung) | — | ✓ |
| Messachsen speichern oder löschen | — | ✓ |

### Teil A — Server als Speicher

**AP 13.1 · Datenmodell, Ablage, Rechte.** Migration `006_point_cloud.sql`: `point_cloud` (id,
Projekt, Name, Datei, Format, Lage- und Höhenbezug — auch „lokal“, Status hochgeladen / in
Arbeit / bereit / Fehler, Detailstufen, Ausdehnung, Punkte, Bytes je Stufe, `rgb`, angelegt von
und am) und `point_cloud_transform` (Verlauf: Matrix, Parameter, Passpunkte, Restfehler, Person,
Datum; ein aktiver Eintrag). Ablage `/var/lib/open-layout-tool/clouds/<projekt>/<wolke>/` mit
`index.json` je Stufe und `tiles-L0.bin` … `tiles-L4.bin`. Quote 25 GB je Projekt, Platzprüfung
vor jedem Upload. `user.can_edit_clouds`, gesetzt in der Nutzerverwaltung, geliefert von
`/api/me`. Ändernde Routen prüfen „Admin oder Recht“ **und** Mitgliedschaft, lesende nur die
Mitgliedschaft. Beim Einchecken wird `axisSurveys` mit der Elternrevision verglichen: ändern
sich Messachsen ohne Recht, antwortet der Server 403 mit Klartext. In der App ohne Recht keine
Knöpfe, im Panel „Nur ansehen — Punktwolken bearbeiten darf der Admin oder wer das Recht hat“.

**AP 13.2 · Fortsetzbares Hochladen.** Im Browser wird vorher nur der Kopf gelesen (LAS-Header,
E57-XML): Lage- und Höhenbezug (Entscheidung 118) und die Lageprobe gegen die Gleise kommen vor
dem Hochladen. 8-MB-Stücke mit Offset, nach Abbruch oder Neuladen der Seite an derselben Stelle
weiter, SHA-256 am Ende; Fortschritt mit Restzeit, Abbrechen räumt weg. Option „Rohdatei
aufbewahren“ (Vorgabe aus). Größenlimit nur für diese Route angehoben.

**AP 13.3 · Aufbereitung als Serverjob.** Dienst `olt-cloudjobs` (Nutzer `olt`,
`CPUQuota=300%`, `Nice=10`, `MemoryMax=2G`), Warteschlange in SQLite, höchstens zwei Jobs
gleichzeitig. Nutzt `importPipeline.js` mit dem Node-Build von `laz-perf` und `e57Reader.js` —
kein neuer Leser. Status und Fortschritt fragt die App ab; bei Fehler der Grund und „Neu starten“.

**AP 13.4 · Detailstufen und Farbe.** L0–L4 in einem Lesedurchgang, jede Stufe mit eigenem
Index; `encodeSegment` speichert in Voxel-Einheiten (128-m-Kacheln passen in Millimetern nicht
in Uint16). RGB: LAS-Punktformate 2, 3, 5, 7, 8, 10 und E57 `colorRed/Green/Blue`, auf 8 Bit je
Kanal; drei Byte-Spalten, delta-codiert und nach Stelle umgruppiert wie die anderen. Index
`version: 3`, `rgb: true`; Version 1 und 2 bleiben lesbar. Gilt auch für den lokalen Import.
Färbung „RGB“ in Querprofil und 3D, Vorgabe bei Wolken mit Farbe. Tests: jede gröbere Stufe eine
Auswahl der feineren, Punktzahlen gegen numpy; Testdatei mit RGB aus `tools/e57fixtures.py` bzw.
`makeLas` mit Format 3; Farbe kommt auf 8 Bit verlustfrei zurück.

**AP 13.5 · Auslieferung.** `GET /api/projects/:id/clouds/:cid/L:n/tiles` mit Range;
`POST …/ranges` liefert bis zu 64 Bereiche in einer Antwort (ein Querprofil = eine Anfrage).
Mitgliedschaft 60 s je Sitzung zwischengespeichert; ETag und `immutable`. Nicht über Caddys
file_server (Entscheidung 208).

**AP 13.6 · Eine Lesequelle.** `cloudSource.read(offset, length)` über die lokale OPFS-Datei
oder HTTP mit OPFS-Cache (LRU, Vorgabe 2 GB, einstellbar); `cloudSection`, `cloudSlice` und
`clearanceCheck` bleiben darüber unverändert. Panel: eine Liste mit Kennzeichen „Server“ bzw.
„nur dieses Gerät“, Status der Jobs, „Hochladen“ als Vorgabe neben „Lokal einlesen“, Löschen
nach Recht. Lokale Wolken behalten alles (Entscheidung 204); die gleisweite Prüfung und die
Verfolgung laufen für sie weiter im Browser, die Fortschrittsanzeige sagt „im Browser“ bzw.
„auf dem Server“. Kein „Hochladen“ einer vorhandenen lokalen Wolke — hochgeladen wird immer die
Originaldatei. Im Querprofil ein Schalter für die Auflösung (L1/L0). Abnahme: dieselbe Station
aus Server- und lokaler Wolke gibt dieselben Punkte; Stationswechsel ohne Cache < 500 ms bei
50 Mbit/s.

**AP 13.7 · Lange Läufe auf dem Server.** `clearanceScan.js` und `railTrace.js` für Serverwolken
als Job; die App schickt die Gleisgeometrie mit (die Arbeitskopie liegt im Browser). Ergebnis in
den vorhandenen Listen; Messachsen landen wie bisher im Datensatz.

### Teil B — 3D-Ansicht

**AP 13.8 · Grundgerüst.** Eigenes Fenster `#/cloud3d?project=…&cloud=…`, three.js als eigenes
Bundle, WebGL2. Gezeichnet relativ zu einem nahen Ursprung (float32 gäbe bei 4 467 335 /
5 333 806 nur ~0,5 m). Shader: Färbung nach RGB, Intensität, Höhe oder Wolke, Punktgröße nach
Abstand, Kantenschattierung (EDL). Kamera: Umkreisen, Draufsicht, „Fahrt am Gleis“ (W/S Station,
A/D quer, Maus Blick).

**AP 13.9 · Laden nach Detailstufe.** Kacheln nach Bildschirmfehler, Punktbudget 6 Mio.
(einstellbar 2–15 Mio.), nächste zuerst; ein Worker dekodiert und rechnet mit `planeMapper` in
die Ebene der Ansicht, T als Modellmatrix; Grafikspeicher als LRU, derselbe OPFS-Cache wie das
Querprofil. Abnahme: 500 m aus der Ferne in < 3 s; mit Onboard-Grafik flüssig bei 2 Mio. Punkten.

**AP 13.10 · Zusammenhang mit der Planung.** Gleise in 3D (Achse, SO aus der Gradiente, beide
Schienen mit Überhöhung), Messachsen; die Querprofil-Ebene halbdurchsichtig an der aktuellen
Station mit Lichtraum-Umriss. BroadcastChannel: Gleis und Station im Hauptfenster bewegen die
Ebene, Doppelklick in 3D setzt die Station. Ohne Hauptfenster ein Hinweis, der Viewer läuft
allein weiter.

**AP 13.11 · Punktwahl und Messen.** Klick wählt den nächsten Punkt im Bildraum (8 px), danach
wird um ihn L0 nachgeladen — die Koordinate kommt immer aus dem Original. E/N/H, Station und
Querabstand zum Gleis; Strecke, Höhendifferenz, Abstand zur Achse; Liste mit CSV.

### Teil C — Neureferenzieren

**AP 13.12 · Rechenkern.** Ausgleichung nach kleinsten Quadraten mit 3D-Paaren (3 Gleichungen)
und Querprofil-Paaren (2 Gleichungen, quer und Höhe) (Entscheidung 213); Parameter nach
Entscheidung 212. Ausgabe: Parameter mit Standardabweichung, Restfehler je Paar, mittlerer
Fehler, Größtwert, normierte Verbesserungen für verdächtige Paare. Rangprüfung mit Klartext
(„Längsverschiebung nicht bestimmbar — einen Mast, ein Signal oder ein Bahnsteigende als 3D-Paar
wählen“). Tests mit synthetischen Daten: bekannte Transformation mit Rauschen, Gerade und Bogen,
Ausreißer. `pointCloud/registration.js`.

**AP 13.13 · Zielsystem und lokale Systeme.** Kette beim Lesen: Wolkenkoordinate →
`planeMapper` (System bekannt) → T → Ebene der Bezugswolke; eine Wolke im lokalen System hat nur
T (Entscheidung 214). Zweiteilige Ansicht im Viewer: links die Bezugswolke, rechts die
anzupassende, Paare abwechselnd gewählt; ab zwei Paaren Vorschau übereinander.

**AP 13.14 · Oberfläche.** Panel „Neu referenzieren“ im Viewer: Bezugswolke und anzupassende
Wolke, Tabelle der Paare (Nr., Kennung, Art 3D/Querprofil, Restfehler quer/längs/Höhe, an/aus),
Wahl der Parameter, Live-Vorschau über die Matrix. Im Querprofil beide Wolken in eigenen Farben,
gewählte Punkte springen auf den nächsten Punkt der jeweiligen Wolke, die Paare landen über den
BroadcastChannel in derselben Liste. „Übernehmen“ speichert T auf dem Server; Verlauf mit
Zurücknehmen; Protokoll als CSV/PDF (Parameter, Passpunkte, Restfehler).

**AP 13.15 · Wirkung überall.** Querprofil, Lichtraum, Serverjobs und 3D lesen mit dem aktiven
T. Messachsen aus einer Wolke, deren T sich danach ändert, werden markiert („vor
Neureferenzierung erfasst“) und lassen sich mit T verschieben oder neu verfolgen. Abnahme: die
Testwolke künstlich um 0,30 m / 0,8 mrad / +0,05 m versetzt und mit vier Paaren zurückgeholt —
Restfehler < 2 cm, Parameter auf 5 mm bzw. 0,1 mrad.

### Teil D — Betrieb

**AP 13.16 · Ausrollen und Pflege.** `setup.sh`/`deploy.sh` legen `clouds/` an und installieren
`olt-cloudjobs`. Sicherung: SQLite wie bisher; Kacheln nicht in der täglichen Sicherung,
aufbewahrte Rohdateien auf Wunsch separat. Plattenbelegung in der Admin-Ansicht, Warnung unter
20 GB frei. `deploy/README.md` mit Ablage, Quote und Größenrechnung.

### Arbeitspakete

| AP | Inhalt | Ort (voraussichtlich) |
|---|---|---|
| 13.1 ✓ | Migration `006_point_cloud.sql` (`point_cloud`, `cloud_job`, `point_cloud_transform`, `user.can_edit_clouds`); Recht in der Nutzerverwaltung (Häkchen, Abzeichen), von `/api/me` geliefert; Ablage `clouds/<Projekt>/<Wolke>/`, Quote 25 GB und Platzprüfung (5 GB Rest) vor dem Hochladen; Einchecken prüft `axisSurveys` gegen beide Eltern (Entscheidung 226); ohne Recht keine ändernden Knöpfe, Hinweis „Nur ansehen …“ | `migrations/006_point_cloud.sql`, `auth.js`, `routes/admin.js`, `checks.js`, `routes/projects.js`, `clouds/storage.js`, `hooks/useCurrentUser.js`, `AdminPage.jsx` |
| 13.2 ✓ | Kopf und Bezug vorher im Browser, „Lokal / unbekannt“ nur beim Hochladen; Stücke zu 8 MB mit SHA-256 je Stück (Entscheidung 220), am Mark des Servers fortsetzbar — nach Neuladen dieselbe Datei wählen; Fortschritt mit Rate und Restzeit, Abbrechen löscht auf dem Server; „Rohdatei aufbewahren“ (Vorgabe aus); Ausnahme vom JSON-Zwang nur für diese Route (Entscheidung 227) | `pointCloud/cloudUpload.js`, `CloudImportForm.jsx`, `routes/clouds.js`, `app.js` |
| 13.3 ✓ | Dienst `olt-cloudjobs`: Warteschlange in SQLite, höchstens zwei Jobs, jeder in eigenem Prozess (768 MB Heap); `importLevels` mit dem Node-Build von `laz-perf`; Fortschritt in der DB, die App fragt alle 3 s; Fehler mit Grund und „Neu starten“; ein Neustart des Dienstes stellt laufende Jobs zurück (Entscheidung 224). Gemessen am 2026-10-08 an `5550L_00000500_DB_Ref.laz` (571 MB, 224,5 Mio. Punkte): alle fünf Stufen in 13 min 14 s, höchstens 438 MB Speicher; L0 790 MB, L1 39,9 Mio. Punkte / 142 MB, L2 12 MB, L3 0,9 MB, L4 65 kB — für 5 km also ≈ 2,2 h mit einem Job | `tools/server/bin/olt-cloudjobs.mjs`, `clouds/jobs.js`, `clouds/prepare.js`, `clouds/cli.js` |
| 13.4 ✓ | `LEVELS` L0–L4 in einem Lesedurchgang, je Stufe eigener Index; Voxel-Stufen in Einheiten von 1/2/8/32 mm (Entscheidung 221); RGB aus LAS 2/3/5/7/8/10 und E57 (alle drei Kanäle), 8 Bit, drei Bytespalten delta-codiert; Index `version: 3`, 1 und 2 lesbar; auch der lokale Import schreibt Version 3 mit Farbe; Färbung „in Farbe (RGB)“ im Querprofil, Vorgabe bei Farbe. Tests: Stufen als Auswahl der feineren, Punktzahlen gegen unabhängige Zählung, Farbe verlustfrei, E57-Fixture `color_rgb.e57` | `tiles.js`, `importPipeline.js`, `lasHeader.js`, `lasReader.js`, `e57Reader.js`, `cloudPaint.js`, `levels.test.js` |
| 13.5 ✓ | `GET …/L:n/index`, `GET …/L:n/tiles` mit Range (206, ETag, `immutable`), `POST …/L:n/ranges` bis 64 Bereiche/64 MB; Mitgliedschaft 60 s je Sitzung (Entscheidung 222); nicht über Caddy | `routes/clouds.js` |
| 13.6 ✓ | `cloudSource` (lokale OPFS-Datei oder Server mit Sammelanfragen, gleichzeitige Anfragen derselben Segmente einmal); OPFS-Cache in Paketen je Antwort, LRU, Vorgabe 2 GB, im Panel einstellbar und leerbar (Entscheidung 223); `projectClouds.readableClouds` für Querprofil, Lichtraum und Verfolgung; eine Liste mit „Server“/„nur dieses Gerät“, Status, Fortsetzen, Neu starten; Querprofil-Schalter 2-cm-Voxel/Original für Serverwolken (Entscheidung 228); lange Läufe auf Serverwolken vorerst im Browser (Entscheidung 225). Abnahme: dieselbe Station aus Server- und lokaler Wolke gibt dieselben Punkte (Test); Stationswechsel um 10 m ≈ 1 MB (L1) | `pointCloud/cloudSource.js`, `cloudCache.js`, `projectClouds.js`, `cloudSection.js`, `PointCloudPanel.jsx`, `CloudList.jsx`, `CloudCacheSetting.jsx`, `CrossSectionOverlay.jsx` |
| 13.7 ✓ | Gleisweite Prüfung und Verfolgung als Serverjob (Migration `007_cloud_run.sql`): eigene Warteschlange in `olt-cloudjobs` neben der Aufbereitung, höchstens zwei Läufe zugleich, jeder in eigenem Prozess (320 MB Heap), Fortschritt und Abbrechen über die DB, ein Neustart stellt laufende zurück; die App schickt Gleis, Gradientenbezug (nur Gleis, Stammgleise seiner Weichen und die Weichen) bzw. Führung mit; auf dem Server liest derselbe JS-Code die L1-Kacheln von der Platte. Auf dem Server, wenn das Recht da ist und alle Wolken dort liegen (Entscheidung 237); Ergebnis 7 Tage, nach Neuladen wieder da, eine Verfolgung bis sie als Messachse gespeichert ist (238). Gemessen an 5550L (224 Mio. Punkte): Verfolgung 485 m in 7 s bei 226 MB, trifft die Browser-Verfolgung auf 0,5 mm (Median); Lichtraum über 4 km Gleis in 26 s | `migrations/007_cloud_run.sql`, `clouds/runStore.js`, `clouds/runs.js`, `routes/runs.js`, `jobs.js`, `hooks/useServerRun.js`, `ClearanceScanSection.jsx`, `RailTraceSection.jsx` |
| 13.8 ✓ | Eigenes Fenster `#/cloud3d?project=…&variant=…&cloud=…` (geöffnet aus der Wolkenliste und dem Querprofil), three.js r186 als eigener Chunk (587 kB), WebGL2; gezeichnet relativ zu einem Ursprung nahe der Wolke (Entscheidung 235); Shader nach RGB, Intensität, Höhe (2.–98. Perzentil, Entscheidung 232) oder Wolke, Punktgröße nach Abstand und Voxel, EDL; Kamera Umkreisen (Zoom zum Mauszeiger), Draufsicht, Fahrt am Gleis (W/S, A/D, R/F, Maus; Entscheidung 233) | `cloud3d/Cloud3dApp.jsx`, `viewer.js`, `shaders.js`, `main.jsx` |
| 13.9 ✓ | Baum der Stufen L4→L1 über die Kachelindizes, verfeinert solange ein Voxel > 1 px erscheint, grobe Kachel statt ihrer Kinder bis alle sichtbaren geladen sind (Entscheidung 230); Punktbudget 6 Mio. (2–15 einstellbar); zwei Worker dekodieren und rechnen mit `planeMapper` in die Ebene der Ansicht; Grafikspeicher als LRU bis zum doppelten Budget; derselbe OPFS-Cache. Abnahme: 500 m (5550L, 224 Mio. Punkte) aus der Ferne im Produktions-Build nach 2,7–3,0 s ab Öffnen des Fensters vollständig; „flüssig mit Onboard-Grafik bei 2 Mio.“ hier nicht messbar (nur Software-GL) | `cloud3d/lod.js`, `tileWorker.js`, `viewer.js` |
| 13.10 ✓ | Gleise als Achse (SO aus der Gradiente) und beide Fahrkanten mit Überhöhung, Messachsen als Punkte; Querprofil-Ebene halbdurchsichtig mit Lichtraum-Umriss an der Station des Hauptfensters; BroadcastChannel je Projekt: Projekt (auch ungespeicherte Änderungen) und Station vom Hauptfenster, Doppelklick in 3D setzt dort das Querprofil; ohne Hauptfenster Hinweis und eingecheckter Stand der Variante (Entscheidung 229) | `cloud3d/trackGeometry.js`, `channel.js`, `shell/useCloud3dChannel.js`, `MapWorkspace.jsx` |
| 13.11 ✓ | Klick wählt den nächsten Punkt im Bildraum (8 px, zwei Pick-Durchgänge, Entscheidung 231), dann wird L0 um ihn gelesen und der nächste Originalpunkt (≤ 10 cm) genommen; E/N/H, Gleis, Station, quer, über SO; Strecke, ΔH, waagerecht zum vorigen; Liste mit CSV. Geprüft: Messpunkte an 5550R auf den Millimeter aus dem Original | `cloud3d/measure.js`, `Cloud3dApp.jsx`, `viewer.js` |
| 13.12 ✓ | Gauß-Newton über T(p) = c + t + s·R·(p − c) mit R = Rz(κ)·Ry(φ)·Rx(ω), κ gegen den Uhrzeigersinn; Drehungen und Maßstab in Metern am mittleren Abstand gelöst; Rangprüfung über die Eigenwerte der Normalgleichung, der Eigenvektor zum kleinsten sagt, was fehlt (längs, quer, Höhe, Drehung, Neigung, Maßstab); Standardabweichungen, σ₀, normierte Verbesserungen (verdächtig über 3,29, Entscheidung 243). Tests: bekannte Transformation mit Rauschen auf Gerade und Bogen, Ausreißer, lokales System mit 1,9 rad, Neigungen und Maßstab; Querprofil-Paare auf einem einzigen Bogen lassen die Drehung um seinen Mittelpunkt offen (239) | `pointCloud/registration.js` |
| 13.13 ✓ | Lesekette Datei → (Ebene von T) → T → Zielebene (`cloudToPlane`, `planeToCloud`), T in der Ebene der Bezugswolke (Entscheidung 240); Querprofil sucht die Kacheln durch T zurück; Server speichert T mit Verlauf (`/clouds/:cid/transforms`, eines in Kraft, zurücknehmen); 3D zeichnet jede Wolke in einem Vorrahmen mit Modellmatrix (241), lokale Wolken erst mit T; zweiteilige Ansicht (links Bezug, rechts die anzupassende Wolke in ihrem eigenen Rahmen) | `cloudCrs.js`, `cloudSection.js`, `cloudSlice.js`, `cloud3d/placement.js`, `viewer.js`, `tileWorker.js`, `routes/clouds.js` |
| 13.14 ✓ | Panel „Neu referenzieren“ im 3D-Fenster: Bezugswolke, anzupassende Wolke, Neigungen/Maßstab wählbar, Paare per Klick in beiden Wolken (Originalpunkt), Tabelle mit Kennung, Art, Restfehler quer/längs/Höhe, an/aus, Löschen; Lösung live mit ±σ, Vorschau verschiebt die Wolke sofort; Übernehmen, Verlauf mit „Wieder in Kraft setzen“ und „Ohne Neureferenzierung lesen“; Protokoll CSV/PDF. Im Querprofil des Hauptfensters (auch abgedockt) beide Wolken in eigenen Farben, die anzupassende mit der Vorschau, „Passpunkt“ nimmt je einen Punkt jeder Wolke und gibt das Paar über den BroadcastChannel in die Liste (242) | `cloud3d/RegistrationPanel.jsx`, `useRegistration.js`, `registrationReport.js`, `hooks/useRegistrationSession.js`, `CrossSectionOverlay.jsx`, `cloudPaint.js` |
| 13.15 ✓ | Querprofil, Lichtraum (Browser und Server), Verfolgung, Kartenumriss und 3D lesen mit dem T in Kraft; nach Übernehmen lesen offene Fenster die Wolken neu. Messachsen merken sich die Wolken mit ihrem T (`cloudRefs`); ändert es sich, steht „Vor Neureferenzierung erfasst“ daran, mit „Mit der Neureferenzierung verschieben“ (nur aus einer Wolke) und „Neu verfolgen“ (ersetzt sie, Entscheidung 244). Abnahme an 5550L, eine Teilwolke (180 m, 128 Mio. Punkte) um 0,30 m längs / 0,8 mrad / +0,05 m versetzt: vier Paare aus dem Original → Restfehler ≤ 0,5 mm, κ auf 0,004 mrad, Verschiebung < 1 mm (gefordert < 2 cm, 0,1 mrad, 5 mm); dieselben vier im Browser per Klick gewählt: σ₀ 16 mm, Parameter innerhalb 1,3 σ | `cloudSection.js`, `runs.js`, `cloudOutline.js`, `pointCloud/surveyShift.js`, `AxisSurveyList.jsx`, `RailTraceSection.jsx` |
| 13.16 ✓ | `setup.sh` legt `clouds/` an und installiert `olt-cloudjobs` (CPUQuota 300 %, Nice 10, MemoryMax 2G); `deploy.sh` startet ihn mit neu; Sicherung nur der DB, Kacheln nicht; Plattenbelegung und Belegung je Projekt in der Nutzerverwaltung, Warnung unter 20 GB; `deploy/README.md` mit Ablage, Quote, Größenrechnung | `deploy/`, `routes/clouds.js` (`/admin/clouds`), `AdminPage.jsx` |

**Reihenfolge.** 13.1–13.6 (geteilte Wolken im Querprofil) → 13.7 (lange Läufe) → 13.8–13.11
(3D mit Messen) → 13.12–13.15 (Neureferenzieren); 13.16 mit dem ersten Schritt. Jeder Schritt
ist für sich nutzbar. Umfang etwa wie Phase 11 und 12 zusammen.

**Risiken.** Platz (~15 GB je Projekt mit Farbe; über zehn Projekte mehr Platten oder L0 nur auf
Wunsch); der Server ist mit OSRD geteilt (die CPU-Quote begrenzt, verlängert aber die
Aufbereitung); Onboard-Grafik schafft nur ein kleines Punktbudget; im 2-cm-Voxel liegt die
Wahlgenauigkeit bei 2–5 cm, daher Passpunkte immer aus L0.

**Testdaten.** `5550L_00000500_DB_Ref.laz` und `5550R_00004000m.laz` haben kein RGB
(Punktformat 1); für die Messung mit Farbe liefert der Auftraggeber eine Datei mit RGB. Für die
Neureferenzierung wird die Testwolke künstlich versetzt; eine echte Wolke im lokalen System
fehlt noch.

---

## Paket V — Bestandsachse und Verschiebewerte

*Vom Auftraggeber gewünscht und geklärt am 2026-10-07 (Entscheidungen 193–200).*

**Ziel.** Eine Verm.ESN-Achse (TRA, mit GRA auch die Höhe) als **Bestandsachse** einlesen: nur
ihre Punkte alle **1 cm** werden gespeichert, die Elemente nicht. Andere Gleise und das, was die
Dialoge „Gerade verbinden“, „Bogen verbinden“ und „Zwei Gleise zusammenfügen“ bauen würden,
werden mit ihr verglichen: **Verschiebewerte** quer und in der Höhe.

**Vorgaben** (Auftraggeber, 2026-10-07):

1. Lage **und** Höhe (Hebewerte, wo eine GRA mitkommt und das verglichene Gleis eine Gradiente im
   selben Höhensystem hat) (Entscheidung 193).
2. Verschiebewerte an runden Stationen der Bestandsachse (Raster 1 / 5 / 10 m), **quer zur
   Bestandsachse gemessen, rechts in ihrer Richtung positiv**, Hebung positiv nach oben
   (Entscheidung 194).
3. Die Punkte stehen **im Projekt**; eingelesen werden **höchstens 2 km** — ist die Achse länger,
   wird der Bereich (von–bis in ihrer Stationierung) gewählt (Entscheidung 195).
4. Zunächst nur aus Verm.ESN (Entscheidung 196).
5. Über einem einstellbaren Grenzwert wird **nur gewarnt**, nichts gesperrt (Entscheidung 197).

**Datenmodell** (Entscheidung 198). Neue Sammlung `referenceAxes`, an kein Gleis gebunden, im
Merge ein ganzes Objekt:

```
{ id, name, epsg, heightEpsg | null,
  source: { tra, gra | null, importedAt },
  points: { s0, step: 0.01, e0, n0, z0 | null,
            de: [mm], dn: [mm], dz: [mm] | null } }   // Differenzen zum Vorpunkt
```

Der Punkt i liegt bei Station s0 + i·0,01 m der Bestandsachse; Lage und Höhe als ganze Millimeter,
jeweils als Differenz zum Punkt davor (verlustfrei, etwa 3 Zeichen je Wert) — rund 1,5–2 MB JSON
für 2 km mit Höhe.

**Verschiebewert** (Entscheidung 199). An der Station s der Bestandsachse die Normale auf ihr; wo
sie die verglichene Achse innerhalb von 2 m schneidet: Querverschiebung = Abstand längs der
Normale (rechts +), Hebung = Höhe der verglichenen Gradiente dort − Höhe der Bestandsachse.
Keine Kreuzung im Suchbereich: „kein Bezug“. Gerechnet im Browser (`utils/shiftValues.js`), weil
„Gerade/Bogen verbinden“ bei jeder Mausbewegung neu rechnen.

**Anzeige** (Entscheidung 200). Abschnitt „Verschiebewerte“ (einklappbar): Bestandsachse
(vorbelegt die nächstgelegene), Raster, Grenzwerte quer und Höhe (vorbelegt je 50 mm, auf dem
Gerät gemerkt), größte Werte links/rechts bzw. Hebung/Senkung mit Station, Band über der Station,
Tabelle, CSV; in der Karte die Bestandsachse und die Werte über dem Grenzwert. In den drei
Dialogen über dem, was neu entsteht (beim Zusammenfügen über dem Gleis, das entstünde, samt
Gradiente); unter Prüfen › Verschiebewerte für ein ganzes Gleis.

**Wie gebaut.** Abgetastet wird jedes Element in gleichen Schritten ≤ 1 cm (`elementPoints`, mit
„Neu verbinden“ geteilt) und das 1-cm-Raster der Achsstationierung linear abgelesen (< 1 µm
Sehnenfehler); Höhe aus der GRA samt Ausrundungen (`gradientAt`). Gemessen an 5550L
(km 0,5–2,5 mit GRA): 200 001 Punkte, 1,45 MB JSON, Einlesen 0,4 s im Browser; dasselbe TRA
als Gleis gegen die Achse: quer und Höhe höchstens 1 mm (Rundung auf mm). Die verglichene Achse
wird mit Stützpunkten alle ≤ 0,25 m gelesen, die Normale über ±1 cm der Bestandsachse; die
Bestandsachse für den Vergleich ist die, an der die Achse am weitesten entlangläuft (nur im
selben Lagesystem). Beim Zusammenfügen werden die Werte auf dem Gleis gerechnet, das entstünde
(`buildSplice` nennt dafür `stretch`), samt seiner Gradiente; „Gerade/Bogen verbinden“ nur quer.
Die Liste der Bestandsachsen steht unter dem Verm.ESN-Import (Karte, Löschen).

### Arbeitspakete

| AP | Inhalt | Ort |
|---|---|---|
| V.1 ✓ | Datenmodell (`utils/referenceAxis.js`: Abtasten 1 cm, Kodieren, Prüfen), Speicher, Merge, Validator, Schrittname, Vergleichskarte; Verm.ESN-Import „Als Bestandsachse einlesen“ mit Bereichswahl bis 2 km; Liste der Bestandsachsen (Karte, Löschen) | `src/utils`, `dataExchange/` |
| V.2 ✓ | `utils/shiftValues.js`: Index der Bestandsachse, Normalenschnitt, Hebung, Tests | `src/utils` |
| V.3 ✓ | `ShiftValuesSection` (Band, Tabelle, CSV, Karte, Grenzwerte) und Prüfen › Verschiebewerte | `src/components` |
| V.4 ✓ | In „Gerade verbinden“ und „Bogen verbinden“ | `ConnectElementPanel/` |
| V.5 ✓ | In „Zwei Gleise zusammenfügen“ | `SpliceElementPanel.jsx` |
| V.6 ✓ | Bestandsachse im Höhenplan (Wunsch des Auftraggebers 2026-10-08): Auswahl „keine / automatisch / Achse“ im Kopf, ihre Höhen über den Stationen des Gleises braun gestrichelt, darunter ein Streifen Δh = Gradiente − Bestand in mm mit dem Grenzwert Höhe der Verschiebewerte, Δh auch am Cursor; nur im selben Höhensystem (Entscheidung 245) | `ElevationOverlay.jsx`, `shiftValues.js` (`referenceProfile`, `deviationAt`) |

---

## Paket N — Bestehende Elemente neu verbinden

*Vom Auftraggeber gewünscht am 2026-10-07; beim Spezifizieren festgelegt: Entscheidungen 186–192.*

**Ziel.** Im Panel „Elemente verbinden“ ein neuer Punkt **„Bestehende Elemente neu verbinden“**:
zusammenhängende Elemente eines Gleises wählen (erstes und letztes klicken, alles dazwischen ist
gewählt), ihre Achse alle **1 cm** als Punkte festhalten, die Elemente entfernen und die beiden
verbliebenen Enden mit dem Algorithmus von „Zwei Gleise zusammenfügen“ (`splice.py`) neu
verbinden — so, dass die neue Achse höchstens um eine **einstellbare Abweichung** von den
Punkten abliegt und bei der **gewünschten Geschwindigkeit** die Regeln hält. Der Dienst sucht
dafür die beste Lösung.

**Ablauf im Panel.**

1. Erstes und letztes Element klicken (dasselbe Gleis; zweimal dasselbe = nur dieses). Die Wahl
   ist in der Karte markiert. Kein Element einer Weiche in der Wahl; vor und hinter der Wahl muss
   das Gleis weitergehen (Entscheidung 186).
2. Die Achse der gewählten Elemente — und der beiden Nachbarn, soweit der Splice sie umformen
   darf — wird alle 1 cm berechnet und im Panel gehalten (Entscheidung 187); in der Karte als
   dünne Linie „alte Achse“.
3. Einstellungen: Geschwindigkeit (vorbelegt: die größte der gewählten Elemente), zulässige
   Abweichung (vorbelegt 0,10 m), Übergangsbogenform (Klothoide / Bloss), Radius *automatisch*
   oder fest.
4. Der Dienst (`POST /reconnect`) rechnet; das Panel zeigt die beste Lösung (Radius, ÜB-Längen,
   Überhöhung, größte und mittlere Abweichung, Befunde) und lässt die übrigen Varianten
   durchschalten; darunter das Abweichungsband über der Station mit ± Toleranz.
5. „Bestätigen“: Entfernen und Neuverbinden in **einem** Schritt (ein Rückgängig), Gleis-ID,
   Name und Daten bleiben (Entscheidung 191).

**Im Dienst** (`olt_optimizer/reconnect.py`). Die beiden Nachbarn sind die Picks des Splice, der
vordere am Ende, der hintere am Anfang angeschlossen (`joinAt`). Gesucht wird über
(Entscheidung 189):

| Fall | frei |
|---|---|
| zwei Geraden, Bogen und Gerade | Radius (50–50 000 m, ganze Meter: Raster, dann eingeengt), je Radius die Überhöhung nach dem Vorschlag der App (`auto_cant`), Übergangsbögen *Regellänge* / *Mindestlänge* / *keine* |
| zwei Bögen | Zwischengerade mit Übergangsbögen *Regellänge* / *Mindestlänge* / *keine*, oder direkt ein Übergangsbogen |

Jeder Kandidat wird wie im Splice gebaut (`_solve`, Fixpunkt der Längen), auf Schleifen geprüft,
gegen die Punkte gemessen (beidseitig: Punkte → neue Achse und neue Achse → Punkte) und, wo er in
der Toleranz liegt, mit dem Katalog beurteilt (`_judge`). Rangfolge (Entscheidung 190):
in der Toleranz vor außerhalb, dann der leichteste Befund (ok vor Hinweis vor Warnung; ein
Fehler sperrt), dann die kleinste größte Abweichung, dann die kleinste mittlere. Die Antwort
nennt je Variante die beste Lösung, die beste zuerst, mit Abweichungsband.

**Grenzen.** Die Konstruktion ist die des Splice: zwischen den beiden Enden **eine**
Bogengruppe (bzw. zwischen zwei Bögen eine Gerade oder ein Übergangsbogen). Ein Gegenbogen
zwischen zwei Geraden passt nicht hinein — er wird in zwei Schritten neu verbunden, je Bogen
einer; die Antwort sagt dann, wie weit die beste Lösung abliegt.

### Arbeitspakete

**Wie gebaut.** Wie oben; dazu beim Bauen: ein Übergangsbogen neben der Wahl wird **mit
ersetzt** (sonst lägen beide Enden auf dem Kreis des Bogens, und es gäbe nichts zu wählen —
liegen beide Enden trotzdem auf einem Kreis, sagt der Dienst `reconnect_error_same_circle`);
fest bleibt ein Nachbar nur, wo er zu einer Weiche gehört. Gesucht wird auf 36 Radien
(50–50 000 m, geometrisch) mit Punkten alle 1 m, dann viermal auf 8 Radien zwischen den
Nachbarn des besten mit Punkten alle 0,5 m, am Ende ganze Meter; das Endergebnis jeder Variante
wird mit **allen** Punkten (1 cm) gemessen, beidseitig. Gemessen: 2,5 km (245 000 Punkte,
R 1890 mit 188-m-Bloss-Übergangsbögen, 160 km/h) in 3 s; R 1890 wiedergefunden, Regellänge
144 m, größte Abweichung 1,3 cm. Die Panelvorgabe für die Übergangsbogenform ist die der
ersetzten Übergangsbögen. Gradiente: Punkte in der Strecke anteilig umstationiert, dahinter um
die Längenänderung verschoben; ebenso Bahnsteige (`commitReconnect`).

**Nachtrag 2026-10-08.** *Gleisabstand* (Entscheidung 201): im Panel lässt sich ein Nachbargleis
in der Karte wählen und ein frei wählbarer Mindestabstand angeben; die Suche hält ihn als Bedingung
(in der Toleranz und Abstand gehalten vor nur in der Toleranz), gemessen wie beim Zusammenfügen
(`clearance.check`, plus Vergrößerung aus der Überhöhung beider Gleise, Entscheidung 168) über
alles, was der Splice einfügt. Ohne gehaltenen Abstand sperrt das Übernehmen. *Angepasste
Übergangsbögen* (Entscheidung 202): eine vierte Variante legt Länge und Radius zusammen nach
kleinsten Quadraten an die alte Achse (Nelder-Mead ab der besten Lösung mit Regellänge, dann
Radius auf ganze Meter, Länge auf Dezimeter) — bestehende Übergangsbögen sind oft länger als
die Regellänge; am PEK-Gleis 6340.12802 (Bloss 188 m, R 1890) vorher 19 cm, jetzt 0,2 cm.

| AP | Inhalt | Ort |
|---|---|---|
| N.3 ✓ | Gleisabstand zu einem Nachbargleis mit frei wählbarem Mindestabstand; Übergangsbogenlängen an die alte Achse angepasst | `reconnect.py`, `ReconnectPanel.jsx`, `splice/ClearanceFields.jsx` |
| N.1 ✓ | Dienst: `reconnect.py`, `POST /reconnect` (Kindprozess unter Frist wie `/align`), Prüfstand `tests/verify_reconnect.py` (Bogen mit/ohne ÜB nachbauen, Toleranz eng/weit, fester Radius, zwei Bögen, Nachbar Übergangsbogen) | `tools/optimizer` |
| N.2 ✓ | App: Befehl `commands/reconnect.js` (Wahl, Punkte 1 cm, Anfrage, Übernahme mit Gradiente und Bahnsteigen), Panel `splice/ReconnectPanel.jsx` im Menü „Elemente verbinden“, Abweichungsband `chart/DeviationBand.jsx`, alte Achse und Stelle der größten Abweichung in der Karte, Texte de/en, Tests (Antworten des Dienstes aus `tests/reconnect_fixture.py`); im Browser geprüft am PEK-Bestand (Gleis 6340.12802) | `src/` |

---

## Paket S — Elemente verbinden robust

*Spezifiziert am 2026-10-07 nach den Fehlern im Projekt SBSS; der Stand davor steht in den
Entscheidungen 176–178, die Vorgaben des Auftraggebers in 179–181. Gebaut am selben Tag
(AP S.1–S.7, ✓ in der Tabelle unten), beim Bauen festgelegt: Entscheidungen 182–184.*

**Wie gebaut.** `olt_optimizer/splice.py` konstruiert alle vier Endenpaare, filtert Schleifen
(mehr als ein Halbkreis über die gewählten Elemente hinaus), setzt die Übergangsbogenlängen
je Seite nach Modus im Fixpunkt mit dem gelösten Gleis (`grenzen.transition_lengths`),
prüft jede Lösung als Ganzes mit `pruefung.py` (aus `tests/katalog_check.py` in das Paket
gezogen) und ordnet nach Befund, gewünschter Verbindungsart, Umbau. Die Antwort ist
`{"solutions": [...]}`; jede Lösung sagt, welche Wahl abgeht, ob ein Gleis umgedreht wird,
die Längen samt Regeln und die Befunde. Im Fehlerfall `rMax`, `rMin`, `lMax`; passt bei zwei
Bögen nur die andere Verbindungsart, sagt `requested`, warum die gewünschte nicht passt.
Der Browser rechnet nichts mehr nach: `orderPicks`, `spliceTransitionLengths`,
`splicedTransitions` und die JS-Kettenprüfung im Panel sind entfallen. Prüfstand
`tests/verify_splice_props.py` (160 zufällige Geometrien × 8 Arten zu fragen), gemeinsame
Vektoren `src/constraints/tests/transition_lengths.json`.

**Ziel.** „Zwei Gleise zusammenfügen“ liefert für jede sinnvolle Wahl zweier Elemente dieselbe
regelkonforme Lösung — gleich, in welcher Reihenfolge geklickt wird und wie die Gleise
gerichtet sind —, prüft alles, was es einfügt oder umformt, und sagt im Fehlerfall, was passen
würde.

**Befund (2026-10-07).** Die vier Konstruktionen des Dienstes (`splice.py`: Bogen zwischen zwei
Geraden, zwei Bögen über eine Gerade, zwei Bögen über einen Übergangsbogen, Bogen und Gerade
über einen neuen Bogen) sind geschlossen gelöst und getestet. Unsicher ist, was um sie herum
geschieht:

| # | Schwachstelle | Folge |
|---|---|---|
| 1 | Der Dienst richtet nur die Ankunft aus (nach Abstand bzw. Drehwinkel), der Abgang folgt dem Klick; die Korrektur sitzt im Browser (`orderPicks`, Entscheidung 178) | umgekehrt geklickt keine Lösung (SBSS) |
| 2 | Übergangsbogenlängen gehen als Zahl in die Konstruktion, ihr Regelwert hängt aber vom Ergebnis ab — Korb- oder Gegenbogen, bei der Radiussuche auch R und u. Der Browser schätzt vorab den ungünstigeren Fall (`spliceTransitionLengths`) | 100 m statt 28 m vor dem Fix (SBSS); JS-Zweitrechnung entgegen dem Architekturgrundsatz |
| 3 | Geprüft werden nur der eingefügte Bogen (für sich) und die Übergangsbögen — nicht die Zwischengerade zweier Bögen (LP.EL.01/02), nicht die umgeformten Reststücke der gewählten Elemente, nicht die Stöße (LP.KS.01) | Reststücke von Zentimetern und Krümmungssprünge ohne Befund |
| 4 | Nur zwei Geraden nennen im Fehlerfall den größten passenden Radius, die Bogenfälle sagen nur „passt nicht“ | Ausprobieren von Hand |
| 5 | Die Geschwindigkeit startet bei 0 | ohne Eingabe wird nichts geprüft |
| 6 | Die Suche nach dem größten Radius (Gleisabstand, Entscheidung 167) hält die Übergangsbogenlängen fest, obwohl u mit R wechselt | gefundener Radius mit zu kurzer Rampe möglich |
| 7 | Die Tests rechnen handgewählte Geometrien je Fall | die Fehler vom 2026-10-07 fielen erst an echten Daten auf |

Dabei kann der Dienst die Längenregeln schon selbst: `Grenzen.ramp_bounds` (LP.EL.01,
LP.UB.03–08) mit den Stufen `reg` und `discretion` — genau Regel- und Mindestlänge.

**Ansatz.** Die vier Konstruktionen bleiben. Darum legt sich im Dienst eine Schicht, die jede
Anfrage in derselben Folge durchläuft:

1. **Ausrichten.** Je Pick zwei mögliche Anschlussenden, zusammen vier Kombinationen; alle
   sinnvollen werden konstruiert, eine feste Rangfolge wählt (gültig vor Regelbefunden vor
   wenig Umbau und kurzer Kette). Die Klickreihenfolge entscheidet nichts.
2. **Längen.** Je Seite ein Modus statt einer Zahl: *fest*, *Regellänge*, *Mindestlänge*
   (Entscheidung 176). Fixpunkt: konstruieren → v, Δu, Δu_f aus der Lösung → Länge aus
   `ramp_bounds` → neu konstruieren, bis sie stehen (meist zwei Runden); ebenso in der
   Radiussuche.
3. **Prüfen.** Die ganze neue Strecke vom Rest des Abgangs bis zum Rest der Ankunft samt
   Stößen, mit dem Katalog (`katalog.py`); Stetigkeit von Lage, Richtung und Krümmung ist
   harte Bedingung.
4. **Antworten.** Kette, Fall, Ausrichtung, Längen mit der maßgebenden Regel, Befunde; im
   Fehlerfall, was passen würde (R_max, l_max), und eine Alternative — etwa Bogen–Gerade–Bogen
   statt eines zu kurzen direkten Übergangsbogens.
5. **Browser nur noch Anzeige.** `orderPicks` und `spliceTransitionLengths` entfallen, die
   Geschwindigkeit wird aus den gewählten Elementen vorbelegt. Die JS-Längensuche
   (`rules/transitionLength.js`) bleibt für „Gerade/Bogen verbinden“, das im Browser rechnet;
   gemeinsame Testvektoren halten sie und `ramp_bounds` gleich.

### Arbeitspakete

| AP | Inhalt | Umfang | Ort (voraussichtlich) |
|---|---|---|---|
| S.1 ✓ | **Prüfstand zuerst:** zufällige Geometrien über alle Fälle × beide Klickreihenfolgen × beide Gleisrichtungen; Invarianten: Ergebnis unabhängig von der Reihenfolge, Kette stetig, im Regellängen-Modus regelkonform. SBSS-Fall als Regression (R 410 / 80 mm → R 750 / 45 mm bei 80 km/h: Regellänge 28,0 / 36,0 m); Testvektoren JS ↔ Python für die Übergangsbogenlängen | mittel | `tools/optimizer/tests/verify_splice.py`, neuer Eigenschaftstest daneben, `rules/transitionLength` |
| S.2 ✓ | Ausrichtung im Dienst: vier Kombinationen mit Rangfolge; `orderPicks` entfällt | klein–mittel | `splice.py` (`_construct`), `SpliceElementPanel.jsx` |
| S.3 ✓ | Längenmodus Regel-/Mindestlänge im Dienst mit Fixpunkt; die Knöpfe werden Modusschalter je Seite, Längen und maßgebende Regel kommen aus der Antwort; `spliceTransitionLengths` entfällt | mittel | `splice.py`, `grenzen.py`, `splice/SpliceSettings.jsx`, `commands/splice.js` |
| S.4 ✓ | Prüfung der ganzen neuen Strecke im Dienst, Befunde je Element im Panel; jeder Fehler sperrt (Entscheidung 52) | mittel | `splice.py`, `katalog.py`, `SpliceElementPanel.jsx` |
| S.5 ✓ | Fehlerfall erklärt: R_max und l_max für alle Fälle, Alternativvorschlag | mittel | `splice.py` |
| S.6 ✓ | Größter Radius beim Gleisabstand mit Regellängen und u je Radius | klein | `splice.py` (`_with_clearance`), `clearance.py` |
| S.7 ✓ | *optional:* Übergangsbogen als Pick am Gleisende zulassen | klein | `commands/splice.js` (`splicePick`), `splice.py` |

**Vorgaben** (geklärt am 2026-10-07):

1. Vorbelegt ist der Modus *Regellänge* (Entscheidung 179) → S.3.
2. Mehrere gültige Lösungen: die beste wird vorgeschlagen, die übrigen lassen sich im Panel
   durchschalten (Entscheidung 180) → S.2, S.5.
3. Vorbelegt wird die größere Geschwindigkeit der beiden gewählten Elemente (Entscheidung 181)
   → S.3.

**Prüfen.** Wie überall (*Arbeitsweise*); dazu `verify_splice.py` und der neue Prüfstand, im
Browser mit einer Kopie des SBSS-Projekts und dem PEK-Bestand.

---

## Phase 12 — Gleisachse aus der Punktwolke, Trassierung aus Achspunkten

*Spezifiziert am 2026-10-04/05 mit dem Auftraggeber (Entscheidungen 128–138), gebaut am
2026-10-05 (AP 12.1–12.5, beim Bauen festgelegt: 139–143). Offen: AP 12.6 (optional).*

**Ziel.** Aus einer eingelesenen Punktwolke (Phase 11) die gemessene Gleisachse gewinnen — an
jeder Station die beiden Schienenköpfe, ihre Mitte ist ein Punkt der Achse — und aus diesen
Achspunkten eine Trassierung aus Geraden, Bögen und Übergangsbögen rechnen.

Zwei Stufen:

| Stufe | Wo | Ergebnis |
|---|---|---|
| **A · Achspunkte erkennen** | Punktwolken-Panel, neuer Abschnitt | eine **Messachse**: Achspunkte alle 0,5 m mit Lage, beiden Kopfhöhen und Güte, im Datensatz |
| **B · Trassieren** | Track optimieren, neuer Modus neben „Track" und „Element" | Geraden, Bögen, Übergangsbögen als **neues Gleis**, dazu ein Abweichungsbericht |

### Schienenprofile

Die Maße kommen aus dem Dlubal-Katalog (DIN EN 13674-1, Profile dort unter den alten Namen);
die Abnutzung gilt als **Mindestmaß** (Entscheidung 131). Alle Maße in mm, „von … bis" =
abgenutzt … neu.

| Schiene | Kopfbreite oben / unten | Höhe h1 | Kopfhöhe h2 | Flankenhöhe h3 | Abstand der Kopfmitten |
|---|---|---|---|---|---|
| 49 E5 (S 49) | 67 / 70 | 139,1 … 149,0 | 41,6 … 51,5 | 29,8 … 39,8 | 1502 |
| 54 E4 (S 54) | 67 / 70 | 143,2 … 154,0 | 44,2 … 55,0 | 32,5 … 43,3 | 1502 |
| 60 E2 (UIC 60) | 72 / 74,3 | 162,6 … 172,0 | 41,6 … 51,0 | 28,1 … 37,5 | 1507 |

Fahrkantenradius 13 mm bei allen dreien — deshalb liegt die Spurweite 14 mm unter SO. Bei
Dlubal ist „abgenutzt" reine Höhenabnutzung (~10 mm), die Kopfbreite bleibt. Für 60 E2 ist
gegenüber 60 E1 die Kopfform geändert; Kopf- und Flankenhöhe können um Zehntel abweichen,
was für die Erkennung nicht zählt. Die Anzeige wird „54 E4 (S 54)" statt bisher „54 E 4 (S 54)".

### Stufe A — Kopferkennung an einer Station ✓ (AP 12.1, wie gebaut)

`src/utils/pointCloud/railDetect.js`, gelesen über `railTrace.js` (`detectInClouds`).

1. **Scheibe** quer zur Führung, 0,5 m dick — dieselbe Lesung wie die Gleisprüfung
   (`cloudSectionPoints`), Punkte in (q, z).
2. **Oberfläche:** höchster Punkt je 1-cm-Spalte, nur bis 0,8 m über dem Grund der Scheibe
   (5-%-Quantil) — ein Dach oder Ausleger über dem Gleis verdeckt sonst die Schienen.
3. **Gefunden wird das Gleis an seinen Spurrillen:** an der Innenseite jedes Kopfes fällt die
   Oberfläche um mindestens 3 cm ab, und die beiden Abfälle stehen sich im Abstand der
   Spurweite gegenüber (−5…+25 mm, 1,5 cm Spaltenspiel). Die Außenseite eines Kopfes taugt
   nicht: ein Mobile-Mapping-Scanner sieht sie von der Seite, ihre Kante verschmiert zu
   Geisterpunkten fast auf Kopfhöhe, und Kabelkanäle oder Schotter lehnen daran — in der
   Beispielwolke erschien jeder Kopf so ~60 mm statt 67 mm breit und die Plateaumitte um
   bis zu 3 cm verschoben.
4. **Innenflanke** gemessen als senkrechte Fläche 20–35 mm unter der Kopfoberkante (Median der
   Punkte dort); darüber streut die Kantenrundung. Bei 1:20 Flankenneigung weicht das von
   den 14 mm der Spurweite um weniger als 1 mm ab.
5. **Kopfmitte** = Innenflanke + halbe Nennkopfbreite; **Achspunkt** = Mitte der beiden
   Kopfmitten (Entscheidung 128). Für die Achse fällt die Nennbreite heraus — sie ist die
   Mitte der Flanken —, solange beide Köpfe gleich breit sind.
6. **Höhenregel:** jeder Kopf mindestens h1 (abgenutzt) − 1 cm über dem Grund.
7. **Güte:** *gut*, oder *fraglich*, wenn eine Flanke nicht gesehen wurde (die Kante ist dann
   nur auf die Spalte genau) oder die Spurweite außerhalb −15…+25 mm liegt.
8. **Querschnitt:** Marken auf beiden Köpfen und dem Achspunkt; zwei Zeilen mit Versatz der
   Achse zum Gleis, u, Spurweite, SO und deren Abstand zur Gradiente.

**Gemessen an `5550R_00004000m.laz`:** das befahrene Gleis an jeder Station von −8 bis +6 m
*gut*, Streuung der Achse um eine Gerade 1–2 mm (RMS < 2 mm), SO 531,51 m. Die Innenflanken
messen stetig **1426–1430 mm** — ob das Gleis oder der Scanner, lässt die Wolke offen; die
Achse berührt es nicht. Das Nachbargleis 4,7 m links ist nur *fraglich*: seine Innenflanken
zeigen vom Scanner weg. Im Browser: Achse 1 mm neben dem Testgleis, SO −1 mm zur Gradiente.

**Gemessen an `5550L_00000500_DB_Ref.laz`** (km 0,0–0,5 der Strecke 5550, DB_REF GK4 = EPSG 5684,
224,5 Mio. Punkte, 571 MB; Import in Node 353 s, 39,9 Mio. Punkte behalten, 142 MB Kacheln):
entlang der Verm.ESN-TRA von 5550L (Bogen R 2000, Gerade 197 m, Klothoiden, R 500, R −500)
**968 von ~1000 Stationen gefunden, 948 gut**, Rechenzeit 7 s. Spurweite 1428–1442 mm
(Erweiterung in den R-500-Bögen), SO 4–6 cm über der GRA, Überhöhung ±5 mm (TRA: u = 0).
**Die gemessene Achse liegt 0,53–0,84 m links der TRA-Achse**, auf deren Geraden mit einer
Drift von 0,22 m auf 130 m — keine konstante Verschiebung (Ausgleich: Rest bis 16 cm), also
Ist ≠ Soll. Deshalb sucht auch eine Gleisführung jetzt 1,5 m weit (`GUIDE_WINDOW`, `6166239`).
5550R liegt überwiegend außerhalb des Scans (der Zug fuhr auf 5550L). Die Achspunkte liegen
als `5550L_00000500_Gleisachse.csv` bei den Testdaten — Eingabe für Stufe B.
Eine Vorab-Lieferung derselben Stelle (`…_DB_Ref_4.laz`, LAS 1.4) hatte Lagekoordinaten auf
einem 0,5-m-Raster (float32-Umrechnung) und taugt nicht; sie hat aber den LAS-1.4-Weg des
Readers (Format 6, geschichtetes LAZ) erstmals an einer echten Datei bestätigt.

**Bekannte Grenze:** Seitenverschleiß verschiebt die Kopfmitte um die halbe Abnutzung (6 mm
an der Fahrkante → 3 mm Kopfmitte → 1,5 mm Achse). Steht im Bericht.

### Stufe A — entlang des Gleises

- **Führung** (Entscheidung 129): ein Gleis des Projekts (Fenster ±30 cm um dessen Achse)
  oder eine grob gezeichnete Linie (Fenster ±1,5 m), gezeichnet in der Karte über dem Umriss
  der Wolke, wie er heute dargestellt wird. Die Linie wird nicht als Gleis gespeichert.
- **Verfolgen** in Schritten von 0,5 m: nach den ersten Treffern ±10 cm um die Vorhersage aus
  den letzten Achspunkten; nach 4 m ohne Treffer zurück auf das breite Fenster der Führung.
- **Lücken** (Weiche, Bahnübergang, Verdeckung) werden als Stelle mit von/bis gemeldet
  (Entscheidung 136). An einer Weiche mit mehr als zwei Köpfen gewinnt das Paar, das zur
  Vorhersage passt; der abzweigende Strang wäre eine eigene Verfolgung.
- Fortschritt mit Restzeit, Abbruch hinterlässt nichts.
- **Anzeige:** Achspunkte in der Karte als Punktreihe nach Güte gefärbt; im Querschnitt Marken
  auf den erkannten Köpfen und der Achse.
- **SO-Höhe einstellbar** (Entscheidung 130): tiefere Schiene (DB, Vorgabe), Gleisachse
  (Mittel), linke oder rechte Schiene fest. Überhöhung = z hoch − z tief, unter 3 mm als 0.
  Die Einstellung ist nur Ableitung — eine Übernahme in die Gradiente rechnet immer nach der
  DB-Regel, denn so ist `track.heights` definiert.

### Stufe A — Export der Achspunkte

Die Achspunkte einer Verfolgung lassen sich als Punktdatei exportieren (Entscheidung 138):
CSV, Semikolon, Dezimalpunkt, eine Kopfzeile, je Achspunkt eine Zeile:

```
Nr;Station [m];Rechtswert [m];Hochwert [m];SO [m];Überhöhung [mm];Güte
1;0.000;4470692.1234;5332211.5678;531.509;0;gut
```

Lage im Lagesystem der Wolke bzw. der Projektebene (im Dateinamen genannt, z. B.
`Gleisachse_<Name>_EPSG5678.csv`), SO nach der gewählten Regel (Vorgabe DB: tiefere Schiene),
Überhöhung vorzeichenbehaftet in der Regel der App: **positiv = linke Schiene höher** in
Richtung der Verfolgung. Dieselbe Datei ist die Eingabe von Stufe B.

### Messachse im Datensatz

Eine neue Sammlung `axisSurveys` (Entscheidung 132), **nicht an ein Gleis gebunden** — die
Punkte liegen in der Ebene des Projekts, eine spätere Änderung am Führungsgleis lässt sie
unberührt, der Merge braucht keine Umsetzung über die Geometrie. Im Merge ein ganzes Objekt
(`whole: true`).

```
{ id, name, epsg, rail: '54E4', soReference: 'lower',
  source: { cloudName, guideTrackId | null, createdAt, params },
  points: { e0, n0, de: [mm], dn: [mm], zl: [mm], zr: [mm], q: [0|1|2] },
  gaps: [{ from, to, reason }] }
```

Gepackt als ganze Millimeter relativ zu einem Ursprung: rund 2000 Punkte je km, etwa 60 kB
JSON je km vor der Kompression der Revision.

### Stufe B — Trassieren aus Achspunkten ✓ (AP 12.5, wie gebaut)

Eingabe ist eine **Punktdatei** im Format des Exports (Rechtswert, Hochwert, …) — aus Stufe A
oder von außen, auch mit Kopfzeile Easting/Northing, ohne Kopfzeile, mit Dezimalkomma; das
Lagesystem aus `EPSG<Code>` im Dateinamen, sonst gewählt — oder eine **Messachse des
Projekts** (Entscheidung 138). Gerechnet wird **im Python-Dienst** (`POST /align`,
`olt_optimizer/alignment_fit.py`, Entscheidung 137); die App setzt nur das neue Gleis aus der
Antwort zusammen (`src/utils/alignmentFit.js`). Modus **„Aus Messachse trassieren"** unter
Prüfen › Track optimieren (`AxisFitPanel.jsx`, Diagramm `chart/CurvatureChart.jsx`).

1. **Krümmungsbild** κ(s) aus Pfeilhöhen auf 10-m-Sehnen (κ = 8f/c²), 5 m gleitend
   gemittelt, Vorzeichen wie der Radius (> 0 Rechtsbogen); leer am Rand (halbe Sehne) und an
   Lücken (Punktabstand > 5 × üblich, mind. 2 m). Im Panel als Diagramm in 1/km, darüber
   die ausgeglichene Krümmung der Trasse, darunter die Abweichung jedes Punkts gegen die
   Toleranz; Mausrad zoomt, Ziehen verschiebt, Fadenkreuz mit Station, R und Abweichung,
   der Punkt dazu in der Karte (Entscheidung 140).
2. **Geraden** nach dem Verfahren des Auftraggebers, wie spezifiziert (Fenster 6 m, 1 cm um
   die Ausgleichsgerade, Schritt 0,5 m, 6 m Abstand, Krümmungstest 3 mm als Pfeilhöhe der
   ausgeglichenen Parabel über die Länge, Mindestlänge 20 m — alles im Panel einstellbar).
   Ausgleichsgerade nach kleinsten Abstandsquadraten, über laufende Summen, damit die Suche
   tausende Bereiche in Millisekunden prüft.
3. **Bogen zwischen zwei Geraden:** `fit_curve_group` (dieselbe Konstruktion wie der Splice)
   zwischen den beiden Ausgleichsgeraden; R, L₁, L₂ nach kleinsten Quadraten an die Punkte
   zwischen den Geraden und bis 30 m in sie hinein ausgeglichen (Nelder-Mead; Startwerte R aus
   dem Plateau, L aus den Rampen). **L = 0**, wenn der Fit ohne den Übergangsbogen um weniger
   als 0,5 mm RMS schlechter ist (Entscheidung 143). Korb- und Gegenbögen werden aus den
   Dritteln des Kreisbogens im Krümmungsbild erkannt und **gemeldet**, nicht nachgebildet.
4. **Ränder** (Entscheidung 142): beginnen oder enden die Punkte in einem Bogen, wird er vom
   Tangentenpunkt der Geraden aus angepasst (Lage, R, L₁; zeigt κ einen Auslauf, auch Bogen-
   länge und L₂ mit Gerade dahinter) und am ersten bzw. letzten Punkt geschnitten — ein
   angeschnittener Übergangsbogen wird ein Übergangsbogen bis zur Krümmung am Schnitt.
5. **Von Hand korrigieren** (Entscheidung 133): Kanten der Geraden-Bänder ziehen, ein Band
   anklicken und löschen, „Gerade einfügen" und im Diagramm aufziehen (überlappende werden
   eins); „Automatisch" sucht wieder. Jede Änderung fragt den Dienst neu (300 ms entprellt).
   Passt zwischen zwei **automatisch** gefundenen Geraden kein Bogen, werden sie zu einer
   zusammengefasst und die Station gemeldet; bei Geraden **von Hand** gibt es stattdessen
   einen Fehler mit Stelle (Entscheidung 141).
6. **Bericht:** Elemente, RMS und Maximum über alle Punkte, je Bogen R/L₁/L₂ mit Stationen und
   Hinweisen, je Element Maximum und RMS, über der Toleranz rot; in der Karte die Achspunkte
   (über der Toleranz rot) und die Trasse gestrichelt; Lücken der Messachse genannt.
7. **Übernahme als neues Gleis** (Entscheidung 134) in der Ebene der Punkte, Name
   „<Messachse> Ist", Planungsstatus Bestand, Geschwindigkeit 0, ohne Überhöhung und
   Gradiente (das wäre AP 12.6).

**Gemessen.** Synthetisch (1,3 km, 0,5 m Punktabstand, 1,5 mm Streuung, Anfang in R 1200,
R 800 mit 60/60, R −2000 ohne ÜB, R −500 mit 40/40, Ende in R 600 mit 50/30): R auf 0,01–0,3 %,
L auf 0,5 m, L = 0 erkannt, Abweichung RMS 1,6 mm / max. 5,7 mm, Rechenzeit **2,2 s**
(`verify_align.py`). An der echten Messachse 5550L (968 Punkte, km 0,0–0,5): Anfangsbogen
R ≈ 1900 ohne ÜB (TRA: R 2000 ohne ÜB), Endbogen R ≈ 501 (TRA: R 500), 3–5 s. Die 197-m-Gerade
der TRA ist in der Messung **nicht gerade** (±8 cm um die Ausgleichsgerade), und bei
Station 232,5–240 **springt die Messachse um 13 cm seitlich** (in Stufen, mit einer
Punktlücke, alle Punkte „gut") — vermutlich eine Störung der Kopferkennung (Bahnübergang?),
kein Gleisbogen. Die Automatik fasst die beiden Geraden dort zusammen und meldet es; der
Bericht zeigt die Abweichung (max. ~15 cm). Ob die Stelle in der Wolke ein Bahnübergang ist,
ist im Querschnitt bei 233 m nachzusehen.

**Beim Bauen geändert:** `geometry.transition_shift` integriert jetzt mit denselben acht
Gauß-Legendre-Knoten wie `transition_end` statt Simpson mit n = 200 — gleiche Werte auf
1e-13 m (die JS-Referenzwerte in `verify.py` halten), ein Fünfundsiebzigstel der Arbeit; der
Fit baut auf jedem Versuch eine Kurve. `verify_splice.py` und `verify_align.py` laufen jetzt
in CI und `npm run check`. Sechs Fehlerschlüssel des Splice-Dienstes galten seit AP 12.4 als
ungenutzte Übersetzungen; das Panel nimmt sie jetzt über ihr Präfix an.

**Nur Normalspur** (Entscheidung 135).

### Arbeitspakete

| AP | Inhalt | Ort (voraussichtlich) |
|---|---|---|
| 12.1 ✓ | `RAILS` mit h1/h2/h3 von–bis und b3, Anzeige „54 E4 (S 54)"; Kopferkennung an einer Station; Marken im Querschnitt. Geprüft an `5550R_00004000m.laz` und gezeichneten Scheiben (`ad85251`) | `crossSectionUtils.js`, `pointCloud/railDetect.js`, `railTrace.js`, `CrossSectionOverlay.jsx` |
| 12.2 ✓ | Verfolgen entlang Gleis oder gezeichneter Linie, Lücken, Fortschritt und Abbruch; Punktreihe in der Karte; SO-Bezug einstellbar; **Export als CSV**. Folgt ab dem ersten Punkt der Vorhersage (Scheibe quer zum Gleis gedreht), ohne Vorhersage auch um ±3°/±6° gedreht; an der Beispielwolke trifft eine Linie 1,3 m daneben und 5° schräg dieselbe Achse wie das Gleis selbst | `pointCloud/railTrace.js`, `PointCloudPanel.jsx` |
| 12.3 ✓ | Messachse im Datensatz (`axisSurveys`, im Merge ein ganzes Objekt, Punkte als ganze mm, ~40 B JSON je Punkt); Speichern nach einer Verfolgung, Liste im Punktwolken-Panel auf jedem Gerät (auch ohne Wolke) mit Karte, CSV, Löschen; Rückgängig-Text, Validator, Vergleichskarte | `utils/axisSurvey.js`, `merge/collections.js`, `storage.js`, `pointCloud/AxisSurveyList.jsx` |
| 12.4 ✓ | **Splice im Python-Dienst** (`POST /splice`), die JS-Fassung entfernt; überarbeitet: größter passender Radius im Fehlerfall, beide Anschlussrichtungen bei rechtwinkligen Geraden, kein Knick mehr, wo ein umgeformter Bogen den langen Weg nehmen müsste, Bogen–Gerade über den ganzen Bogen gesucht. Panel fragt entprellt, ohne Dienst klarer Hinweis (`d3a0db0`) | `tools/optimizer/olt_optimizer/splice.py`, `utils/commands/splice.js`, `SpliceElementPanel.jsx` |
| 12.5 ✓ | **Trassieren aus Achspunkten im Dienst** (`POST /align`): Krümmungsbild, Geraden nach dem Verfahren des Auftraggebers, Bögen über `fit_curve_group` mit R, L₁, L₂ nach kleinsten Quadraten, L = 0 wo die Punkte keinen Übergangsbogen zeigen, Bögen an offenen Enden, Korb-/Gegenbogen gemeldet; Modus „Aus Messachse trassieren" mit Krümmungsbild (Geraden ziehen, löschen, einfügen), Abweichungsbericht, Übernahme als neues Gleis | `olt_optimizer/alignment_fit.py`, `utils/alignmentFit.js`, `optimize/AxisFitPanel.jsx`, `chart/CurvatureChart.jsx` |
| 12.6 | *optional:* Gradiente und Überhöhung des neuen Gleises aus den Kopfhöhen | — |

**Testdaten.** Die Beispielwolke ist nur ~18 m lang (dafür 70 m breit, quer durch München Ost)
— genug für 12.1. Für 12.2–12.4
liefert der Auftraggeber eine längere Wolke mit Bogen (~500 MB LAZ); Unit-Tests bauen
Achspunkte synthetisch aus einer bekannten Trassierung mit Rauschen und rechnen sie zurück.
Für den Vergleich mit einer echten Trassierung liegt die Verm.ESN-TRA der Strecke 5550 bei
den Testdaten.

**Später.** Korbbögen und Gegenbögen ohne Zwischengerade (mehrere Plateaus zwischen zwei
Geraden — zunächst gemeldet; `computeArcArcTransition` ist vorhanden); abzweigende Stränge an
Weichen; Fahrkantenmitte statt Kopfmitte als Option; andere Spurweiten; Gradiente mit
Neigungswechseln und Ausrundungen zurückrechnen.

---

## Phase 10 — Mehrbenutzer und Varianten ✓

*Gebaut und ausgerollt am 2026-10-01 (AP 10.1–10.10, je ein Commit). Die vollständige
Spezifikation steht im Archiv (`archiv/ROADMAP.archiv-2026-10-01.md`, letzter Abschnitt); hier nur,
was gebaut wurde und was dabei festgelegt werden musste (Entscheidungen 103–112).*

| AP | Ergebnis | Ort |
|---|---|---|
| 10.1 | Merge-Engine: Vergleich je Sammlung, feldweiser Drei-Wege-Merge, Regeln 1–5; läuft unter Node | `src/utils/merge/` |
| 10.2 | `validateProject` (Fehler/Warnungen, „neu gegenüber Basis"); Ketteninvarianten nach `src/utils/chainChecks.js`; ID-Protokoll in `storage.js` mit Undo | `src/utils/validateProject.js` |
| 10.3 | Vergleichsansicht (Karte, Liste, Topologie) und Konfliktdialog; „Mit Datei vergleichen" | `src/components/collab/` |
| 10.4 | Node-Server: Fastify, SQLite (WAL), argon2id, Sitzungen, Login-Bremse, Nutzer-API, Migrationen, CLI | `tools/server/` |
| 10.5 | Projekte, Varianten, Revisionen (gzip, ganzer Datensatz), Bilder nach Hash, gemeinsame Basis, `409`/`422` | `tools/server/src/` |
| 10.6 | Login, Arbeitskopie je Variante in IndexedDB (v2), Statusleiste, Einchecken mit Merge bei `409`, Aktualisieren | `src/utils/workingCopySync.js`, `src/App.jsx` |
| 10.7 | Neue Startseite: Variantenbaum, Import, Projektmenü, Abzweigen, Nutzer-Menü, hell/dunkel, schmal | `src/components/StartPage.jsx` |
| 10.8 | Varianten vergleichen und zusammenführen (zweiter Vorgänger), Hinweis „… hat n neue Änderungen" | `src/utils/variantMerge.js` |
| 10.9 | Nutzerverwaltung (anlegen, zurücksetzen, deaktivieren, Rolle; letzter Admin geschützt) | `src/components/collab/AdminPage.jsx` |
| 10.10 | Historie: ansehen, mit Kopf vergleichen, als neue Revision wiederherstellen | `src/components/collab/HistoryPage.jsx` |

**Betrieb.** systemd `olt-server` (172.18.0.1:8787, DB `WEBSITE/olt-server/olt.sqlite`),
tägliche Kopie über `olt-server-backup.timer`. Caddy: `/api/*` zum Server, `/optimizer/*` und
`/data/km*` nur mit Sitzung (`forward_auth`). Erster Admin `admin`, Startpasswort in
`WEBSITE/olt-server/admin-start-password.txt`. Einzelheiten in `WEBSITE/README.md` und
`tools/server/README.md`.

**Beim Bauen gefunden und behoben:** Gleis löschen ließ die Elemente der mitgelöschten
Weichen auf den übrigen Gleisen markiert (Validierung fand es); Km-Linien bekamen bei jedem
Laden eine Zufalls-ID und kollidierten beim Zusammenführen (Entscheidung 108).

**Bekannte Grenzen.** Elemente haben weiter keine IDs (Entscheidung 92): zwei Änderungen am
selben Gleis sind ein Konflikt. Die Prüfung auf doppelt gezeichnete Gleise braucht für PEK
rund 0,25 s; für MDB-Großimporte ungemessen. Der Projekttitel auf dem Server und der im
Datensatz werden beim Umbenennen nicht abgeglichen. Ein Merge-Ergebnis wird beim Übernehmen
neu hydriert, nicht in der Merge-Engine (Regel 6).

**Später (Entscheidungen 99, 100):** Mitglieder je Projekt; Rechte und Sperren je Variante;
Planexport-Farben aus dem Vergleich mit der Eltern-Variante.

---

## Phase 11 — Punktwolke im Querschnitt ✓

*Gebaut und ausgerollt am 2026-10-02 (AP 11.1–11.5, je ein Commit). Die Spezifikation vor dem Bau mit der Messtabelle der Beispieldatei steht im
Archiv (`archiv/ROADMAP.archiv-2026-10-01.md`, letzter Abschnitt); hier, was gebaut wurde und was
dabei festgelegt werden musste (Entscheidungen 121–126).*

| AP | Ergebnis | Ort |
|---|---|---|
| 11.1 | LAS/LAZ-Header, LAZ-Chunktabelle (Arithmetik-Decoder aus LASzip portiert, Entscheidung 121), Lesen Block für Block mit `laz-perf` (`ChunkDecoder`), über `File.slice` gestreamt; Abbruch | `src/utils/pointCloud/lasReader.js`, `lazChunkTable.js` |
| 11.2 | Import im Web Worker: Lage- und Höhenbezug ohne Vorauswahl, Lageprobe gegen die Gleise, Umrechnung in die Projektebene (Entscheidung 122), 2-cm-Voxel, Kacheln 2 × 2 m sortiert und delta-codiert, OPFS über Sync-Access-Handle; Fortschritt mit Restzeit; Abbruch hinterlässt nichts | `importPipeline.js`, `tiles.js`, `pointCloudWorker.js`, `PointCloudPanel.jsx` |
| 11.3 | Liste je Projekt (Lage/Höhe, Ausdehnung, Punkte, Speicher), Umriss in der Karte (10-m-Zellen), „In der Karte zeigen", Löschen, belegter/freier Speicher, Platzwarnung vor dem Import | `cloudStore.js`, `cloudOutline.js` |
| 11.4 | Canvas unter dem SVG des Querprofils, Scheibe einstellbar (Vorgabe 10 cm), Färbung nach Intensität oder Höhe, ein/aus, Hinweis bei abweichendem Höhenbezug; Kachel-Cache, Lesen in zusammengefassten Bereichen | `cloudSection.js`, `cloudSlice.js`, `cloudPaint.js`, `CrossSectionOverlay.jsx` |
| 11.6 | **E57 direkt** (nachgereicht am 2026-10-05): eigener Leser ohne Bibliothek, im selben Worker wie LAS/LAZ und wie dort gestreamt — Seiten ohne Prüfsummen, XML mit kleinem eigenem Parser (Worker haben keinen DOMParser), CompressedVector-Pakete, nur die nötigen Bytestreams dekodiert (Float 4/8 B, Ganzzahlen bitgepackt in beliebiger Breite, ScaledInteger mit scale/offset). Je Scan die Pose (Quaternion + Translation), kartesisch oder sphärisch, ungültige Punkte weggelassen, Intensität auf 0…65535 zwischen ihren Grenzen; mehrere Scans nacheinander. Ausdehnung aus `cartesianBounds`, gegen die ersten Punkte des Scans geprüft (Entscheidung 144). Im Dialog „E57 1.0 · Scans: n" und das Koordinatensystem laut Datei (WKT gekürzt auf Name und EPSG), keine Vorauswahl (Entscheidung 118). Geprüft gegen libE57Format: kleine Testdateien aus `tools/e57fixtures.py` im Repo, die offiziellen Beispieldateien (bunny, ColouredCube, las2e57) koordinatengleich; die Beispielwolke als E57 ergibt dieselben Kacheln wie die LAZ (920 210 Punkte). Lesen ~7 Mio. Punkte/s, Import im Browser 4,1 s statt 6,8 s für die LAZ | `pointCloud/e57Reader.js`, `e57Xml.js`, `cloudReader.js`, `CloudImportForm.jsx` |
| 11.5 | Punkte im Lichtraum rot, in Einragungsbereichen orange; tiefster Eingriff bzw. kleinster Abstand als Zahl und Marke (Entscheidung 124); Prüfung über das ganze Gleis mit Liste der Stellen (Entscheidung 125) | `clearanceCheck.js`, `clearanceScan.js`, `ClearanceScanSection.jsx` |
| 11.7 | **Originalauflösung** (nachgereicht am 2026-10-05, Entscheidung 145): im Dialog „Auflösung" neben den 2-cm-Voxeln (Vorgabe) „Original – alle Punkte, wie in der Datei". Dann wird nichts ausgedünnt und nichts umgerechnet: die Kacheln liegen im System der Datei, jeder Punkt auf dem ganzzahligen Raster der Datei (LAS: deren `scale`/`offset`, bitgenau; E57: 0,1 mm oder deren feinerer ScaledInteger-Schritt), die Intensität mit 16 Bit. Segmente mit Uint32 je Achse (Schritte ab der ersten Rasterlinie der Kachel), sortiert, delta-codiert, Bytes nach Stelle umgruppiert, zlib; der Index trägt `version: 2`, `resolution: 'original'` und `grid`. Der Querschnitt rechnet die Punkte beim Lesen zum Gleis um (wie seit Entscheidung 122 für abweichende Gleise); sein Segment-Cache zählt jetzt Bytes (64 MB) statt Segmente. Liste: „Original, Raster 1 mm" bzw. „2-cm-Voxel"; Platzschätzung je Auflösung | `tiles.js`, `importPipeline.js`, `cloudSection.js`, `cloudSlice.js`, `CloudImportForm.jsx`, `CloudList.jsx` |

**Gemessen an `5550R_00004000m.laz`** (3 239 356 Punkte, DHDN / GK 4 = EPSG 5678): 28,4 %
behalten, **3,85 B je behaltenem Punkt** (Spezifikation: 4,2) → rund 1,1 B je gelesenem Punkt,
~240 MB/km bei der Dichte der Datei. Import im Browser rund 6 s (≈ 0,5 Mio. Punkte/s; ein km
mit ~216 Mio. Punkten also gut 7 min). Querschnitt: 2–24 ms Rechenzeit je Stationswechsel
(Lesen + Dekodieren + Filtern), ~100 ms beim ersten Öffnen. Die ±5-cm-Scheibe hält
5 800–6 100 Punkte; Zählung und Lage stimmen mit einer numpy-Auswertung derselben Datei
überein (Test). Die Gleisprüfung über 60 m (120 Schritte) dauert 1,5 s.

**Originalauflösung gemessen (AP 11.7).** `5550R_00004000m.laz`: alle 3 239 356 Punkte in
4,0 B (13 MB), bitgenau gegen die Datei (Test), Import im Browser 13 s; die ±5-cm-Scheibe hält
21 365 statt ~6 100 Punkte, 33–86 ms Rechenzeit je Stationswechsel; Gleisprüfung über 60 m
7 s statt 1,8 s, dieselbe Stelle. Als E57 auf 0,1 mm: 4,45 B je Punkt.
`5550L_00000500_DB_Ref.laz` (224,5 Mio. Punkte, 571 MB): 790 MB Kacheln (3,5 B je Punkt),
Import in Node 13 min (ausgedünnt 6 min) bei höchstens 620 MB Arbeitsspeicher; Kacheln halten
im Median 41 000, höchstens 1,7 Mio. Punkte; ein Querschnitt (±20 m, 10 cm) liest kalt 8–20
Kacheln, dekodiert bis 29 MB in 0,1–0,5 s.

**Befund in der Beispieldatei.** Der Bahnsteig neben dem einen Gleis ist rund 0,96 m hoch,
seine Kante liegt bei 1,65 m: oberhalb von 0,38 m reicht sie in das Profil „Hauptgleise"
(Einragung nur bis 0,76 m) — die Prüfung meldet das als Eingriff. Gleisachse und SO der
Testgleise waren aus den Schienenköpfen geschätzt (±2 cm).

**Beim Bauen gefunden und behoben:** ohne Pause zwischen den Blöcken kam ein Abbruch erst
nach dem nächsten 8-MB-Lesefenster an; einzeln gelesene Kachelsegmente (`File.slice` je
Segment) ließen den Regler dem Querschnitt davonlaufen — jetzt in zusammengefassten
Bereichen parallel gelesen.

**Bekannte Grenzen.** Geprüft wird gegen das Profil des gewählten Gleises, nicht gegen die
der Nachbargleise. Punkte unter 50 mm über SO werden nicht geprüft (Entscheidung 124). Eine
Wolke, deren Lagebezug vom Projekt abweicht, wird beim Import über NTv2 umgerechnet; die
Testgleise mussten dafür ebenfalls mit Gitter gerechnet werden — mit 7-Parameter-Satz lag
derselbe Punkt um 0,95 m daneben. LAS 1.4 (Punktformate 6–10) ist im Code vorgesehen, aber
nicht an einer echten Datei geprüft.

**Später.** Kacheln vom Projektserver ausliefern (HTTP-Range-Requests, derselbe Lesecode),
damit eine Wolke geteilt wird, und eine 3D-Ansicht — beides jetzt Phase 13; COPC direkt; E57 mit anderen Codecs als
Bitpacking (in v1.0 nicht vorgesehen, abgelehnt mit Meldung); Prüfung auch gegen
die Profile der Nachbargleise.

---

## Architekturgrundsatz

**Bearbeitet und gerechnet wird im Browser, wo es ohne Server geht; der Server speichert,
versioniert und prüft.** Seit Phase 10 braucht die App einen Login (Entscheidung 88). Die
Trennlinie:

| Im Browser | Auf dem Server |
|---|---|
| Gleise und Elemente erstellen, bearbeiten | **Track optimieren**, **Elemente verbinden** (Python-Dienst, seit AP 12.4) |
| Weichen setzen, Weichenverbindungen, Kreuzungen | MDB-Konvertierung, Geländehöhen (Python-Dienst) |
| Höhen, Bahnsteige, Querprofil, Punktwolke (Phase 11) | Login, Projekte, Varianten, Revisionen (Node-Dienst, Phase 10) |
| Plan-Export, OSRD- und Exchange-Export, eigenes JSON | Prüfen jeder eingecheckten Revision |
| Zusammenführen und Konflikte lösen | |

Zwei Regeln folgen daraus: **kein Rechenweg wird doppelt gehalten** — wo Python rechnet, gibt
es keine JS-Zweitimplementierung, und der Node-Dienst benutzt denselben JS-Code wie der
Browser. Und ein Panel, das den Server braucht, sagt das erkennbar, statt bei fehlender
Verbindung stumm nichts zu tun.

---

## Arbeitsweise

- Jedes Paket bringt seine Tests mit; `npm test` und `npm run lint` müssen vor der Abnahme
  grün sein. Jedes AP ein Commit.
- Pakete, die Elementketten erzeugen oder umbauen, halten `expectValidTrack`,
  `expectSwitchCantAdmissible` und `expectSwitchRoutesCarved` aus
  `src/test/chainInvariants.js`.
- Wo eine Konstruktion sich nicht geschlossen hinschreiben lässt, wird sie **vorwärts gebaut
  und auf eine Zahl reduziert**, statt auf Vorzeichen fallzuunterscheiden.
- Elemente einer Weiche werden ausschließlich über `switchElementMark` markiert und über
  `elementBelongsToSwitch` gefunden. Kein neuer Code vergleicht `switchName`.
- Was den Optimierer anfasst, läuft zusätzlich gegen `tools/optimizer/tests/verify.py` und
  `tests/verify_service.py` (mit der venv: `../../.venv/bin/python tests/verify.py`, angelegt mit `pip install -c tools/optimizer/requirements.lock -e 'tools/optimizer[terrain]'`).
- Was den Node-Dienst anfasst, läuft gegen seine eigenen Tests unter `tools/server/`.
- Oberflächen werden im Browser geprüft, nicht nur über Tests.

---

## AP 9.8 — Topologie-Schema nach Streckengleisen ✓

*Gebaut am 2026-10-01.* Das Schema der topologischen Verbindungen legte jedes Netz
kreuzungsfrei aus einer planaren Einbettung aus, sobald die Lage entlang der Strecke auch nur
eine Kreuzung ließ — dabei klappte das zweite Streckengleis weg, und Weichenverbindungen von
140 m liefen über bis zu 95 Spalten (PEK Halle–Könnern Bestand: 22 Zeilen). Jetzt
(`src/utils/topologyLanes.js`): durchgehende Gleise — Weiche A–B2, Kreuzung A–C, Link, Stoß —
bilden Linien; jede Linie eine Zeile, die längste die Hauptzeile, die übrigen auf der Seite,
auf der sie im Gelände liegen (gelesen 60 m hinter der Weiche gegen das Stammgleis).
Einzelne Gleise zwischen zwei Linien sind kurze Schrägen. Spalten folgen aus den Weichenseiten
(B1/B2 gegenüber A), nicht aus dem Gelände. Ergebnis Bestand: 8 und 6 Zeilen, jede
Weichenverbindung 2 Spalten. Kreuzungen sind erlaubt, wo eine Linie über eine andere hinaus
abzweigt. Die planare Auslegung (`planarity.js`, `topologyLevels.js`) ist entfernt.
**Grenze:** große Knoten aus der MDB (934 Knoten, viele offene Enden) bleiben unübersichtlich
(138 × 184), aber ohne die langen Umwege. Testdaten: `PEK_Halle_Koennern_Bestand.json` in den
Projektnotizen (`loadPekBestand()`).

## Weitere offene Punkte

- **AP 6.3 · MDB** — gebaut (Konverter `/mdb`, Trassierung, Gradiente, Weichen prüfen und
  ergänzen, Lagesysteme, Landessystem → DB_REF). Offen: (1) was ein Projekt zuschneidet —
  Strecke, Betriebsstelle oder Auswahl; (2) `ELTYP 3` und `7` (18 Elemente) melden oder als
  Klothoide nähern — Empfehlung melden; (3) die 66 Gleise mit gemischten Lagesystemen —
  Empfehlung Prüfliste. Der Klickweg im Browser ist ungeprüft.
- **Gleichartige Elemente zusammenfassen** — Idee vom 2026-09-22: Geraden gleicher Richtung,
  Bögen gleichen Radius und passende Übergangsbögen zu einem Element. Offen: Toleranz, was bei
  Übergangsbögen „passend" heißt, Umgang mit unterschiedlicher Überhöhung, ob der Schritt
  beim Import, im Trackeditor oder in beiden greift.
- **Höhenplan, offen:** Tunnel lassen sich noch nicht angeben (HP.LN.03 steht im Katalog,
  OP.12); Halte- und Abstellabschnitte nur als ganzes Bahnhofsgleis (OP.11); die Lesart der
  Ausrundungstabelle (OP.13) ist mit dem Auftraggeber zu bestätigen. Der Optimierdienst muss
  mit dem neuen Katalog zusammen mit `grenzen.py` ausgerollt werden (er überspringt die
  Höhenplan-Geltungsbereiche). Bestehende Projekte
  koppeln ihre Weichen erst beim nächsten Schreiben oder über „Zweiggleise jetzt koppeln".
- **Mindestelementlänge an der Weichenverbindung** greift nur, wo das Element eine
  Entwurfsgeschwindigkeit ab 40 km/h hat — im PEK-Bestand haben alle Elemente `speed = 0`;
  der Dialog sagt dann „nicht geprüft".
- **Gleisabstand beim Verbinden, offen:** beide Gleise gelten als gleich hoch (die tiefere
  Schiene), das neue hat noch keine Gradiente; die bogenabhängige Erweiterung des Lichtraums
  ist nicht enthalten, nur das Kippen durch die Überhöhung.
- **Von außen:** `dLcs` und `minl` der Kreuzungsformen; Stützpunkte der Ril-800.0130-Kontur
  (ein Eintrag in `gaugeProfiles.js`).

---

## Erledigt — Kurzübersicht

Einzelheiten zu jedem Paket in `archiv/ROADMAP.archiv-2026-10-01.md`.

| Phase | Kurz |
|---|---|
| 0 · Fundament | Testbasis und Invarianten-Prüfer; Weichenmodell `switchId`/`kind`/`formVersion`; Weichenform als Abschnittsfolge; Altdaten-Schnitt (nur Schema v2) |
| 1 · Weichenregeln | Überhöhungsgrenzen in der Weiche; Löschregelwerk mit `SWITCH_PORTS`; Elementteilung an Weichenenden |
| 2 · Weichenverbindungen | Gleisverbindung im Bogen und zwischen unterschiedlichen Grundelementen |
| 3 · Weichentypen | Formen mit geradem Endstück; Kreuzungen und Kreuzungsweichen; Kreuzung auf Gleis; Bogenkreuzungsweichen; symmetrische Weiche 215 – 1:4,8; Tangententabellen; drei Formen aus dem Bestand |
| 4 · Verbinden und Optimieren | „Elemente verbinden"; Korbbögen; Panel-Icons (seitdem auf einem 20-px-Raster neu gezeichnet) |
| 5 · Trackeditor | Rückwirkung und Änderungsgrenze; Auswahl in der Karte, u_f, EPSG, Autozoom |
| 6 · Bahnsteige, Querprofil, MDB | Bahnsteighöhe; Querprofil mit Höhen, Nachbargleisen und Gelände, DGM1 aus sieben Ländern; MDB-Import mit Trassierung, Gradiente, Weichen, Lagesystemen, NTv2-Gittern |
| 7 · Optimierdienst | Optimierer als Python-Dienst, Leistung, S-Bogen-Löser; Regelwerk und Physik als JSON; Regelkatalog angewendet; Optimierer rechnet nach dem Katalog |
| 9 · Prellböcke und Topologie | Prellböcke; Topologie-Ansicht mit offenen Enden und Betrachtungsgrenze; Schema der Verbindungen (seit AP 9.8 nach Streckengleisen); Löschen im Schema |
| 10 · Mehrbenutzer und Varianten | Login, Projektserver (Node, SQLite), Varianten und Revisionen, Merge-Engine mit Validierung, Arbeitskopie, Einchecken/Aktualisieren, Varianten zusammenführen, Historie, Nutzerverwaltung |
| 11 · Punktwolke im Querschnitt | LAS/LAZ und E57 gestreamt lesen, Import in OPFS-Kacheln (2-cm-Voxel), Verwaltung mit Kartenumriss, Scheibe im Querprofil, Lichtraumprüfung je Station und entlang des Gleises |
| Einzelnes | `link`-Knoten am Wechsel des Koordinatensystems; Knotenmarkierungen nur nah; Höhenprofil über die Karte; Gradiente nur auf Anforderung |

**Gestrichen:** Phase 8 · Planungszeitpunkte (Entscheidung 87, ersetzt durch Varianten);
der geteilte Projektspeicher `api/projects.php` (Entscheidung 24, durch Entscheidung 88
umgekehrt und in Phase 10 neu gebaut).

---

## Entscheidungen

Die fünfzehn Entwurfsfragen wurden am 2026-09-16 beantwortet; alle weiteren kamen beim
Spezifizieren und Bauen dazu. Die Begründungen zu 1–86 stehen im Archiv
(`archiv/ROADMAP.archiv-2026-10-01.md`), die zu 87–102 in der dort archivierten Spezifikation von
Phase 10, die zu 103–120 hier im Log.

| # | Frage | Entscheidung |
|---|---|---|
| 1 | Wann werden migrierte `switchId` geschrieben? | **Einmalig beim Laden persistieren** — eine ID, die sich bei jedem Start ändert, ist keine stabile Verknüpfung. → AP 0.4 ✓ |
| 2 | Überhöhungs-Ausnahme 120 mm | **Begründungspflichtig**, Text am Element, Vermerk im Plan. Eine wegklickbare Ausnahme ist keine. → AP 1.1 ✓ |
| 3 | Trackeditor-Grenze „> 1 Weiche und 3 Tracks" | **ODER, beide exklusiv** (> 1 Weiche ODER > 3 Gleise). → AP 5.1 |
| 4 | Wo gehört „Elemente verbinden überarbeiten" hin? | **`SpliceElementPanel`** — beide Fälle verbinden zwei bestehende Enden. → AP 4.1 |
| 5 | Label-Konflikt bei den drei bestehenden Formen | **Ersetzen.** Die Versionierung, die das ursprünglich absichern sollte, ist durch Entscheidung 13 hinfällig — es gibt keine Bestandsrecords mehr. → AP 3.1 ✓ |
| 6 | Stammgleislänge WA→WE mit geradem Endstück | **Tangentenpolygon + Endstück**: `Σ 2R·tan(α/2) + Σ` Gerade. Trifft die DB-Baulängen, für `g = 0` unverändert. → AP 3.1 ✓ |
| 7 | Zweiggeometrie mit Endstück | **Bogen nach `R·atan(1/n)`, dann Gerade** mit der Länge aus der Formtabelle. Bereits implementiert. → AP 0.3 ✓ |
| 8 | Bahnsteighöhe — Bezug und Kantenabstand | **Über SO**, absolute Oberkante aus `track.heights` abgeleitet; Kantenabstand automatisch vorgeschlagen, überschreibbar. → AP 6.1 |
| 9 | Oberbaudaten je Gleis oder je Element? | **Je Gleis, je Element überschreibbar** — dieselbe Auflösungsregel wie bei `cant`. **Beim Bauen ersetzt durch Entscheidung 18.** → AP 6.2 |
| 10 | Quelle der Lichtraumkontur | **Beide zur Auswahl** (EN 15273-1 und Ril 800.0130) als austauschbare Profile in `gaugeProfiles.js`. → AP 6.2 |
| 11 | MDB-Import: Server oder WASM? | **Serverseitig konvertieren** über den WEBSITE-Dienst aus AP 7.1. → AP 6.3 |
| 12 | Wohin die beiden 190er Formen? | **Beide primär in `SWITCH_TYPES`, 185 – 1:7 entfällt** dort. Die 190er lösen die 185er ab. → AP 3.1 ✓ |
| 13 | Altdaten weiter unterstützen? | **Nein — alle Migrationen raus, Altdateien werden beim Import abgewiesen.** Das Werkzeug setzt neu auf. → AP 0.5 |
| 14 | Bleibt der JS-Optimierer neben Python? | **Nein — `optimizeUtils` entfällt, es gibt genau eine Implementierung.** Beendet das Drift-Problem zwischen beiden Sprachen, kostet aber die lokale Vorschau. → AP 7.1 ✓ |
| 15 | Wie ist Python auf dem Server erreichbar? | **Eigener Python-Dienst** auf Basis von `api.py`, nicht die CLI aus PHP heraus. → AP 7.1 ✓ |
| 16 | Darf ein Element konstanter Krümmung zwei Überhöhungswerte tragen? | **Nein — die Rampe gehört auf den Übergangsbogen.** Kam beim Bauen von AP 2.2 auf, beantwortet in AP 4.1. Folge: die Gleisverbindung lehnt zwei verschieden überhöhte Gleise ab (`cant_mismatch`), statt eine Stufe im Gleis zu hinterlassen. → AP 2.2 / AP 4.1 ✓ |
| 22 | Was bleibt beim Löschen, wenn eine Bauart vier Ports hat? | **Eine Route bleibt, wenn beide ihrer Ports belegt sind — es sei denn, eine frühere Route hat einen davon schon beansprucht.** Eine Regel für alle Bauarten: die Weiche behält höchstens eine Route, weil ihre beiden sich am Weichenanfang treffen; die Kreuzung kann beide behalten, weil ihre sich kreuzen statt zu treffen; der Verbindungsbogen einer Kreuzungsweiche bleibt nur, wenn keine der durchgehenden Routen eine Strecke ist. Reproduziert die Tabelle aus AP 1.2 Zeile für Zeile. → AP 3.2 ✓ |
| 21 | Wie wird das Portmodell verallgemeinert? | **Die Ports bleiben Feldpaare am Record (`portX_trackId` / `portX_endpoint`), und welche es gibt, hängt an `kind`** — statt `ports: [{ id, trackId, endpoint, role }]`, wie ursprünglich geplant. Die Aufrufstellen hingen seit AP 1.2 ohnehin an *einer* Tabelle, und das war der Zweck der Übung; die Arrayform hätte zusätzlich `SCHEMA_VERSION` → 3, einen Migrationsweg gegen Entscheidung 13 und jeden Weichendialog gekostet, ohne mehr zu können. → AP 3.2 ✓ |
| 20 | `dLcs` der Form 190 – 1:7,5 | **0,30 m**, bestätigt. Der Wert fällt aus der Reihe (alle übrigen liegen zwischen 2,7 und 12,9), ist aber so gemeint: die Marke rückt nah an B1–B2. → AP 3.1 ✓ |
| 19 | Was wird aus der Gleisverbindung, wenn Weichenformen ein Endstück bekommen? | **Die Verbindung wird mitgezogen.** Der Zweig ist dort keine Route mehr, sondern eine Kette, und eine Verbindung baut bis zu fünf Elemente statt drei. Die Alternative — Endstück-Formen im Löser überspringen — hätte 40 km/h die Verbindung genommen, und das ist die DB-Regelverbindung. → AP 3.1 ✓ |
| 18 | Wie trägt ein Gleis seinen Oberbau? | **Als Bereiche entlang des Gleises** (`track.rails`, `track.sleepers`, je `{ type, from, to }`), nicht je Element. Jedes Gleis ist ohne Angabe 54 E 4 auf B70 von Anfang bis Ende; nur eine Abweichung wird hingeschrieben. Ein Schienenwechsel liegt an einer Station, nicht an einer Elementgrenze — Entscheidung 9 hätte die Trennstelle dorthin gelegt, wo die Trassierung gerade eine hat. → AP 6.2 ✓ |
| 17 | Wie wird der Bahnsteig-Kantenabstand vorgeschlagen? | **Pauschal 1,68 m für jede Höhe und jede Überhöhung, kein Bogenzuschlag** — das Paket bedient eine frühe Leistungsphase, in der die Höhe das Ergebnis ist und der Abstand ein Ansatz. Die abgestuften Tabellen folgen mit der Lichtraumrechnung in AP 6.2. → AP 6.1 ✓ |
| 23 | Wo läuft der Python-Dienst, wie ist er erreichbar? | **Auf diesem Server**, unter `online.open-layout-tool.org`; IP/Port-Anbindung regelt der Auftraggeber selbst. Alles aus dem Internet Aufrufbare liegt in `WEBSITE/` im Projektordner — gitignored, deployt auf dem Server, nicht über dieses Repo, wie zuvor `api/`. Seit 2026-09-18 live: derselbe Caddy wie `osrd.open-layout-tool.org` (`/root/osrd/deploy/Caddyfile`), TLS automatisch, **ohne Basic Auth** — der Dienst wird per `fetch()` aus der App aufgerufen, nicht im Browser besucht, ein Passwort bräche das Feature für alle. **Erweitert (noch am 2026-09-18):** unter `online.open-layout-tool.org` läuft jetzt das ganze Werkzeug, nicht nur der Dienst — die gebaute App (`dist/`) statisch von `/`, der Optimierer als Unterpfad `/optimizer/` (`handle_path` schneidet das Präfix ab, der Dienst sieht weiter `/optimize`). Details in `WEBSITE/README.md`. Zugesagt und entschieden am 2026-09-18. → AP 7.1 ✓ |
| 24 | Bleibt der geteilte Projektspeicher (`api/projects.php`)? | **Nein — ersatzlos gestrichen.** `serverStorage.js`, das Server-Projekte-Panel in `DataExchangePanel` und die Vorlagen-Sektion auf der Startseite entfallen komplett; es gibt nur noch lokale Speicherung im Browser. `api/` fällt damit als Konzept weg — `WEBSITE/` (Entscheidung 23) ist die einzige verbleibende Heimat für Serverseitiges. Entschieden am 2026-09-18, beim Klären von Entscheidung 23 aufgekommen. |
| 25 | Wie wird eine Kreuzung gezeichnet — Schenkel als Seiten oder als Diagonalen des Körpers? | **Als Diagonalen.** Der Körper ist die Raute aus den vier Ports (A → D → C → B, geschlossen); die Schenkel kreuzen sie von Ecke zu Ecke. Der erste Entwurf lief die Schenkel als Ring ab und kam zweimal durch den Kreuzungspunkt — keine Raute, nicht geschlossen. Karte (`rebuildSwitchSymbol`) und Plan (`switchSymbolUtm`) bauen denselben Ring wie der Commit (`computeCrossingGeometryUtm`). → AP 3.2 ✓ |
| 26 | Wie wird eine Kreuzung gespeichert — ein Track oder vier? | **Vier Schenkel-Tracks plus eigene Tracks für die Slip-Bögen.** Jeder Schenkel ist ein Geraden-Element mit seiner Route-Marke (`main` an A und C, `cross` an B und D), jeder Slip-Bogen ein Bogen-Element mit `slip1`/`slip2`. Der Record trägt `kind`, die vier Ports und `fillCoords`. So bleibt jede Route ein Gleis, das am Port endet, und die Slip-Bögen sind auffindbar über ihre Marke — nötig, weil sie an keinem Port hängen (Entscheidung 27). → AP 3.2 ✓ |
| 27 | Was passiert mit den Schenkeln, wenn beim Löschen ein Verbindungsbogen die Strecke ist? | **Sie gehen mit.** Eine durchgehende Route läuft über ihre Schenkel — sie bleiben als Teil der Strecke. Ein Slip umgeht den Kreuzungspunkt; wären seine Schenkel stehengeblieben, wären es tote Stümpfe in den Punkt. Der Bogen selbst bleibt, unmarkiert, als die Strecke, die er ist; die Slip-Tracks werden über ihre Marke gesammelt, weil kein Port sie nennt. Neuer Grund `crossing_slip`. → AP 3.2 ✓ |
| 28 | Darf eine Kreuzung auf gebogenem Gleis liegen? | **Nein — der Körper braucht gerades Gleis, den Endabstand auf jeder Seite des Punkts.** Die 3.2-Geometrie ist gerade Schenkel: auf gebogenem Gleis läge sie neben der Linie, die sie sein sollte, und die Slip-Bögen träfen die Schenkel nicht tangential. `placeSwitchOnTrack` läuft über Bögen hinweg (die Weiche braucht das), der Kreuzungsdialog verweigert sie (`crossing_on_track_straight_only`). Eine gebogene Kreuzung wäre die gebogene Weiche in groß — eigener Bauaufwand, kein Rückgriff auf 3.2. Entschieden am 2026-09-19, beim Bauen von AP 3.3. → AP 3.3 ✓ |
| 29 | Schreibt der MDB-Import eine eigene Elementerzeugung? | **Nein — `buildElements` aus `vermEsnImport` wird wiederverwendet.** Die MDB ist die DB-ASCII-Schnittstelle in Access-Form, und die binäre Verm.ESN-Datei ist ein Auszug derselben Schnittstelle: gleiche Typschlüssel bis hin zur „Geraden mit Knick", die ihren Knickwinkel in Gon im Radiusfeld trägt. Der Adapter setzt die Satzarten auf die Recordform um, die Geometrie bleibt an einer Stelle. Dieselbe Begründung wie Entscheidung 14 beim Optimierer: zwei Implementierungen driften auseinander. Entschieden am 2026-09-20. → AP 6.3 |
| 30 | Wird für den Import alles nach `ER0` (5684) umgerechnet? | **Nein — jedes Element wird in seinem eigenen `ELSYS` gerechnet, `projStringFor` bekommt dafür 5678 dazu.** `EA0` (DHDN / GK Zone 4, EPSG 5678) trägt mit 6314 von 9218 Elementen die Mehrheit, nicht den Rand. Geprüft: nativ gerechnet bleibt der Durchlauffehler bei 2 mm, alles nach `ER0` gezwungen erzeugt Ausreißer bis 5,9 m. Die 66 Gleise, die beide Systeme mischen, gehen auf die Prüfliste statt durch einen stillen Umrechner. Entschieden am 2026-09-20. → AP 6.3 |
| 32 | Wie kommt eine Weiche aus der MDB aufs Gleis? | **Über ihren Punkt, projiziert auf das schon importierte Gleis — nicht über die Knoten-Topologie.** Gemessen: 99,4 % der Weichenpunkte liegen innerhalb 0,5 m einer Gleisachse, Median exakt darauf, während die Knoten-PADs nur zu 35 % in einer Gleiskette stehen und die Abschnitts-Topologie nicht trägt, weil die Verkettung über Abschnittsgrenzen hinweg läuft. Die Projektion findet die Weichenform selbst: ein durchlaufendes Gleis, ein dort beginnendes. **Erzeugt wird dabei keine Geometrie** — beide Schenkel sind vermessenes Gleis, der Record markiert nur seine Routen, das Symbol wird beim Laden abgeleitet. 831 von 1408 gesetzt, alle zeichenbar; der Rest wird gemeldet. Entschieden am 2026-09-20. → AP 6.3 ✓ |
| 33 | Was passiert mit einer Weiche, die der Import nicht bauen kann? | **Die Elemente an ihrem Punkt tragen einen Hinweis, kein Weichenmerkmal.** Ein Feld `switchHint` mit Bauform, Nummer und Grund; die Elementtabelle zeigt es auf der Typspalte. Der Grund für ein eigenes Feld: `switchElementMark` markiert die Route eines *vorhandenen* Records, und ein Element mit `switchBranch` ohne `switchId` wird von `parseProjectsPayload` abgewiesen — der Hinweis gehört also neben das Weichenmodell, nicht hinein. Stillschweigend weglassen wäre das Schlechteste: das Gleis läse sich dann als freie Strecke. Entschieden am 2026-09-20. → AP 6.3 ✓ |
| 34 | Trägt ein importierter Weichenrecord dasselbe wie ein im Dialog erzeugter? | **Ja, bis auf den Namen und ein Feld mehr.** Symbol (`fillCoords`, `lcsCoords`, `labelCoords`, `bauform`) reist mit, weil `saveSwitch` den Record unverändert anhängt und den Körper erst beim Wiedereinlesen ableitet — ohne das wäre die Weiche bis zum nächsten Laden unsichtbar. Die Nummer kommt aus `nextSwitchNumber` des Projekts, nicht aus der Datei (die nummeriert je Betriebsstelle); der Name bleibt der der Datei, weil das die Bezeichnung vor Ort ist; `sw.pad` kommt als Fremdschlüssel dazu. Übernommen wird in einem `commitSwitchConnection` — ein Undo-Schritt für den ganzen Import. Entschieden am 2026-09-20. → AP 6.3 ✓ |
| 31 | Welchen Datumsübergang bekommt DB_REF? | **Seine eigenen 7 Parameter, nicht die von DHDN.** `gkProj` gab allen DB_REF-Zonen `+towgs84=598.1,73.7,418.2,…` mit — das ist DHDN und erzeugte einen konstanten Versatz von 0,227 m auf jeder DB_REF→WGS84-Umrechnung. Richtig ist EPSG „DB_REF to ETRS89 (1)", `584.9636,107.7175,413.8067,…`, mit negierten Rotationen, weil die Operation in der Coordinate-Frame-Konvention steht und proj4 Position-Vector erwartet. Gegen PROJ nachgemessen: vorher 0,227 m, nachher 0,000 m. Entschieden am 2026-09-20, beim Bauen von AP 6.3. → AP 6.3 ✓ |
| 35 | Reicht der 7-Parameter-Satz für DHDN in der Anzeige? | **Nein, wenn die Anzeige 5 cm genau sein soll — Entscheidung 31 nahm noch an, dass sie das nicht muss.** Das BeTA2007-Gitter läuft jetzt auch im Browser: `main.jsx` lädt es parallel zum Storage-Cache vor dem ersten Render (`ntv2Grid.js`), `dhdnProj` schaltet danach synchron von `+towgs84=…` auf `+nadgrids=BETA2007` um. DB_REF bleibt unverändert — laut Entscheidung 31 bereits exakt. Geprüft gegen `pyproj`s eigene höchstgenaue Operation, deckungsgleich auf 1e-9°. Stolperstein: `geotiff@3.x`s neue `getValue()`-API liefert proj4 2.20.4s GeoTIFF-Pfad `undefined` statt der erwarteten Objektfelder — nötig ist `geotiff@2.1.3`. Entschieden am 2026-09-20. → AP 6.3 ✓ |
| 36 | Gegen welchen Fehlbetrag wird V_max ausgelegt? | **130 mm — eigene Konstante `VMAX_CANT_DEF`, nicht `MAX_CANT_DEF`.** Die 150 mm sind die Grenze, ab der ein Dialog ein Element ablehnt; ausgelegt wird auf 130, damit zwischen Entwurf und Ablehnungsgrenze ein Abstand bleibt, statt jeden Bogen an seinem Limit abzustellen. Eine Weichenstraße wird weiter gegen ihre eigenen 110 mm gerechnet — der strengere Wert gilt, nie der großzügigere; 130 hätte eine Weichengrenze gelockert, nach der niemand gefragt hat. Vom Auftraggeber gesetzt am 2026-09-20. → Trackeditor ✓ |
| 37 | Darf die Richtung in der Elementtabelle getippt werden? | **Nein — nur noch Anzeige.** Ein Element beginnt, wo das vorige geendet hat; die Kette setzt seine Richtung. Eine getippte Richtung wäre eine Drehung von allem dahinter, ausgelöst aus einer Zelle, die wie eine Eigenschaft dieses einen Elements aussieht. Länge und Radius bleiben editierbar: sie verändern die Kette ebenfalls, sagen das aber auch. Vom Auftraggeber gesetzt am 2026-09-20. → Trackeditor ✓ |
| 38 | Welche Ebene bekommt der Lagesystem-Buchstabe `A`? | **DHDN (5676–5680), in jedem Streifen — nicht RD/83.** Der Schlüssel der Datenbank nennt `A` „RD/83 … westliche Bundesländer, Sachsen": ein Buchstabe für zwei EPSG-Realisierungen desselben Rauenberg-Datums. EPSG kennt RD/83 nur über Sachsen (3398/3399), westlich davon heißt dieselbe Ebene DHDN. In der Datei steht nichts, was das Bundesland sagt, und eine Rechteckprobe auf Sachsen träfe Hof und Plauen mit. Also eine Regel statt einer Vermutung: alles `A` ist DHDN auf BeTA2007 — innerhalb Sachsens rund einen halben Meter neben RD/83s eigenem Gitter (gemessen: p50 0,03 m, p95 0,64 m, max 1,10 m). Sachsens Gitter ist deshalb **nicht** eingehängt: 4,25 MB und 188 MB Heap für eine Ebene, die kein Import erzeugen kann. Kommt ein sächsischer Datensatz, ist es der Eintrag in `REGIONAL_GRIDS` und die Regel, die ihn wählt. Entschieden am 2026-09-21, beim Verbauen der Lagesysteme. → AP 6.3 ✓ |
| 39 | Was passiert mit Elementen, die zu keinem Gleisabschnitt gehören? | **Sie kommen herein, gruppiert nach der Trassenbezeichnung aus `ELTEXT`, sonst nach der Betriebsstelle.** Vorher wurden sie gezählt und verworfen — bei einem reinen Geometrie-Export (Satzarten 11–25, keine 31/32/33) heißt das: die Datei importiert nichts. Die Gruppierung muss aus der Datei kommen, und das Einzige, was sie über ein solches Element sagt, ist der Text, den der Planungsstand schreibt (`Trasse:…`). Namen statt Zahlen, damit in der Streckenliste sichtbar bleibt, was Streckennummer ist und was nicht. Betrifft auch Dateien *mit* Satzart 33: 600 von 9 218 Elementen der Testdatenbank und 69 von 246 der Thüringer hingen dort ebenfalls an keinem Abschnitt und sind jetzt drin. Entschieden am 2026-09-21. → AP 6.3 ✓ |
| 40 | Wie kommt die Gradiente der MDB auf ein Gleis? | **Über die Stationierung, mit beiden Gleisenden als Anker.** Höhen- und Lagekette teilen sich keine Punktadresse — die Datei führt für die Höhe eigene Punkte (`5xx` gegen `9xx`) —, gemeinsam ist ihnen nur die Station entlang der Strecke (Satzart 11). Also wird das Gleis darüber auf der Strecke verortet und das Stück Gradiente herausgeschnitten, das darüber liegt. Beide Enden sind Anker und das Stück wird auf die Gleislänge gezogen: Stationierung und Geometrie messen dieselbe Strecke unterschiedlich (Fehlprofile, eine Gradiente über die Streckenachse statt über dieses Gleis), und einseitig verankert türmte sich der Unterschied am fernen Ende auf, statt sich zu verteilen. Über 1 % hinaus wird nicht gezogen, sondern abgelehnt — dann reden die beiden nicht vom selben Stück. Alternative wäre gewesen, die Gradiente geometrisch zuzuordnen (nächste Achse); das scheitert daran, dass die Höhenpunkte gar keine Lagekoordinaten haben. Entschieden am 2026-09-21. → AP 6.3 ✓ |
| 41 | Wann ist eine Weiche eine Weiche, wenn Satzart 31 schweigt? | **Wenn ein Gleis mitten auf einem anderen endet *und* dort mit einem Winkel abzweigt.** Das Ende allein reicht nicht: 155 solcher Stellen in der Testdatenbank laufen ohne Winkel weiter — eine anderswo getrennte Kette oder dieselbe Strecke zweimal vermessen. Unterschieden wird an der Krümmung, nicht am Winkel: am Weichenanfang ist eine Weiche tangential, also ist `κ_Form = κ_Zweig − κ_Stamm` das Einzige, was den Zweig von einer Fortsetzung trennt, und `1:n = 1/tan(L·|κ_Form|)` der Herzstückwinkel. Kreuzungen werden **nicht** abgeleitet — Kreuzung und Überwerfungsbauwerk sind im Grundriss dasselbe Bild, und die Gradiente unterscheidet sie auch nicht. Eine gemessene Form, die der Katalog nicht kennt, wird gemeldet statt auf die nächstgelegene gebogen. Entschieden am 2026-09-21. → AP 6.3 ✓ |
| 42 | Wohin mit den Meldungen eines Imports? | **In den Browserspeicher, je Projekt, außerhalb des Projektrecords** (`olt_reports_<id>`, acht Läufe à 4 000 Zeilen), aufrufbar unter *Datenaustausch → Importberichte*. Ein Bericht sagt etwas über einen Import, nicht über die Trassierung: im Projektrecord ritte er durch jeden Undo-Schnappschuss und in jede Austauschdatei. Ein voller Speicher darf den Import nicht scheitern lassen — eine abgelehnte Schreibung fällt darauf zurück, nur den neuesten Bericht gekürzt zu halten. Entschieden am 2026-09-21. → AP 6.3 ✓ |
| 43 | Wohin mit Formen, die es im Bestand gibt, die aber keine Verbindungsform sind? | **In eine vierte Tabelle, `SWITCH_TYPES_INVENTORY`.** `SWITCH_TYPES` ist zweierlei zugleich: die primäre Tabelle der Gleisverbindungsrechnung *und* die Auswahlliste der Weichendialoge. Eine Form dort einzutragen heißt, sie dem Löser als 40-km/h-Rückfall anzubieten und sie aufs Gleis legen zu lassen — und die symmetrische 215 – 1:4,8 *kann* nicht auf ein gerades Gleis gelegt werden, weil beide Stränge R = 215 brauchen. Die neue Tabelle liest nur der Import (`switchTypeFor`, `formInCatalogue`, `switchTypeByLabel`); Löser und Dialoge behalten, was sie hatten. Ob 190 – 1:6,3 zusätzlich Verbindungsform werden soll, ist eine eigene Frage und nicht gestellt. Entschieden am 2026-09-21. → AP 6.3 ✓ |
| 45 | Dürfen Regelwerk und Physik in der App bearbeitet werden? | **Nein — die Constraints-Popups zeigen nur, gepflegt wird im Repo.** Der Dienst ist öffentlich und ohne Anmeldung: ein Schreibweg dorthin änderte die Grenzwerte für jeden Besucher gleichzeitig. Nur im Browser gehaltene Werte wären die Gegenseite desselben Problems — eine Zahl vor dem Nutzer, die keine Driftprüfung je liest, während `tests/verify.py` und `regelwerkDefaults.test.js` weiter die Repo-Dateien prüfen. Physik wäre ohnehin nur scheinbar bearbeitbar: `geometry.py` rechnet mit eigenen Konstanten, die Datei ist deren geprüfte Herleitung. Vom Auftraggeber gesetzt am 2026-09-22. → AP R.6 ✓ |
| 46 | Kommt ein Regelkatalog als Werte in den Code oder als Datei, die angewendet wird? | **Als Datei, die angewendet wird.** Der gelieferte Katalog steht unverändert in `src/regelkataloge/trassierung-lageplan.json`, und `regelkatalog.js` läuft ihn ab: jeder Grenzwert, jede Stufe und jede Formel wird von dort gelesen, keine einzige steht im Code. Ein Wert, der aus der Datei in eine Konstante wanderte, wäre ein Wert, der nicht mehr dort gepflegt wird, wo das Regelwerk gepflegt wird — genau die Drift, gegen die AP R.1–R.3 die anderen Regelwerke absichern. Der Preis ist eine eigene kleine Ausdruckssprache (`ruleExpr.js`), und der ist bewusst gezahlt: siehe die Begründung in AP R.7, warum sie geparst und nicht nach JavaScript übersetzt wird. Entschieden am 2026-09-22. → AP R.7 ✓ |
| 47 | Was ist im Modell dieser App eine Überhöhungsrampe? | **Der Übergangsbogen selbst — und sie ist immer gerade.** Überhöhung steht an Elementenden und sonst nirgends, also hat jede Überhöhungsänderung zwangsläufig ein eigenes Element; und jeder, der die Überhöhung dazwischen liest (`crossSectionUtils`, `switchPlacement`), interpoliert linear. Damit passt die Rampe zur Klothoide und **nicht** zum Blossbogen, der eine geschwungene verlangt — LP.UB.02 meldet einen Blossbogen deshalb als Sonderfall, und das ist keine Macke des Prüfers, sondern eine wahre Aussage über die App. Die Alternative wäre gewesen, `ramp_form_matches` pauschal auf `true` zu setzen; dann hätte die Regel nie etwas gesagt und die Lücke wäre unsichtbar geblieben. Entschieden am 2026-09-22. → AP R.7 ✓ |
| 48 | Was geschieht mit den 170 mm der Dialoge gegen die 160 mm der Ril 800.0110? | **Nichts an der Logik — die Regelspalte macht den Unterschied sichtbar.** `MAX_CANT` = 170 ist die Decke, ab der die Dialoge eine Eingabe verweigern; LP.KB.01 sagt 160. Die Decke zu senken wäre eine Verhaltensänderung, die niemand beauftragt hat, und sie schweigend stehen zu lassen wäre die alte Lage. Also bleibt sie, und jeder Bogen dazwischen steht jetzt in der Elementtabelle als `LP.KB.01 · Fehler` — genau das, wofür die Spalte da ist. Ein Test hält beide Zahlen fest, damit die Lücke nicht unbemerkt zuwächst oder größer wird. Entschieden am 2026-09-22. → AP R.7 ✓ — **aufgehoben durch Entscheidung 51 am selben Tag**: „auch danach erstellt werden" heißt, dass die Decke die des Katalogs ist, also 160. |
| 49 | Wie viele Einträge hat ein Regelwerk, das zwei Gesichter hat? | **Eins.** DB Ril 800.0110 ist die Regeln (gebündelt, `regelkatalog.js`) *und* die nackten Werte, an denen ein Lauf gemessen wird (vom Dienst geholt) — dieselbe Ril, einmal als Regel mit Stufen und einmal als Zahl. Beide tragen jetzt die Id `db-ril-800-0110`, und das Popup listet sie deshalb einmal und zeigt sie als beides untereinander. Das frühere „DB Ril 800 (Entwurfsgrundsätze Bahnbau, Fahrweg)" entfällt damit ganz: es war dieselbe Ril unter einem gröberen Namen und einer eigenen Hausversion. Die Werte werden weiter **geholt** statt aus den Regeln gerechnet — ein Dienst aus einem älteren Commit rechnet nach seiner Kopie, und genau die soll man sehen. Vom Auftraggeber gesetzt am 2026-09-22. → AP R.8 ✓ |
| 50 | Bleibt die Entwurfs-/Baugrenzen-Reserve beim Überhöhungsfehlbetrag? | **Nein — LP.KB.02 gilt, und zwar geschwindigkeitsabhängig.** Die App las 130 mm als „Wert, gegen den ausgelegt wird" und 150 mm als „Decke, ab der ein Dialog verweigert", mit der Differenz als bewusster Reserve. Die Ril meint etwas anderes: 130 mm bis 150 km/h, 150 mm darüber. Zwei Zahlen, gleiche Ziffern, anderer Sinn — die Reserve war eine Erfindung der App. Seit AP R.8 gibt es **eine** Grenze je Geschwindigkeit; unterhalb 150 km/h verweigern die Dialoge ab 130 mm, was strenger ist als vorher. Die Stufe `'design'` der Fehlbetragsmarkierung entfällt mitsamt ihrem Locale-Eintrag. Vom Auftraggeber entschieden am 2026-09-22 („auch danach erstellt werden"). → AP R.8 ✓ |
| 51 | Woher nimmt die App ihre Grenzwerte, nachdem es einen Katalog gibt? | **Aus dem Katalog, über `catalogLimit`.** `mapConstants.js` trug sie als Literale (170, 150, 130, 120) — jetzt wertet es die Regel aus, an die der Dialog gehalten ist: `MAX_CANT` ist LP.KB.01s Schwellenwert, die Weichengrenzen sind LP.KB.05/06, die zulässige Entwurfsgeschwindigkeit LP.ALL.01. Auch was **zwischen** den Zahlen steht wird gefragt statt gelesen: wo die Fehlbetragsstufe springt, findet `CANT_DEF_STEPS`, indem es den Katalog Geschwindigkeit für Geschwindigkeit fragt — eine Ril mit drei Stufen bräuchte hier keine Zeile. `6.5` und der 5-mm-Schritt bleiben Literale, weil sie in den Regeln nur *innerhalb* eines Ausdrucks vorkommen und sie herauszuklauben hieße, den Ausdruck zu parsen statt ihn auszuwerten; dafür prüfen zwei Tests, dass `computeAutoC` Wert für Wert LP.KB.04s Regelüberhöhung trifft und dass LP.KB.03 genau die Vielfachen von `CANT_STEP` durchlässt. Entschieden am 2026-09-22. → AP R.8 ✓ |
| 52 | Was hindert einen Erstellungsdialog daran, etwas anzulegen? | **Jeder Fehler des Katalogs, und nur ein Fehler.** Bis dahin sperrten die Dialoge bei Überhöhung und Fehlbetrag — zwei Regeln von einundzwanzig, in jedem Dialog von Hand nachgebaut; eine zu kurze Verbindung ließ sich kommentarlos anlegen. Jetzt fragt jeder `hasRuleError(elemente)`, mit demselben Element, das die Befunde darüber zeigen. Dass damit auch eine geometrisch erzwungene 3-m-Verbindung nicht mehr entsteht, ist gewollt: die Alternative wäre, den Regelbruch sichtbar zu machen und trotzdem zuzulassen, und dann hieße „nach dem Regelwerk erstellen" nichts. Die Stufe `special_case` sperrt **nicht** — der Katalog sagt von ihr, dass sie eine erfahrene Hand verlangt, nicht dass sie verboten ist —, ein Hinweis erst recht nicht, und ein Element ohne Entwurfsgeschwindigkeit wird gar nicht beurteilt. Vom Auftraggeber gesetzt am 2026-09-22. → AP R.8 ✓ |
| 44 | Woraus wird die Länge einer Kreuzung gebildet? | **Aus der Tangente, die die Form nennt** — nicht aus einem Endmaß, aus dem sie gerechnet wird. `l_t` ist das gemessene Maß der Tabelle, das Endmaß `c = 2·l_t·sin(α/2)` folgt daraus; umgekehrt gerechnet hing die ganze Kreuzungslänge an einem gerundeten Zentimeterwert, und mit dem pauschalen 1,85 m lag Kr 1:7,5 um 71 cm daneben. `endDistance` ist deshalb ganz aus `CROSSING_TYPES` verschwunden; eine Kreuzungsweiche nennt statt der Tangente den Radius ihrer Verbindungsbögen, weil dort die Berührpunkte die Enden setzen. Entschieden am 2026-09-21 mit der Tangententabelle. → AP 3.2 ✓ |
| 53 | Wie lang ist die Bogenkreuzungsweiche? | **l_KW = 2·l_b.** Geliefert waren l_b 27,6584 und l_KW 55,414 — 9,7 cm mehr als zweimal l_b, ohne dass sich sagen ließ, woher. Die Enden liegen l_b entlang der gekrümmten Kreuzungsgleise, die 55,414 bleiben unverwendet. Vom Auftraggeber gesetzt am 2026-09-22. → AP 3.4 ✓ |
| 54 | Welches c hat die Bogenkreuzungsweiche? | **Das, was die Konstruktion ergibt: 3,0587 m an den Enden.** Die gelieferten 1,9596 m sind an einer Stelle gemessen, die sich nicht bestimmen ließ; an den Enden der Form liegen die Gleise sicher weiter auseinander. Vom Auftraggeber gesetzt am 2026-09-22. → AP 3.4 ✓ |
| 55 | Woran hält sich der Optimierer? | **An den Katalog in `src/constraints/`, nicht an eine Kopie.** Ein Lauf liest dieselbe Datei wie die App und wertet sie mit derselben Ausdruckssprache aus; das Paket erreicht sie über einen Symlink, `pip install` liefert die Dateien selbst aus. Eine Regel, die der Optimierer nicht einordnen kann, führt zur Weigerung, nicht zum Übergehen. Vom Auftraggeber gesetzt am 2026-09-28 („Grundlage für alle Berechnungen und Prüfungen"). → AP R.10 ✓ |
| 56 | Regelwert oder Ermessensgrenze? | **Wählbar, Vorgabe Regelwert.** Eine Auswahl im Panel, `grenzwert` im Dienst. Die Stufe ist ein Schweregrad — Regelwert: nichts schlechter als ein Hinweis, Ermessensgrenze: nichts schlechter als eine Warnung —, die Schwelle je Regel folgt aus deren `evaluation`. Damit nimmt ein Lauf an der Ermessensgrenze auch die 120 mm im Weichenbereich (LP.KB.05), die AP R.1 bewusst keinem automatischen Lauf überlassen hatte: wer die Ermessensgrenze wählt, hat genau das gewählt, und jede solche Warnung steht danach begründungspflichtig in der Elementtabelle. Die freie u_f-Auswahl entfällt. Vom Auftraggeber gesetzt am 2026-09-28. → AP R.10 ✓ |
| 57 | Bietet der Optimierer noch Blossbögen an? | **An der Ermessensgrenze ja, am Regelwert nein.** LP.UB.02 nennt einen Blossbogen auf der geraden Rampe dieser App einen Sonderfall (Entscheidung 47), und der liegt über beiden Stufen — zuerst deshalb ganz gestrichen, vom Auftraggeber noch am selben Tag zurückgeholt: „Bei Ermessensgrenze soll der Optimierer weiterhin Blossbögen vorschlagen." An der Ermessensgrenze wird LP.UB.02 durchgelassen (und nur diese Regel); die Elementtabelle zeigt jeden solchen Bogen als Sonderfall. Bestehende Blossbögen bleiben am Regelwert, wie sie sind; ein Lauf wandelt keine Form um, nach der er nicht gefragt wurde. Vom Auftraggeber gesetzt am 2026-09-28. → AP R.10 ✓ |
| 58 | Welcher Fehlbetragssprung liegt über einer Wendeklothoide? | **Die Summe beider Enden.** Der Fehlbetrag wechselt mit dem Bogen die Seite wie die Überhöhung, die die App dort schon vorzeichenrichtig rechnete; `trassierungCheck.js` nahm für Δu_f die Differenz der Beträge und ließ damit zu kurze Wendeklothoiden durch. Optimierer und App rechnen jetzt beide vorzeichenrichtig. Entschieden am 2026-09-28. → AP R.10 ✓ |
| 59 | Worauf bezieht sich `track.heights` im überhöhten Gleis? | **Auf die SO der nicht überhöhten Schiene**, im Bogen meist die innere. Der Querschnitt dreht deshalb um deren Laufkreis, nicht mehr um die Gleismitte; die Bahnsteighöhe steht über derselben Schiene. Vom Auftraggeber gesetzt am 2026-09-28. → Querprofil mit Höhen ✓ |
| 60 | Welche Gradiente zeigt der Querschnitt? | **Die ausgerundete** (`gradientAt`), nicht das Tangentenpolygon. Vom Auftraggeber gesetzt am 2026-09-28. → Querprofil mit Höhen ✓ |
| 61 | Worauf wird der Querschnitt eingepasst, wenn Gelände dazukommt? | **Auf Gleise, Bahnsteige und Planumskante; das Gelände wird abgeschnitten.** Mit eingepasst schrumpfte ein Damm von sechs Metern das Gleis auf wenige Pixel. Die Breite, bis zu der Nachbargleise gesucht werden, ist einstellbar. Vom Auftraggeber gesetzt am 2026-09-28. → Querprofil mit Höhen ✓ |
| 62 | Woher kommt das Gelände? | **DGM1 der Länder, dann DGM5, dann MapTiler** — begonnen mit Thüringen. DGM1 geht über den Dienst, weil die Länder es nur als ZIP-Kacheln ohne CORS-Kopf herausgeben. Die Höhensysteme (DHHN2016, DHHN92, das der weltweiten Kacheln) gelten als dasselbe wie das der Gleise. Vom Auftraggeber gesetzt am 2026-09-28. → Querprofil mit Höhen ✓ |
| 63 | Was zeigt der Querschnitt von anderen Gleisen, und was bei fehlender Höhe? | **Alle Gleise, die die Schnittlinie kreuzt, mit ihren Bahnsteigen; ein Gleis ohne Höhe sagt „Höhe fehlt".** Es steht dann auf der Höhe des Bezugs, blass gezeichnet. Hat kein Gleis im Schnitt eine Höhe, lässt sich das Gelände nicht darunterlegen, und die Legende sagt das. Vom Auftraggeber gesetzt am 2026-09-28. → Querprofil mit Höhen ✓(Wo es steht, regelt seit demselben Tag Entscheidung 65.) |
| 64 | Wird die Gradiente aus dem Gelände gelesen, ohne dass jemand fragt? | **Nein.** Entweder sie ist angegeben, oder sie wird im Höhenprofil angefordert. Ein Gleis ohne Gradiente zeigt ein leeres Profil mit dem Knopf dafür. Bis dahin bekam jedes neue Gleis seine Höhen im Hintergrund aus dem Gelände. Vom Auftraggeber gesetzt am 2026-09-28. → Gradiente auf Anforderung ✓ |
| 65 | Wo steht im Querprofil ein Gleis ohne Gradiente? | **SO 20 cm über dem Gelände an seiner Achse, ausgegraut und als „Keine Gradiente" beschriftet.** Eine Stellvertreterhöhe, keine Gradiente: nichts davon wird gespeichert. Vom Auftraggeber gesetzt am 2026-09-28. → Gradiente auf Anforderung ✓ |
| 66 | Wann schließt das Querprofil? | **Mit seinem Panel** — beim Wechsel in ein anderes Panel, wie Elementtabelle und Höhenprofil. Vom Auftraggeber gesetzt am 2026-09-28. → Gradiente auf Anforderung ✓ |
| 67 | Welche Höhendaten, und wer wählt sie? | **Automatisch DGM1 der Länder, dann DGM5, dann MapTiler; von Hand jede einzeln.** DGM1 nur aus den Ländern, deren Kacheln so einfach zu holen sind wie Thüringens (sieben). Die Wahl ist eine Einstellung des Nutzers, nicht des Projekts, und gilt für Querprofil und Gradiente. Vom Auftraggeber gesetzt am 2026-09-28. → DGM1 weiterer Länder ✓ |
| 68 | Wie verhält sich das Jahr zum vorhandenen Planungsstatus? | **Es erweitert ihn.** Neubau trägt ein Jahr „ab", Rückbau ein Jahr „bis"; Bestand trägt keins. Status und Farben bleiben, wie sie sind. Vom Auftraggeber gesetzt am 2026-09-30. → Phase 8 *(Gestrichen mit Phase 8, Entscheidung 87.)* |
| 69 | Was zeigt der Zeitpunkt oben rechts? | **Er ist ein Umschalter**, und was zum gewählten Zeitpunkt nicht vorhanden ist, wird **nicht dargestellt** — nicht blass, sondern gar nicht. Vom Auftraggeber gesetzt am 2026-09-30. → AP 8.4, 8.5 *(Gestrichen mit Phase 8, Entscheidung 87.)* |
| 70 | Ist der gewählte Zeitpunkt Arbeitsstand oder Ansicht? | **Nur ein Filter für die Ansicht.** Er ändert keine Daten und datiert keine neuen Gleise. Vom Auftraggeber gesetzt am 2026-09-30. → AP 8.5 *(Gestrichen mit Phase 8, Entscheidung 87.)* |
| 71 | Wie fein ist ein Zeitpunkt? | **Nur ein Jahr** — kein Monat, keine Bauphase. Vom Auftraggeber gesetzt am 2026-09-30. → AP 8.1, 8.2 *(Gestrichen mit Phase 8, Entscheidung 87.)* |
| 72 | Was sind importierte Gleise? | **Bestand.** Kein Import setzt Status oder Jahr; nur der OSRD-Austausch liest zurück, was die App selbst geschrieben hat. Vom Auftraggeber gesetzt am 2026-09-30. → AP 8.2 *(Gestrichen mit Phase 8, Entscheidung 87.)* |
| 73 | Haben Weichen ein eigenes Jahr? | **Nein, sie bekommen es von ihren Gleisen** — vorhanden, wenn alle angeschlossenen Gleise vorhanden sind. Vom Auftraggeber gesetzt am 2026-09-30. → Phase 8 *(Gestrichen mit Phase 8, Entscheidung 87.)* |
| 74 | Kennt der Planexport Zeitpunkte? | **Ja, ein Plan gilt für einen Zeitpunkt**, der im Plankopf steht. Farben gegen den Bestand. Vom Auftraggeber gesetzt am 2026-09-30. → AP 8.6 *(Gestrichen mit Phase 8, Entscheidung 87.)* |
| 75 | Sieht das Querprofil Gleise anderer Zeitpunkte? | **Nein** — Nachbargleise nur, wenn sie zum gewählten Zeitpunkt vorhanden sind. Vom Auftraggeber gesetzt am 2026-09-30. → AP 8.5 *(Gestrichen mit Phase 8, Entscheidung 87.)* |
| 76 | Was bewirkt der Prellbocktyp 4/6/8/10? | **Vorerst nichts außer der Vorgabe des Bremswegs** — ein Platzhalter, der gespeichert wird. Vom Auftraggeber gesetzt am 2026-09-30. → AP 9.1 |
| 77 | Wo steht der Prellbock, und was ist die Länge dahinter? | **Der Prellbock ist 2,20 m lang und steht im Gleis; dahinter liegt bis zum Gleisende der Bremsweg.** Das Gleis ändert sich nicht. Vom Auftraggeber gesetzt am 2026-09-30. → AP 9.1 |
| 78 | Wo darf ein Prellbock gesetzt werden? | **Nur an freien Gleisenden.** Vom Auftraggeber gesetzt am 2026-09-30. → AP 9.1 |
| 79 | Übernimmt der MDB-Import Prellböcke? | **Ja**, aus den Knoten mit Form „Prellbock". Vom Auftraggeber gesetzt am 2026-09-30. → AP 9.2 |
| 80 | Welche Gleisenden zeigt die Topologie rot? | **Alle, die an keinem Weichen- oder Link-Port stehen und weder Prellbock noch Betrachtungsgrenze tragen**; ein geometrisch anliegendes, aber nicht eingetragenes Ende rot mit Ring. Vom Auftraggeber gesetzt am 2026-09-30. → AP 9.3 |
| 81 | Wie wird ein gewolltes offenes Ende am Rand des Planungsgebiets gekennzeichnet? | **Als Betrachtungsgrenze markierbar**; es zählt dann nicht als Fehler. Vom Auftraggeber gesetzt am 2026-09-30. → AP 9.4 |
| 82 | Wie zeichnet die Topologie die Gleise? | **In echter Lage, ohne Details; die Weichenkreise viel größer.** Vom Auftraggeber gesetzt am 2026-09-30. → AP 9.3 |
| 83 | Ersetzt die Topologie die normale Darstellung? | **Ja**, die normalen Gleise werden ausgeblendet, die Grundkarte bleibt. Vom Auftraggeber gesetzt am 2026-09-30. → AP 9.3 |
| 84 | Wie erscheint ein Systemwechsel (`link`) in der Topologie? | **Als eigenes, viereckiges Symbol.** Vom Auftraggeber gesetzt am 2026-09-30. → AP 9.3 |
| 85 | Gibt es eine Liste der offenen Enden? | **Ja**, mit Anzahl und Klick zum Hinzoomen. Vom Auftraggeber gesetzt am 2026-09-30. → AP 9.4 |
| 86 | Gibt es einen Zustand zwischen angeschlossen und frei („fast angeschlossen“)? | **Nein.** Ein Ende ist angeschlossen oder frei. Vom Auftraggeber gesetzt am 2026-09-30. → AP 9.7 |
| 87 | Wie werden Zeitstände wie 2030 und 2036 abgebildet? | **Als Varianten, nicht als Jahr am Gleis.** Phase 8 (Entscheidungen 68–75) entfällt ungebaut. Ein Umbau eines bestehenden Gleises ist in einer Variante dasselbe Gleis mit anderer Geometrie. Vom Auftraggeber gesetzt am 2026-10-01. → Phase 10 |
| 88 | Ist die App auch ohne Login nutzbar? | **Nein — nur mit Login**, kein rein lokaler Modus. Kehrt Entscheidung 24 um: es gibt wieder einen Server-Projektspeicher. Vom Auftraggeber gesetzt am 2026-10-01. → AP 10.4, 10.5 |
| 89 | Wer legt Nutzer an? | **Nur ein Admin**, keine Selbstregistrierung. Rollen `admin` und `user`; deaktivieren statt löschen. Vom Auftraggeber gesetzt am 2026-10-01. → AP 10.4, 10.7 |
| 90 | Postgres oder SQLite? | **SQLite** (WAL), Zugriffe in einer dünnen Schicht; Postgres erst bei mehreren Instanzen oder räumlichen Abfragen im Server. Entschieden am 2026-10-01. → AP 10.4 |
| 91 | In welcher Sprache läuft der Server? | **Node** — Einlesen und Validierung (`parseProjectsPayload`, `validateProject`) laufen in Browser und Server als derselbe JS-Code; kein zweiter Rechenweg. Entschieden am 2026-10-01. → AP 10.4 |
| 92 | Was ist die Einheit des Merges? | **Das Gleis**, mit `elements` und `heights` als je einem Feld — Elemente haben keine IDs. Element-IDs bleiben eine spätere Verfeinerung. Entschieden am 2026-10-01. → AP 10.1 |
| 93 | Wie übersteht eine Weiche das Teilen ihres Gleises auf der anderen Seite? | **Teilen und Verbinden checken die Zuordnung alt → neu mit ein**, der Merge wendet sie an. Entschieden am 2026-10-01. → AP 10.2 |
| 94 | Was wird versioniert? | **Nur der dehydrierte Datensatz**; Abgeleitetes wird nach jedem Merge neu gebaut, und das Ergebnis wird validiert. Ein Verstoß ist ein Konflikt, keine stille Reparatur. Entschieden am 2026-10-01. → AP 10.1, 10.2 |
| 95 | Müssen ältere Stände übernommen werden? | **Nein**, es gibt noch keine Daten. Kein Upload lokaler Projekte, keine Migration. Vom Auftraggeber gesetzt am 2026-10-01. → AP 10.5 |
| 96 | Wird die Startseite überarbeitet? | **Ja** — Login davor, Projekte mit Variantenbaum und Status, „Neues Projekt" als Dialog, Nutzerverwaltung für Admins. Vom Auftraggeber gesetzt am 2026-10-01. → AP 10.6, 10.7 |
| 97 | Wer führt beim Einchecken über eine veraltete Basis zusammen? | **Der Browser.** Der Server nimmt nur Revisionen auf dem aktuellen Kopf an (sonst `409`) und prüft sie; so wird kein Ergebnis gespeichert, das kein Nutzer gesehen hat. Festgelegt beim Spezifizieren am 2026-10-01. → AP 10.5, 10.6 |
| 98 | Was speichert eine Revision? | **Den ganzen dehydrierten Datensatz, komprimiert**, dazu die ID-Zuordnungen. Ein Projekt hat rund 100 kB; Unterschiede je Objekt wären eine spätere Optimierung. Festgelegt beim Spezifizieren am 2026-10-01. → AP 10.5 |
| 99 | Wer sieht welches Projekt, wer darf was je Variante? | **Zunächst sehen und bearbeiten alle aktiven Nutzer alle Projekte.** Mitglieder je Projekt sowie Rechte und Sperren je Variante kommen als eigene Pakete nach AP 10.10. Vom Auftraggeber bestätigt am 2026-10-01. → AP 10.4, 10.5 |
| 100 | Woher kommen die Farben im Planexport? | **Weiter aus dem Planungsstatus am Gleis** (Bestand schwarz, Neubau rot, Rückbau gelb). Ein Vergleich mit der Eltern-Variante als Farbquelle wäre ein eigenes Paket. Vom Auftraggeber bestätigt am 2026-10-01. |
| 101 | Sind Plankopf und Bild je Projekt oder je Variante? | **Je Variante versioniert.** Der Plankopf ist ein Feld im Datensatz, das Bild liegt als Blob nach Hash und wird per Hash referenziert; im Merge je ein Feld. Vom Auftraggeber gesetzt am 2026-10-01. → AP 10.2, 10.5, 10.6 |
| 102 | Was liegt hinter dem Login? | **Alles:** App, API, Optimierer unter `/optimizer/`, Kachel- und Gelände-Endpunkte. Caddy prüft die Sitzung per `forward_auth` gegen `GET /api/me`, der Python-Dienst bleibt unverändert. Vom Auftraggeber gesetzt am 2026-10-01. → AP 10.4 |
| 103 | Wie ist das ID-Protokoll aufgebaut, und wie setzt der Merge Referenzen um? | **`{ from, to: [ids] }` je Teilen/Verbinden; umgesetzt wird über die Geometrie**: ein Weichen-Port oder eine Endmarke geht an das Teilstück, dessen Ende dort liegt, wo das alte lag; ein Bahnsteig an das Stück, auf dem beide Stationen liegen (mit Stationen dort, bei Gegenrichtung mit getauschter Seite). Das hält über beliebig viele Schritte, ohne Versätze mitzuschreiben. Beim Bauen festgelegt am 2026-10-01. → AP 10.1, 10.2 |
| 104 | Was blockiert die Validierung? | **Nur Fehler, die neu sind** gegenüber dem eigenen Stand (Merge) bzw. der Basis-Revision (Server). Ein Import darf Fehler mitbringen; sie werden gemeldet. Knotenlücken ab 1 cm sind Warnungen, ab 0,5 m Fehler (PEK hat eine echte von 9 cm); Längenabweichungen sind Warnungen. Beim Bauen festgelegt am 2026-10-01. → AP 10.2, 10.5 |
| 105 | Wie wird ein Validierungskonflikt aufgelöst? | **Durch die Wahl des ganzen Objekts** aus einer Seite (`object:<Sammlung>:<id>`); nach jeder Wahl wird neu validiert. Beim Bauen festgelegt am 2026-10-01. → AP 10.3 |
| 106 | Wann warnt die Prüfung auf doppelt gezeichnete Gleise? | **< 0,5 m über > 10 m, nicht bei Gleisen an derselben Weiche, und bei einem Abschnitt an einem gemeinsamen Ende erst ab der halben Länge des kürzeren Gleises** — sonst meldete jede gelöschte Weiche ihre auseinanderlaufenden Zweige. Beim Bauen festgelegt am 2026-10-01. → AP 10.2 |
| 107 | Wie kommt ein Bild auf den Server? | **`PUT /api/blobs`, nicht an ein Projekt gebunden**, damit ein neues Projekt sein Bild gleich mitbringt; die Revision trägt `imageHash`, der Server vermerkt ihn je Revision (Migration 003). Export bettet das Bild als Data-URL ein, Import lädt es wieder hoch. Beim Bauen festgelegt am 2026-10-01. → AP 10.5, 10.7 |
| 108 | Welche ID bekommt eine Km-Linie? | **`km-<Streckennummer>`**, nicht mehr zufällig: zwei Browser, die dieselbe Linie nachladen, erzeugen denselben Eintrag statt eines Konflikts. Beim Bauen festgelegt am 2026-10-01. → AP 10.6 |
| 109 | Was liegt hinter dem Login, was nicht? | **`/api/*` (Server selbst), `/optimizer/*` und `/data/km*`** über `forward_auth`; **offen** bleiben die App-Dateien (die Anmeldeseite gehört dazu) und die NTv2-Gitter `/data/*.tif`, die die App vor dem Login lädt. Konkretisiert Entscheidung 102 beim Ausrollen am 2026-10-01. → AP 10.4 |
| 110 | Hell und dunkel — wofür? | **Die neuen Oberflächen** (Login, Startseite, Vergleich, Konflikte, Verwaltung, Historie) folgen `prefers-color-scheme`; die übrige App bleibt, wie sie war. Beim Bauen festgelegt am 2026-10-01. → AP 10.3, 10.7 |
| 111 | Wie läuft der Server die Browser-Module? | **Unverändert aus `src/`**, über einen Node-Modul-Hook (`tools/server/src/esmHook.mjs`: Dateiendungen, JSON-Importe, `import.meta.env`); kein Build-Schritt. Der Server hydriert nicht — Validierung braucht nur die Ebenen-Daten. Beim Bauen festgelegt am 2026-10-01. → AP 10.4 |
| 112 | Wer bekommt den ersten Admin-Zugang? | **Login `admin`**, Startpasswort generiert in `WEBSITE/olt-server/admin-start-password.txt`, bei der ersten Anmeldung zu ändern. Beim Ausrollen festgelegt am 2026-10-01. → AP 10.4 |
| 113 | Wie legt das Topologie-Schema ein Netz aus? | **Nach Streckengleisen: jede durchgehende Linie eine Zeile, Weichenverbindungen als kurze Schrägen dazwischen.** Kreuzungen im Schema sind erlaubt; kurze Wege gehen vor Kreuzungsfreiheit. Ersetzt die kreuzungsfreie Auslegung aus AP 9.6. Vom Auftraggeber gewählt am 2026-10-01. → AP 9.8 |
| 114 | Wie wird eine Punktwolke für räumliche Zwänge gezeigt? | **Als 2D-Streudiagramm im Querprofil, ±5 cm um die Schnittebene, nicht mit Potree.** Potree lädt nach Detailstufe und liefert in der Ferne bewusst nur eine Teilmenge; für die Frage „ragt etwas ins Profil" braucht es die tatsächlichen Punkte der Scheibe, und das Profilwerkzeug von Potree ließe sich nicht mit Lichtraum und Prüfung im eigenen Querprofil verbinden. Eine 3D-Ansicht bleibt als späteres Paket möglich. Vom Auftraggeber gewählt am 2026-10-02. → AP 11.4 |
| 115 | Wo liegt die Punktwolke? | **Im Browser, offline, im Origin Private File System — nicht im Datensatz und zunächst nicht auf dem Server.** 260–400 MB je km passen nicht in eine Revision; eingelesen wird die Datei lokal ohne Upload. Folge: eine Wolke liegt je Gerät und Browser. Das Kachelformat ist so gewählt, dass der Projektserver es später über Range-Requests ausliefern kann. Mit der Aufnahme von Phase 11 bestätigt am 2026-10-02. → AP 11.2 |
| 116 | Worauf beziehen sich die Kacheln — Lage oder Stationierung? | **Lage: 2 × 2 m im Projekt-KBS, ausgedünnt per Voxel.** Nach Station und Querabstand gespeichert, wäre die Wolke nach jeder Änderung der Achse veraltet und gälte nur für ein Gleis. Die LAZ selbst als Speicher abzufragen scheidet aus, weil eine Scheibe 12–13 ihrer Blöcke berührt (gemessen an `5550R_00004000m.laz`). Mit der Aufnahme von Phase 11 bestätigt am 2026-10-02. → AP 11.2 |
| 117 | Wie fein wird eine Punktwolke ausgedünnt? | **2-cm-Voxel, fest.** ~260 MB je km statt ~400 MB bei 1 cm (gemessen an `5550R_00004000m.laz`); genauer als rund 2 cm ist die Vermessung selbst kaum, und eine 10-cm-Scheibe behält fünf Voxel-Lagen. Vom Auftraggeber gesetzt am 2026-10-02. → AP 11.2 |
| 118 | Woher kennt der Import Lage- und Höhenbezug? | **Er fragt beide vor jedem Import ab, ohne Vorauswahl.** Der LAS-Header der Lieferungen nennt kein System, und es ist je Lieferung verschieden; eine Vorgabe würde durchgeklickt und legte die Wolke still daneben. Eine Plausibilitätsprobe gegen die Gleise des Projekts fängt die gröbsten Verwechslungen. Vom Auftraggeber gesetzt am 2026-10-02. → AP 11.2 |
| 119 | Wer weiß, dass ein Projekt eine Punktwolke hat? | **Nur das Gerät, auf dem sie eingelesen wurde.** Keine Referenz im Datensatz, nichts in Revisionen oder Merge; auf einem anderen Gerät gibt es die Wolke schlicht nicht. Vom Auftraggeber gesetzt am 2026-10-02. → AP 11.3 |
| 120 | Viele kurze oder wenige lange Dateien? | **Wenige lange.** Der Import liest also eine Datei von mehreren GB gestreamt, mit Fortschritt und Abbruch; ein Mehrfach-Import in einem Zug ist nicht nötig. Vom Auftraggeber beantwortet am 2026-10-02. → AP 11.1, 11.2 |
| 121 | Woher kommen die Lagen der LAZ-Blöcke? | **Aus der Chunktabelle, in JavaScript dekodiert.** `laz-perf` dekodiert einen Block (`ChunkDecoder`), legt die Tabelle aber nicht offen; ohne sie ginge nur die ganze Datei im Speicher (`LASZip`), was bei mehreren GB ausscheidet. Portiert sind der Arithmetik-Decoder und der Integer-Kompressor aus LASzip — nur der lesende Teil, rund 200 Zeilen, geprüft an allen 65 Blöcken der Beispieldatei gegen laspy. Beim Bauen festgelegt am 2026-10-02. → AP 11.1 |
| 122 | In welcher Ebene liegen die Kacheln, und wie wird umgerechnet? | **In der Ebene der meisten Gleise des Projekts** (ohne Gleise: im System der Datei). Umgerechnet wird je Zelle von 250 m affin aus der proj4-Umrechnung von Zellmitte und Ableitung (mit NTv2, auch im Worker geladen); Abweichung zu proj4 unter 0,2 mm. Weicht ein Gleis später in eine andere Ebene ab, rechnet der Querschnitt die Punkte zum Gleis um. Beim Bauen festgelegt am 2026-10-02. → AP 11.2, 11.4 |
| 123 | Wie werden die Kacheln gepackt? | **Sortiert nach Höhe, dann quer, dann längs, delta-codiert, zlib** — 3,85 B je Punkt statt 7 B roh. Ein Index (JSON) je Wolke nennt Kacheln und Segmente; er wird zuletzt geschrieben und macht die Wolke erst sichtbar, Verzeichnisse ohne Index räumt die Liste nach einer Stunde fort. Beim Bauen festgelegt am 2026-10-02. → AP 11.2 |
| 124 | Was zählt als Eingriff in den Lichtraum? | **Punkte im Profil des gewählten Gleises, mindestens 50 mm über SO, außerhalb der Einragungsbereiche.** Die Unterkante des Profils ist die Fahrfläche selbst — gemessene Schienenköpfe, Radlenker und Schotter lägen sonst immer im Profil. Punkte in Einragungsbereichen erscheinen orange und zählen nicht. Die Tiefe eines Eingriffs und der kleinste Abstand werden gegen Seiten und Dach des Profils gemessen, nicht gegen die Unterkante. Beim Bauen festgelegt am 2026-10-02. → AP 11.5 |
| 125 | Wie prüft man ein ganzes Gleis? | **In Schritten von 0,5 m mit einer Scheibe von 0,5 m**, an jeder Station mit deren Gradiente und Überhöhung; so wird jeder Punkt neben dem Gleis einmal geprüft. Aufeinanderfolgende Schritte mit Eingriff werden zu einer Stelle zusammengefasst; ein Klick springt im Querschnitt an deren tiefsten Eingriff. Beim Bauen festgelegt am 2026-10-02. → AP 11.5 |
| 126 | Wo liegt die Punktwolke im Querprofil? | **Unter der Zeichnung** (Canvas unter dem SVG, wie spezifiziert); Schwellen und Schienen werden halbdurchsichtig, solange Punkte da sind, damit die gemessenen Schienenköpfe gegen die geplante SO sichtbar bleiben. Beim Bauen festgelegt am 2026-10-02. → AP 11.4 |
| 127 | Wer sieht ein Projekt? (ersetzt den ersten Teil von 99) | **Der Ersteller, die Bearbeiter, die er einträgt, und alle Admins — sonst niemand.** Ein Projekt ist standardmäßig nur für seinen Ersteller und die Admins sichtbar; der Ersteller (oder ein Admin) sucht andere Nutzer nach Name oder Login und trägt sie als Bearbeiter ein (`project_member`, Migration 005). Bearbeiter sehen und bearbeiten das Projekt wie der Ersteller, verwalten aber keine Bearbeiter und löschen nichts. Wer keinen Zugriff hat, bekommt für Projekt, Variante und Revision ein 404 statt eines 403 — die Existenz eines fremden Projekts wird nicht verraten. **Vorlagen bleiben für alle sichtbar**, denn von ihnen abzweigen ist ihr Zweck. Beim Einspielen bleibt jeder, der schon eine Revision oder Variante in einem Projekt angelegt hat, darauf. Bilder (`/api/blobs/<hash>`) bleiben ohne Projektbindung: der Hash ist nur aus einem sichtbaren Datensatz bekannt. Rechte je Variante (Rest von 99/100) bleiben offen. Gewünscht vom Auftraggeber am 2026-10-02. |
| 128 | Was ist ein Achspunkt aus der Punktwolke? | **Die Mitte der beiden Schienenkopfmitten**, nicht die Mitte der Fahrkanten 14 mm unter SO. Die Kopfmitte stützt sich auf die ganze Kopfoberkante und braucht keine im Scan oft verdeckte Innenflanke; Seitenverschleiß verschiebt sie um die halbe Abnutzung und wird im Bericht genannt. Vom Auftraggeber gewählt am 2026-10-05. **Beim Bauen:** die Kopfmitte wird aus der Innenflanke plus halber Nennbreite bestimmt, nicht aus der Kopfoberkante — deren Außenseite ist im Scan verschmiert; für die Achse ist beides dasselbe, solange beide Köpfe gleich breit sind. → AP 12.1 |
| 129 | Woran orientiert sich die Suche nach den Köpfen? | **An einem vorhandenen Gleis oder an einer grob gezeichneten Linie.** Gezeichnet wird über dem Umriss der Wolke, wie die Karte ihn heute zeigt — eine Draufsicht der Punktwolke als Kartenebene gibt es dafür nicht. Vom Auftraggeber gesetzt am 2026-10-04/05. → AP 12.2 |
| 130 | Welche Höhe ist die SO eines Achspunkts? | **Einstellbar, Vorgabe nach DB: die Kopfoberkante der tieferen Schiene; die Überhöhung wird von dort nach oben gemessen.** Gespeichert werden beide Kopfhöhen roh, SO und Überhöhung werden abgeleitet; eine Übernahme in die Gradiente rechnet immer nach der DB-Regel, wie `track.heights` definiert ist. Vom Auftraggeber gesetzt am 2026-10-04. → AP 12.2 |
| 131 | Welche Schienenmaße gelten? | **49 E5, 54 E4, 60 E2 nach DIN EN 13674-1 (Maße aus dem Dlubal-Katalog), die Abnutzung als Mindestmaß** — eine 54 E4 darf eine Kopfhöhe von 44,2 bis 55 mm haben. Die alten Namen bleiben in Klammern („54 E4 (S 54)"), weil MDB-Bestand und alte Zeichnungen sie führen. Vom Auftraggeber gesetzt am 2026-10-05. → AP 12.1 |
| 132 | Wo liegen die Achspunkte? | **Im Datensatz, geteilt — als eigene Sammlung `axisSurveys`, nicht an ein Gleis gebunden**, im Merge ein ganzes Objekt. Anders als die Wolke (Entscheidung 119) sind sie klein (~60 kB je km) und die Grundlage einer Trassierung, die nachvollziehbar bleiben soll. Vom Auftraggeber gesetzt am 2026-10-05. → AP 12.2 |
| 133 | Wie entsteht die Trassierung? | **Automatischer Vorschlag, von Hand korrigierbar:** Geraden nach dem Verfahren des Auftraggebers (6 m, 1 cm, Schritt 0,5 m, 6 m Abstand) mit Ausgleichsgerade, Krümmungstest und Mindestlänge; Bögen dazwischen über die Splice-Mathematik, R und Übergangsbögen an die Achspunkte ausgeglichen; Bruchstellen im Krümmungsbild verschiebbar. Vom Auftraggeber bestätigt am 2026-10-05. → AP 12.3, 12.4 |
| 134 | Wohin geht das Ergebnis? | **In ein neues Gleis**, nicht in die Geometrie eines bestehenden. Vom Auftraggeber gesetzt am 2026-10-05. → AP 12.4 |
| 135 | Welche Spurweite? | **Nur Normalspur.** Vom Auftraggeber gesetzt am 2026-10-05. → AP 12.1 |
| 136 | Was geschieht an Weichen? | **Zunächst eine gemeldete Lücke**; ein abzweigender Strang wäre eine eigene Verfolgung. Vom Auftraggeber gesetzt am 2026-10-05. → AP 12.2 |
| 137 | Wo wird trassiert — Browser oder Python-Dienst? | **Im Python-Dienst.** Die Splice-Funktion zieht dorthin um und wird überarbeitet, damit sie gut funktioniert; nach dem Architekturgrundsatz entfällt die JS-Fassung, das Panel „Elemente verbinden" ruft den Dienst. Ersetzt den Vorschlag „im Browser". Vom Auftraggeber gesetzt am 2026-10-05. → AP 12.4, 12.5 |
| 138 | Was ist die Schnittstelle zwischen Erkennung und Trassierung? | **Eine Punktdatei mit Rechtswert, Hochwert, SO und Überhöhung je Achspunkt** (CSV, siehe *Export der Achspunkte*). Stufe A exportiert sie, Stufe B liest sie — auch von außen gelieferte Punkte. Vom Auftraggeber gesetzt am 2026-10-05. → AP 12.2, 12.5 |
| 139 | Was heißt es, dass der Splice im Dienst rechnet? | **„Elemente verbinden" braucht den Dienst** — ohne ihn sagt das Panel das und bietet nichts an; jede Änderung der Einstellungen fragt ihn neu (150 ms entprellt, ein paar Millisekunden Rechnung). Die App setzt nur noch die Antwort zum neuen Gleis zusammen (Geschwindigkeit, Überhöhung, die Elemente jenseits der Schnitte). Beim Umzug überarbeitet: passt ein Bogen nicht, nennt die Antwort den größten Radius, der passt; stehen zwei Geraden rechtwinklig, werden beide Anschlussrichtungen probiert; ein umgeformter Bogen, der den langen Weg um seinen Kreis nehmen müsste, wird abgelehnt statt mit Knick gebaut (das tat die JS-Fassung). Folgt aus Entscheidung 137, gebaut am 2026-10-05. → AP 12.4 |
| 140 | Wo steht das Krümmungsbild? | **Im Panel**, wie spezifiziert — nicht als Overlay über der Karte: zoombar mit dem Mausrad, das Panel ist breiter ziehbar, und die Karte bleibt frei für die Trasse und die Achspunkte. Beim Bauen festgelegt am 2026-10-05. → AP 12.5 |
| 141 | Was geschieht, wenn zwischen zwei Geraden kein Bogen passt? | **Automatisch gefunden: die beiden werden eine Gerade, die Station wird genannt** — zwei Geraden, die gegeneinander versetzt statt gedreht sind, sind ein Versatz in der Messachse (an 5550L bei 233 m: 13 cm), und eine ganze Trassierung mit gemeldeter Abweichung hilft mehr als keine. **Von Hand gesetzt: ein Fehler mit der Stelle**, denn dann sind die Geraden die Entscheidung des Nutzers. Beim Bauen festgelegt am 2026-10-05. → AP 12.5 |
| 142 | Was geschieht, wo die Punkte in einem Bogen beginnen oder enden? | **Der Bogen wird vom Tangentenpunkt der Geraden aus angepasst und am ersten bzw. letzten Punkt geschnitten**, das neue Gleis beginnt oder endet dort auch in einem Bogen oder Übergangsbogen. Zeigt κ, dass der Bogen vor dem Ende wieder ausläuft, werden Auslauf und Gerade dahinter mit angepasst. Beim Bauen festgelegt am 2026-10-05. → AP 12.5 |
| 143 | Wann liegt „kein Übergangsbogen in den Punkten"? | **Wenn der Ausgleich ohne ihn um weniger als 0,5 mm RMS schlechter ist** — geprüft nur für Übergangsbögen, die den Bogen um weniger als 2 cm abrücken (L²/24R); einen größeren Versatz können die Punkte nicht übersehen. Beim Bauen festgelegt am 2026-10-05. → AP 12.5 |
| 144 | Woher kennt der Import die Ausdehnung einer E57-Datei? | **Aus `cartesianBounds`, gedreht und verschoben mit der Pose — geprüft an den Punkten der ersten 256 KB des Scans.** Die Norm legt die Grenzen in den Rahmen des Scans, manche Schreiber (pye57) in den der Datei; passt die gedrehte Box nicht zu den Punkten, gilt die Box wie geschrieben, passt keine (oder fehlt sie), die der gelesenen Punkte (mit `sphericalBounds.rangeMaximum` um den Standpunkt, wo angegeben). Die Ausdehnung dient nur der Lageprobe und dem Laden der NTv2-Gitter; die gespeicherte Wolke kennt ihre echten Grenzen aus den Punkten. Festgelegt am 2026-10-05. → AP 11.6 |
| 145 | Lässt sich eine Punktwolke auch ungedünnt einlesen? | **Ja, als Wahl im Import: „Original" hält jeden Punkt, mit den Koordinaten und der Genauigkeit der Datei, im System der Datei.** Vorgabe bleiben die 2-cm-Voxel (Entscheidung 117). Bei „Original" wird weder ausgedünnt noch auf absolute Millimeter gerundet (das verschob die Punkte der Beispieldatei um bis zu 0,5 mm, weil ihr Offset nicht auf ganzen Millimetern liegt), sondern das ganzzahlige Raster der Datei behalten — eine LAS/LAZ kommt bitgenau zurück; E57 hat Gleitkommazahlen und eine Pose und wird auf 0,1 mm gehalten. Umgerechnet wird erst beim Lesen, zum Gleis. Preis: rund 3,5–4,5 B je Punkt statt ~1,1 B je gelesenem Punkt, also das Drei- bis Vierfache an Speicher, und mehr Punkte je Scheibe. Vom Auftraggeber gewünscht am 2026-10-05. → AP 11.7 |
| 146 | Wie wird der S-Bahn-Lichtraum gewählt? | **Als zwei Profile: „S-Bahn" (Umriss 2400, Einragung für Signale oder Masten bis 2100) und „S-Bahn-Tunnel" (Umriss 1900, keine Einragung für Signale oder Masten).** Als ein Profil mit drei Einragungen galt eine Wand bei 2000 mm auch auf freier Strecke als erlaubte Einragung; die 1900 des Tunnels ist dort der Umriss. Die Bahnsteig-Einragung gilt in beiden, im Tunnelprofil an 1900 geschnitten. Die Wahl bleibt je Projekt. Vom Auftraggeber gesetzt am 2026-10-05. |
| 147 | Woher kennt die Prüfung die Streckenart? | **Je Gleis, Vorgabe aus dem Projekt** (Hauptbahn, wenn nichts gesetzt ist). Das Projekt setzt sie im Höhenprofil-Panel, ein Streckengleis kann in seinen Gleisangaben abweichen. Vom Auftraggeber gesetzt am 2026-10-06. → Höhenplan-Regeln |
| 148 | Wie wird ein Tunnel angegeben? | **Noch gar nicht — die Tunnelregel (HP.LN.03) steht im Katalog und wird angewendet, sobald ein Tunnel angegeben werden kann.** Vom Auftraggeber gesetzt am 2026-10-06. → Höhenplan-Regeln |
| 149 | Welche Abschnitte von Bahnhofsgleisen gelten als Halte- oder Abstellbereich? | **Das ganze Bahnhofsgleis**, und jede Planung gilt als Neubau (OP.11). Vom Auftraggeber gesetzt am 2026-10-06. → Höhenplan-Regeln |
| 150 | Welche Stufe gibt ein nicht eingehaltener „soll"-Wert der Längsneigung? | **Warnung** (Regelwert, zu begründen). Vom Auftraggeber gesetzt am 2026-10-06. → Höhenplan-Regeln |
| 151 | Wie wird die Ausrundungstabelle (Tabelle 12) gelesen? | **Höchstwert 25000 m → Fehler; unter dem Regelwert (0,4·v², mindestens 2000 m; über 230 km/h 22500 m) Warnung; unter der Ermessensgrenze (0,25·v², mindestens 2000 m; über 230 km/h 16000/14000 m Kuppe/Wanne) Zustimmung; unter dem Zustimmungswert (0,16·v² Kuppe, 0,13·v² Wanne) Fehler.** l_a ≥ 20 m als Regelwert; in Gleisverbindungen bis 80 km/h und Δs ≤ 4,5 ‰ genügen 10 m mit r_a ≥ 2000 m. Ohne Ausrundung bis Δs ≤ 1 ‰, auf Nebengleisen und in Weichenverbindungen bis 4,5 ‰; eine fehlende nötige Ausrundung ist ein Fehler, eine überflüssige ein Hinweis. Neigungswechsel in Überhöhungsrampen und Weichen: Hinweis, unter dem Regelwert Warnung. Maßgebend ist die größte design speed unter der Ausrundung; ohne sie bleiben Länge und Halbmesser ungeprüft. Vorgaben des Auftraggebers vom 2026-10-06, Lesart beim Bauen festgelegt (OP.13). → Höhenplan-Regeln |
| 152 | Was ist eine Gleis- bzw. Weichenverbindung? | **Ein Gleis, das an beiden Enden in eine Weiche läuft und dazwischen höchstens 20 m lang ist.** Eine einzelne Weiche in einem Hauptgleis macht es nicht zur Verbindung, sonst käme dort Δs ≤ 4,5 ‰ ohne Ausrundung durch. Vom Auftraggeber gesetzt am 2026-10-06. → Höhenplan-Regeln |
| 153 | Woher kommt „Nebengleis"? | **Aus einer neuen Gleisangabe „Gleisnutzung" (Hauptgleis/Nebengleis), Vorgabe Hauptgleis**, für Strecken- und Bahnhofsgleise; Streckenart und Gleisnutzung gehen über die `olt`-Erweiterung mit in die Austauschdatei. Beim Bauen festgelegt am 2026-10-06. → Höhenplan-Regeln |
| 154 | Wie hängt die Gradiente einer Weiche zusammen? | **Stamm- und Zweiggleis liegen von WA bis zur letzten durchgehenden Schwelle (ldS) auf einer Ebene: z_Zweig = z_Stamm + u/1500 · y**, mit u der vorzeichenbehafteten Überhöhung des Stammgleises (positiv hebt die linke Schiene) und y dem Achsabstand des Zweiges links vom Stammgleis auf der Schwelle rechtwinklig zum Stammgleis. Ohne Überhöhung haben beide dieselbe Höhe; zur hohen Seite liegt der Zweig höher, zur tiefen tiefer. Rechenweg des Auftraggebers (105,75 + 0,05 · 2720/1500) bestätigt, vorgeschlagen und gesetzt am 2026-10-06. → Gekoppelte Gradiente |
| 155 | Wer führt, und was wird gespeichert? | **Das Stammgleis führt.** Gespeichert wird am Zweig nur der Punkt an der ldS (und vorhandene Punkte zwischen WA und ldS) mit der Höhe der Ebene; WA ist ein Gelenkpunkt. Zwischenhöhen der Ebene werden nur für die Darstellung berechnet (Querprofil, Freiraumprüfung), nie gespeichert. Der Store koppelt nach jedem Schreiben, das eine Weiche berührt, im selben Undo-Schritt; gekoppelte Punkte sind im Höhenprofil gesperrt. Vom Auftraggeber gesetzt am 2026-10-06. → Gekoppelte Gradiente |
| 156 | Was ist der Weichenbereich im Höhenplan, und wie streng? | **WA bis ldS, auf Stamm- und Zweiggleis; ein Neigungswechsel darin (Punkt dazwischen oder Ausrundung, die hineinreicht) ist eine Warnung (HP.AR.06)** — erlaubt, aber zu begründen. HP.AR.05 gilt nur noch für Überhöhungsrampen. Ohne ldS im Katalog reicht der Bereich bis WE. Vom Auftraggeber gesetzt am 2026-10-06. → Gekoppelte Gradiente |
| 157 | Woher kommt die ldS? | **Aus dem Weichenkatalog (db-ril-800-0120, Feld `lds`) als Abstand hinter WE**, vom Auftraggeber am 2026-10-06 geliefert: 190–1:7,5 3,348; 190–1:9, 300–1:9, 300–1:9,4 3,940; 215–1:4,8 0 (WE = ldS); 500–1:12 6,334; 500–1:14, 760–1:14, 760–1:15, 300–1:14 5,125; 760–1:18,5, 1200–1:18,5, 1200–1:19,277 9,920; 2500–1:26,5 13,145 m. WE ist das Ende der Stammgleiselemente der Weiche. Für 190–1:6,3 fehlt der Wert: dort keine Kopplung. → Gekoppelte Gradiente |
| 158 | Welche Weichen werden gekoppelt? | **Nur Weichen (turnout), deren Stamm- und Zweiggleis eine Gradiente über WA–ldS haben** — keine wird erfunden (Entscheidung 64). Kreuzungen und Kreuzungsweichen nicht; ihr Weichenbereich reicht im Höhenplan bis zu ihren Enden. Beim Bauen festgelegt am 2026-10-06. → Gekoppelte Gradiente |
| 159 | Wann wird eine Weichenverbindung im Bogen angeglichen? | **Nach dem Anlegen fragt der Weichendialog, ob die Höhenlage beider Gleise angepasst werden darf** (nur wenn an einer der beiden Weichen Überhöhung liegt); dasselbe Werkzeug öffnet das Höhenprofil-Panel jederzeit für jede Weichenverbindung des Projekts. Bedingung: beide Gleise liegen über die Weichenverbindung in einer Ebene, z₂ − z₁ = u/1500 · y (y = Abstand des zweiten Gleises links vom ersten). Vom Auftraggeber gesetzt am 2026-10-06. → Weichenverbindung angleichen |
| 160 | Wie wird die Höhenkorrektur auf die Gleise verteilt? | **Hälftig, je Gleis in den Grenzen für Heben und Senken; reicht die Grenze eines Gleises nicht, übernimmt das andere den Rest, reicht beides nicht, wird nichts geändert** und der nötige Unterschied genannt. Ein Gleis, das nicht angepasst werden darf, hat die Grenzen 0. Vom Auftraggeber gesetzt am 2026-10-06. → Weichenverbindung angleichen |
| 161 | Welche Form hat die Anpassung? | **Über den Verbindungsbereich (vom ersten WA bis zur letzten ldS, mit dem, was ihm auf dem anderen Gleis gegenüberliegt) läuft jedes Gleis gerade mit dem nötigen Versatz; bis zu den Enden des markierten Bereichs läuft der Versatz linear auf 0 aus.** Neigungswechsel werden ausgerundet, wo HP.AR.01 es verlangt, mit dem Regelwert nach Tabelle 12, und die Gerade wird so weit verlängert, dass die Ausrundungen außerhalb der Weichen liegen (HP.AR.06). Reicht der Bereich für die Ausrundungen nicht, sagt das Werkzeug es vorher. Der Bereich wird je Gleis als Länge vor und hinter der Verbindung angegeben oder auf der Karte markiert. Vom Auftraggeber gesetzt am 2026-10-06. → Weichenverbindung angleichen |
| 162 | Wie wird „Überhöhung aus Gleislage" gesetzt? | **u aus dem mittleren Höhenunterschied, auf 5 mm gerundet (LP.KB.03), für den Bogen beider Gleise** — die zusammenhängenden Kreisbögen gleichen Radius und gleicher Überhöhung um die Verbindung; der Rundungsrest wird über die Höhenlage in den Grenzen ausgeglichen. Eine Überhöhung zur Bogeninnenseite wird abgelehnt; liegt die Verbindung nicht im Kreisbogen, lässt sich u nicht setzen. Vom Auftraggeber gesetzt am 2026-10-06. → Weichenverbindung angleichen |
| 163 | Was ist eine Weichenverbindung, und was bekommt ihr Verbindungsgleis? | **Zwei Weichen, deren Zweige die beiden Enden eines Gleises sind.** Als Weichenverbindung im Sinne von HP.AR.01/02 zählt die Länge zwischen den Weichen, also ohne die Zweigelemente der beiden Weichen auf dem Verbindungsgleis (Korrektur zu Entscheidung 152). Ein Verbindungsgleis ohne Gradiente bekommt beim Angleichen die Höhen der beiden Weichenanfänge, die Kopplung legt die ldS-Punkte dazu. Beim Bauen festgelegt am 2026-10-06. → Weichenverbindung angleichen |
| 164 | Was ist eine Außenbogenweiche, deren Zweig durch das Biegen gerade wird? | **Eine EW, bei der Stamm- und Zweiggleis getauscht sind — und so wird sie gebaut.** Das bestehende Bogengleis ist der Zweig (B1, Länge des Zweigs der Form), das gerade Gleis der Stamm (B2); Bauform EW, Symbol und Maße der ungebogenen Form. Gilt in Weiche auf Gleis, Weiche am Gleisende (stumpf und spitz) und Weichenverbindung, wenn der Zweig über die ganze Weiche gerade ist. Der Datensatz trägt `swapped: true`; Strecke, Höhenkopplung (Hauptstrecke führt), Weichenverbindungs-Erkennung, Schema und Löschen folgen dann B1. In der Weichenverbindung bleibt die Stammlänge die Zweiglänge der Form (2,4 cm kürzer bei 500-1:12). Vom Auftraggeber gesetzt am 2026-10-06. → ABW mit geradem Zweig |
| 165 | Wo liegt eine Weiche der Weichenverbindung, deren WA genau auf einem Elementknoten liegt? | **Auf dem Knoten: das Gleis wird dort am Stoß geteilt, nicht im Element** — sonst bliebe ein Element der Länge 0. Beim Bauen festgelegt am 2026-10-06. → ABW mit geradem Zweig |
| 166 | Wie hält eine Weichenverbindung die Mindestelementlänge? | **Bliebe vor WA ein Stück des Elements unter l_min (LP.EL.01 bei der Geschwindigkeit des Elements), wird die Weiche auf den Elementpunkt dahinter geschoben** — die erste über die Verschiebung, die zweite über die Verschiebung, die ihr WA dorthin bringt. Danach müssen alle vier Reststücke (vor WA und hinter WE, auf beiden Gleisen) null oder mindestens l_min sein, sonst ist es ein Fehler, der das Übernehmen sperrt. Nie auf ein offenes Gleisende geschoben. Ohne Geschwindigkeit ab 40 km/h wird nicht geprüft und das gesagt. Vom Auftraggeber gesetzt am 2026-10-06 (v des durchgehenden Gleises; „Weichenübergang" = WA auf den Elementpunkt). |
| 167 | Was heißt beim Verbinden „Gleisabstand zu einem Gleis halten"? | **Die eingefügten Elemente (Bogen, Übergangsbögen, Zwischengerade) halten an jeder Stelle (1 m) zur Achse eines in der Karte gewählten Gleises mindestens d_min plus die Vergrößerung aus der Überhöhung.** Geprüft beim eingegebenen Radius, oder gesucht: der größte Radius, der es hält, die Überhöhung dabei nach der Regel der App (`computeAutoC`), über Übergangsbögen als Rampe (Bloss-Form bei Bloss). Alle Fälle: Gerade–Gerade und Bogen–Gerade suchen, zwei Bögen haben keinen freien Radius und werden nur geprüft. Gerechnet im Optimierdienst (`clearance.py`). Vom Auftraggeber gesetzt am 2026-10-06. |
| 168 | Wie groß ist die Vergrößerung aus der Überhöhung? | **Geometrisch (Variante a):** beide Lichtraumumrisse des Projektprofils werden um ihre Überhöhung um die tiefere Schiene gekippt, wie das Querprofil sie zeichnet; die Vergrößerung ist, wie viel weiter die Gleismitten dann auseinander müssen, damit die Umrisse sich nicht überschneiden, gegenüber u = 0. Beide Gleise auf gleicher Höhe der tieferen Schiene. u = 150 mm zum Nachbarn geneigt gibt ~0,30 m, gleich geneigt ~0,02 m. Vom Auftraggeber gesetzt am 2026-10-06. |
| 169 | Wo endet die Suche zwischen Bogen und Gerade? | **Am kürzesten Bogen, den LP.EL.01 bei der Geschwindigkeit des Dialogs erlaubt** — sonst läuft der alte Bogen bis an die Gerade, und dazwischen passt ein Splitter jedes Radius. Ohne Geschwindigkeit endet sie bei 50 000 m. Beim Bauen festgelegt am 2026-10-06. |
| 170 | Wo legt der Weichenverbindungsdialog die Weiche hin, und wie genau lässt sie sich schieben? | **Der Dialog legt WA zuerst auf den Elementwechsel hinter der Weiche** — die erste Weiche, sonst die zweite, wo beide gehen die näher am Klick; ein offenes Gleisende ist kein Elementwechsel. Der Schieber zeigt den Abstand von WA zum Elementwechsel und hält auf ganzen Metern davon, auf den genauen Enden des gültigen Bereichs und dort, wo WA der zweiten Weiche auf ihrem Elementwechsel liegt — so ist ein Reststück null auch ohne Entwurfsgeschwindigkeit erreichbar. Gleis 1/2 zeigen den Gleisnamen. Vom Auftraggeber gesetzt am 2026-10-06. |
| 171 | Welche Gradiente hat ein durch „Elemente verbinden“ entstandenes Gleis? | **Die des Abgangsgleises bis dorthin, wo das neue Gleis noch auf ihm liegt, die des Ankunftsgleises ab dort, wo es wieder auf ihm liegt, und dazwischen eine einzige gerade Neigung von der einen zur anderen — ohne Punkt dazwischen und ohne Ausrundung an den beiden Anschlusspunkten.** Endet eine Gradiente vor ihrem Schnitt (Elementlänge dahinter geändert), läuft die Gerade von ihrem letzten Punkt aus; hat nur eines der Gleise überhaupt eine Gradiente, behält das neue Gleis nur diese. Vom Auftraggeber gesetzt am 2026-10-06, nachgeschärft am selben Tag (Fehler im Projekt SBSS). |
| 172 | Was geschieht beim Löschen von Elementen mit Achse und Gradiente? | **Beliebig viele Elemente, auch auf mehreren Gleisen, werden in einem Schritt gelöscht (Klick wählt/abwählt, Umschalt-Klick wählt bis dorthin). Was von einem Gleis bleibt, zerfällt in seine zusammenhängenden Stücke; das erste behält den Namen. Wo die Achse getrennt wird, bekommt jedes Stück einen Höhenpunkt auf der Gradiente, wie sie gebaut wird (in einer Ausrundung deren Stück).** Ebenso beim Ändern einer Elementlänge: die behaltene Gradiente endet mit einem Punkt an der Elementgrenze. Eine Weiche an einem gelöschten Ende geht mit, wie beim Gleis löschen; Elemente einer Weiche werden mit der Weiche gelöscht, nicht hier; ein Bahnsteig bleibt auf seinem Stück oder geht, wenn der Schnitt durch ihn läuft. Vom Auftraggeber gesetzt am 2026-10-06. |
| 173 | Wie gerade ist die Gerade über einer angeglichenen Weichenverbindung? | **Eine einzige Neigung je Gleis: die Gerade durch die Höhen an den beiden Enden des Verbindungsbereichs, verlängert bis zu den Ausrundungen — über die Weiche und das Gleisstück vor ihrem WA hinweg.** Vorhandene Höhenpunkte auf der Geraden entfallen bis auf Anfang und Ende eines Gleises (die Gleisstöße am WA); diese liegen exakt auf der Geraden (µm statt mm), damit beidseits des Stoßes dieselbe Neigung steht. Ein Verbindungsgleis ohne Gradiente bekommt die Höhen der Weichenanfänge ebenso exakt. Vom Auftraggeber gewünscht am 2026-10-07 (SBSS: switch.002 7,4 ‰, track.004 7,3 ‰). → Weichenverbindung angleichen |
| 174 | Wie setzt der Knopf „Regelwert“ im Höhenprofil die Ausrundung? | **R nach Tabelle 12 (HP.AR.03) bei der Entwurfsgeschwindigkeit, mindestens so groß, dass die Ausrundung 20 m lang ist (HP.AR.02), höchstens 25 000 m, auf volle 100 m aufgerundet; wo HP.AR.01 keine Ausrundung will, wird sie entfernt.** Maßgebend ist das schnellste Element unter der Ausrundung, für die Länge der neuen Ausrundung neu bestimmt. Gilt für alle gewählten inneren Punkte und wird sofort übernommen; gekoppelte Punkte und Gleisenden bleiben, ohne Geschwindigkeit bleibt der Punkt und das Panel sagt es. Gewünscht am 2026-10-07, beim Bauen festgelegt. → Höhenprofil |
| 175 | Was geschieht mit einem Übergangsbogen, wenn sich der Radius des Bogens daneben ändert? | **Er folgt: der davor bekommt den neuen Radius als Endradius, der danach als Anfangsradius; seine Länge bleibt.** Nur wo er tangential an den Bogen anschloss, nicht in Weichen; wird der Bogen zur Geraden, laufen sie in die Gerade aus. Der Bogen beginnt am neuen Ende des Übergangsbogens, der Rest wird wie jede Änderung nachgeführt. Gewünscht am 2026-10-07. → Trackeditor |
| 176 | Was sind Regellänge und Mindestlänge eines Übergangsbogens? | **Regellänge: die kürzeste Länge, bei der jede Längenregel (LP.EL.01, LP.UB.03–07) ihren Regelwert hält; Mindestlänge: bis zur Ermessensgrenze, wo die Regel eine hat, sonst ihr Regelwert — kürzer braucht eine Zustimmung oder ist ein Fehler.** Aus dem Katalog gesucht, auf volle 0,1 m aufgerundet; unter jedem Knopf jede Längenregel mit Formel und Wert, die maßgebende hervorgehoben. LP.UB.08 (flachste Rampe) begrenzt nach oben und bleibt der Prüfung. Gewünscht am 2026-10-07 („immer die kleinstmögliche“), die Lesart der Mindestlänge beim Bauen festgelegt und am selben Tag bestätigt. → Übergangsbögen, Paket S |
| 177 | Was prüft ein Verbinden-Dialog am Übergangsbogen? | **Den Übergangsbogen in der Kette, in die er gelegt wird, samt Stoß zum Element davor; jeder Fehler sperrt das Übernehmen** (wie Entscheidung 52). „Gerade/Bogen verbinden“: letztes Element des Gleises, Übergangsbogen, neues Element. „Zwei Gleise zusammenfügen“: das Gleis, das entstünde; die Längen dort aus dem gelösten Gleis, vorher für den ungünstigeren Krümmungssinn (wird mit AP S.3 ersetzt). Beim Bauen festgelegt am 2026-10-07. → Übergangsbögen, Paket S |
| 178 | Welches gewählte Element ist beim Zusammenfügen der Abgang? | **Das, dessen Ende zur Lücke zeigt — gleich, welches zuerst geklickt wurde.** Liegt die Lücke zwischen dem Ende des zweiten und dem Anfang des ersten, werden die beiden getauscht; sonst bleibt es wie geklickt. Vorläufig im Browser (`orderPicks`), zieht mit AP S.2 in den Dienst. Fehler im Projekt SBSS, behoben am 2026-10-07. → Paket S |
| 179 | Mit welcher Länge starten die Übergangsbögen beim Zusammenfügen? | **Im Modus *Regellänge*:** jede Seite bekommt die kürzeste Länge, die alle Regelwerte hält (Entscheidung 176), und der Dienst rechnet sie nach jeder Änderung neu. Umschaltbar je Seite auf *Mindestlänge* oder eine feste Länge. Ersetzt die festen 60 m. Vom Auftraggeber gewählt am 2026-10-07. → AP S.3 |
| 180 | Was geschieht, wenn der Dienst mehrere gültige Lösungen findet? | **Die beste nach fester Rangfolge wird vorgeschlagen und in der Karte gezeigt; die übrigen lassen sich im Panel durchschalten** — das Umschalten erscheint nur, wo es Alternativen gibt (andere Anschlussrichtung, Bogen–Gerade–Bogen statt direktem Übergangsbogen). Vom Auftraggeber gewählt am 2026-10-07. → AP S.2, S.5 |
| 181 | Welche Entwurfsgeschwindigkeit ist beim Zusammenfügen vorbelegt? | **Die größere der beiden gewählten Elemente** — die Regeln prüfen gegen den strengeren Fall. Hat nur eines eine Geschwindigkeit, gilt diese; haben beide keine, bleibt das Feld leer, und das Panel sagt, dass ohne sie nicht geprüft wird. Vom Auftraggeber gewählt am 2026-10-07. → AP S.3 |
| 182 | Welches Gleis wird beim Zusammenfügen umgedreht, wenn sich zwei Enden oder zwei Anfänge treffen? | **Das kürzere** (Länge des ganzen Gleises), gleich, welches zuerst geklickt wurde: zwei Enden — das längere geht ab, das kürzere wird rückwärts eingefaltet; zwei Anfänge — das kürzere geht rückwärts ab. Das neue Gleis trägt Namen und Daten des Gleises, das seine Richtung behält. Sind beide gleich lang, wird das zweite gewählte umgedreht. Eine Lösung, die mehr als einen Halbkreis über die beiden gewählten Elemente hinaus dreht (Schleife), wird nicht angeboten. Beim Bauen festgelegt am 2026-10-07. → AP S.2 |
| 183 | Was bietet der Dienst an, wenn zwei Bögen sich so, wie gewünscht, nicht (gut) verbinden lassen? | **Immer auch die andere Verbindungsart:** direkt über einen Übergangsbogen statt über eine Zwischengerade und umgekehrt. Die gewünschte Art steht bei gleichem Befund vorn; hat die andere geringere Befunde (etwa ein zu kurzer direkter Übergangsbogen), wird sie vorgeschlagen, und „So verbinden“ übernimmt sie als Einstellung. Die Zwischengerade kommt mit den gewünschten Übergangsbögen, und wo keine gewünscht waren, mit Übergangsbögen in Regellänge (ohne Geschwindigkeit ohne). Passt nur die andere Art, sagt das Panel, warum die gewünschte nicht passt. Passt gar nichts, nennt die Fehlermeldung, was passen würde: den größten Radius darunter, zwischen Bogen und Gerade auch den kleinsten darüber, und die längsten Übergangsbögen (gleich lang auf beiden Seiten). Beim Bauen festgelegt am 2026-10-07. → AP S.5 |
| 184 | Wie wird ein Übergangsbogen am Gleisende zusammengefügt? | **Als der Punkt, in dem er endet: ohne Länge, mit Richtung und Krümmung dort, nur an diesem Ende anschließbar.** Der Übergangsbogen bleibt, wie er ist; was der Dienst von dort weiterbaut (ein Stück Gerade oder Bogen seines Endradius, dann die Verbindung), ist neu und trägt seine Geschwindigkeit, als Überhöhung die des Übergangsbogens selbst (ohne Nachbarn dahinter: keine). Ein Übergangsbogen mitten im Gleis bleibt unwählbar. Beim Bauen festgelegt am 2026-10-07. → AP S.7 |
| 185 | Wie werden die Übergangsbögen beim Zusammenfügen vorbelegt, und was zeigen die Längenknöpfe? | **Beim Einschalten der Übergangsbögen wird je Seite einmalig die Regellänge gesetzt, sobald der Dienst sie nennt; danach ist die Länge fest, und die Knöpfe „Regellänge“/„Mindestlänge“ setzen den Wert, der jetzt gilt.** Die Knöpfe sind klein und nennen nur die maßgebende Regel mit Formel. Passt keine Lösung, nennt der Dienst die Längen trotzdem (`lengths` der Fehlerantwort) — aus gewähltem Element und eingefügtem Bogen bzw. Zwischengerade, beim Bogen neben einem Bogen in der Hand der Lösung ohne Übergangsbögen, sonst als der strengere Gegenbogen. Ersetzt den mitlaufenden Modus aus Entscheidung 179 und die Liste aller Längenregeln aus 176, auch in „Gerade/Bogen verbinden“. Vom Auftraggeber gewünscht am 2026-10-07. → Paket S |
| 186 | Was wird bei „Bestehende Elemente neu verbinden“ gewählt? | **Erstes und letztes Element auf einem Gleis, alles dazwischen; ein Übergangsbogen daneben wird mit ersetzt.** Kein Element einer Weiche in der Wahl; vor und hinter ihr muss das Gleis weitergehen. Die Nachbarn sind die beiden Picks des Splice: eine Gerade oder ein Bogen wird umgeformt wie beim Zusammenfügen, ein Element einer Weiche bleibt und es wird von seinem Ende aus weitergebaut (wie AP S.7). Beim Spezifizieren festgelegt am 2026-10-07. → Paket N |
| 187 | Welche Punkte werden festgehalten, und wo? | **Die Achse der gewählten Elemente und der umformbaren Nachbarn alle 1 cm, im Browser berechnet, im Panel gehalten (nicht im Projekt gespeichert) und als ganze Millimeter zu einem Ursprung an den Dienst geschickt.** In der Karte als dünne graue Linie. Beim Spezifizieren festgelegt am 2026-10-07. → Paket N |
| 188 | Was ist die Abweichung? | **Der größte Abstand zwischen alter und neuer Achse, in beide Richtungen gemessen (jeder Punkt zur neuen Achse, die neue Achse zu den Punkten); daneben der quadratische Mittelwert.** Vorbelegt sind 0,10 m. Beim Spezifizieren festgelegt am 2026-10-07. → Paket N |
| 189 | Was sucht der Dienst ab? | **Den Radius (50–50 000 m, ganze Meter) mit der Überhöhung, die die App für ihn vorschlägt, und die Übergangsbögen in Regellänge, in Mindestlänge oder ohne; zwischen zwei Bögen die Zwischengerade in diesen drei Arten oder einen direkten Übergangsbogen.** Der Radius lässt sich im Panel fest vorgeben. Die Konstruktion ist die von „Zwei Gleise zusammenfügen“ (`splice.py`). Beim Spezifizieren festgelegt am 2026-10-07. → Paket N |
| 190 | Was ist die beste Lösung? | **In der Toleranz vor außerhalb; dann der leichteste Befund des Regelkatalogs (ok vor Hinweis vor Warnung); dann die kleinste größte Abweichung; dann die kleinste mittlere.** Geprüft wird bei der gewünschten Geschwindigkeit. Je Variante wird die beste gezeigt, die beste zuerst, die anderen lassen sich durchschalten. Außerhalb der Toleranz oder mit einem Fehler sperrt das Übernehmen. Beim Spezifizieren festgelegt am 2026-10-07. → Paket N |
| 191 | Was geschieht beim Übernehmen? | **Entfernen und Neuverbinden sind ein Schritt (ein Rückgängig); das Gleis behält ID, Name und Daten.** Eingefügtes bekommt die gewünschte Geschwindigkeit und die Überhöhung der Lösung, umgeformte Nachbarn behalten ihre. Höhenpunkte und Bahnsteige in der Strecke werden anteilig umstationiert, dahinter um die Längenänderung verschoben. Beim Spezifizieren festgelegt am 2026-10-07. → Paket N |
| 192 | Womit startet das Panel? | **Geschwindigkeit: die größte der gewählten Elemente (leer, wo keines eine hat — ohne wird nicht gerechnet); Übergangsbogenform: die der ersetzten Übergangsbögen, sonst Klothoide; Radius automatisch.** Beim Bauen festgelegt am 2026-10-07. → Paket N |
| 193 | Vergleicht die Bestandsachse auch die Höhe? | **Ja: mit GRA bekommt jeder Punkt seine Höhe (Gradiente samt Ausrundungen); Hebewerte, wo das verglichene Gleis eine Gradiente im selben Höhensystem hat.** Vom Auftraggeber gesetzt am 2026-10-07. → Paket V |
| 194 | Wo und wie werden Verschiebewerte angegeben? | **An runden Stationen der Bestandsachse (1 / 5 / 10 m), quer zu ihr gemessen, rechts in ihrer Richtung positiv; Hebung nach oben positiv.** Vom Auftraggeber bestätigt am 2026-10-07. → Paket V |
| 195 | Wo stehen die Punkte, und wie viele? | **Im Projekt, höchstens 2 km Achse; bei einer längeren wird der Bereich von–bis in ihrer Stationierung gewählt.** Vom Auftraggeber gesetzt am 2026-10-07 (statt eines Anhangs auf dem Server). → Paket V |
| 196 | Woraus entsteht eine Bestandsachse? | **Zunächst nur aus Verm.ESN (TRA, optional GRA).** Vom Auftraggeber gesetzt am 2026-10-07. → Paket V |
| 197 | Was geschieht über einem Grenzwert? | **Nur eine Warnung**, nichts wird gesperrt. Vom Auftraggeber gesetzt am 2026-10-07. → Paket V |
| 198 | Wie werden die Punkte gespeichert? | **Station implizit (s0 + i·1 cm), Lage und Höhe als ganze Millimeter, als Differenz zum Vorpunkt kodiert; eigene Sammlung `referenceAxes`, im Merge ein ganzes Objekt.** Beim Spezifizieren festgelegt am 2026-10-07. → Paket V |
| 199 | Wie wird ein Verschiebewert gerechnet? | **Normale der Bestandsachse an der Station, Schnitt mit der verglichenen Achse innerhalb von 2 m; Hebung aus der Gradiente am Schnittpunkt.** Im Browser. Beim Spezifizieren festgelegt am 2026-10-07. → Paket V |
| 200 | Wie werden Verschiebewerte gezeigt? | **Einklappbarer Abschnitt in den drei Verbinden-Dialogen und unter Prüfen; Grenzwerte quer und Höhe je 50 mm vorbelegt, auf dem Gerät gemerkt; Band, Tabelle, CSV, Karte.** Beim Spezifizieren festgelegt am 2026-10-07. → Paket V |
| 201 | Wie hält „Neu verbinden“ den Abstand zu einem Nachbargleis? | **Als Bedingung der Suche: Nachbargleis in der Karte gewählt, Mindestabstand frei wählbar, dazu die Vergrößerung aus der Überhöhung beider Gleise wie beim Zusammenfügen (Entscheidung 168); geprüft wird, was der Splice einfügt. Hält keine Lösung in der Toleranz ihn, wird die beste gezeigt und das Übernehmen gesperrt.** Vom Auftraggeber gewünscht am 2026-10-08 (Werkzeug und Überhöhungszuschlag von ihm gewählt). → Paket N |
| 202 | Wie lang werden die Übergangsbögen beim Neu-Verbinden? | **Neben Regellänge, Mindestlänge und ohne eine vierte Variante: Länge und Radius gemeinsam an die alte Achse angepasst (kleinste Quadrate).** Kürzer als die Regeln erlauben, meldet es der Katalog und die Lösung rangiert dahinter. Beim Bauen festgelegt am 2026-10-08, nachdem die Regellänge eines 188-m-Bloss-Übergangsbogens (108,8 m) 19 cm Abweichung ergab. → Paket N |
| 203 | Wo liegt eine geteilte Punktwolke, und wer darf was? | **Auf dem Projektserver, sichtbar für alle Mitglieder des Projekts (Entscheidung 127). Ansehen (Querprofil, Lichtraum an der Station, 3D, Messen) dürfen alle Mitglieder; alles, was Punktwolken ändert — hochladen, lokal einlesen, löschen, neu referenzieren, Serverjobs starten, Messachsen speichern oder löschen —, nur der Admin und Nutzer mit dem Recht „Punktwolken bearbeiten“.** Das Recht vergibt der Admin in der Nutzerverwaltung; es gilt in jedem Projekt, in dem der Nutzer Mitglied ist. Entscheidung 119 gilt nur noch für lokale Wolken. Vom Auftraggeber gesetzt am 2026-10-08. → AP 13.1 |
| 204 | Was darf eine lokale Wolke noch? | **Alles, was sie heute kann** — Querprofil, Lichtraum an der Station, gleisweite Prüfung und Schienenverfolgung, im Browser. Neues (Teilen, 3D, Neureferenzieren, Serverjobs) gibt es nur für Wolken auf dem Server. Vom Auftraggeber gesetzt am 2026-10-08. → AP 13.6 |
| 205 | In welchem System liegen die Kacheln auf dem Server? | **Im System der Datei, auf allen Detailstufen; umgerechnet wird beim Lesen** (wie seit AP 11.7 für die Originalauflösung). So bleiben die Kacheln gültig, wenn sich Achse oder Transformation ändern. Beim Spezifizieren festgelegt am 2026-10-08. → AP 13.4 |
| 206 | Welche Detailstufen gibt es? | **L0 Original, L1 2-cm-Voxel (heutiges Format), L2 8 cm, L3 32 cm, L4 1,28 m, mit Kacheln von 2, 2, 8, 32 und 128 m** — jede Kachel hält ähnlich viele Punkte; alle Stufen entstehen in einem Lesedurchgang. Ohne gröbere Stufen zeigte eine 3D-Ansicht nur einige Dutzend Meter (rund 80 Mio. Punkte je km schon im 2-cm-Voxel). Beim Spezifizieren festgelegt am 2026-10-08. → AP 13.4 |
| 207 | Bleibt die Rohdatei erhalten? | **Nein, sie wird nach erfolgreicher Aufbereitung gelöscht; die Kacheln tragen RGB mit, verloren gehen nur Klassifizierung und GPS-Zeit. Wer die Rohdatei braucht, setzt „Rohdatei aufbewahren“ (Vorgabe aus).** L0 gibt eine LAS-Datei bitgenau zurück (Entscheidung 145). Vom Auftraggeber gesetzt am 2026-10-08 (RGB gewünscht). → AP 13.2, 13.4 |
| 208 | Wie werden Kacheln ausgeliefert? | **Über `olt-server` mit Range-Anfragen und einer Sammelanfrage für bis zu 64 Bereiche, mit Prüfung der Mitgliedschaft je Anfrage.** Nicht über Caddys file_server: dessen forward_auth prüft nur die Anmeldung, nicht das Projekt, und der osrd-caddy-Container bräuchte einen neuen Mount. Beim Spezifizieren festgelegt am 2026-10-08. → AP 13.5 |
| 209 | Wo laufen lange Läufe? | **Für Wolken auf dem Server dort, als Job mit demselben JS-Code** — die gleisweite Lichtraumprüfung und die Schienenverfolgung. Über 5 km müsste der Browser sonst 1,5 GB (Voxel) bzw. 8 GB (Original) laden (gemessen an 5550L). Lokale Wolken rechnen weiter im Browser (Entscheidung 204). Beim Spezifizieren festgelegt am 2026-10-08. → AP 13.7 |
| 210 | Wie wird die 3D-Ansicht gebaut? | **Als eigenes Fenster der App (`#/cloud3d`) mit three.js, als eigenes Bundle, abgeglichen mit dem Hauptfenster über einen BroadcastChannel.** Potree braucht den nativen PotreeConverter und ist veraltet; eine 3D-Ebene in MapLibre (deck.gl) begrenzt die Kamera und rechnet in Mercator. Bild und Schnitt im Browser, nicht auf dem Server (keine Grafikkarte, Verzögerung bei jeder Bewegung). Beim Spezifizieren festgelegt am 2026-10-08. → AP 13.8 |
| 211 | Was ist eine Neureferenzierung? | **Eine räumliche Helmert-Transformation T an der Wolke, auf dem Server gespeichert mit Passpunkten, Restfehlern, Person und Datum; außerhalb der Revisionen, mit eigenem Verlauf und Zurücknehmen. Die Kacheln bleiben unverändert, T wirkt beim Lesen.** Sie gilt auch zwischen Wolken im selben System (Restversatz), nicht nur zwischen verschiedenen. Beim Spezifizieren festgelegt am 2026-10-08. → AP 13.12–13.15 |
| 212 | Welche Parameter werden geschätzt? | **Ost, Nord, Höhe und die Drehung um die Lotrechte, Maßstab fest 1; die beiden Neigungen und der Maßstab wählbar.** Gescannte Daten sind metrisch, Projektionsverzerrungen rechnet proj; Punkte entlang einer Bahn liegen fast in einer Linie und Ebene, die Neigungen sind daher oft schlecht bestimmt. Beim Spezifizieren festgelegt am 2026-10-08. → AP 13.12 |
| 213 | Welche Beobachtungen zählen? | **Ein 3D-Paar ergibt drei Gleichungen, ein Querprofil-Paar zwei (quer und Höhe).** Die Scheibe zeigt die Lage längs nicht; ist die Längsverschiebung unbestimmt (Gerade ohne 3D-Paar), wird das gemeldet, statt eine Zahl zu raten. Beim Spezifizieren festgelegt am 2026-10-08. → AP 13.12 |
| 214 | Wie kommt eine Wolke im lokalen System herein? | **Der Upload kennt „Lokal / unbekannt“, nur für Wolken auf dem Server.** Sie erscheint erst nach der Neureferenzierung am Gleis; bis dahin werden die Passpunkte in zwei Ansichten nebeneinander gewählt. Beim Spezifizieren festgelegt am 2026-10-08. → AP 13.13 |
| 215 | Wie wird Farbe gespeichert? | **8 Bit je Kanal auf allen Detailstufen; im Voxel behält jeder Punkt seine eigene Farbe, nichts wird gemittelt. Kachelformat `version: 3` mit `rgb: true`; Version 1 und 2 bleiben lesbar; Dateien ohne Farbe kosten nichts extra.** Gilt auch für den lokalen Import. Vom Auftraggeber gewünscht am 2026-10-08 (RGB), Format beim Spezifizieren festgelegt. → AP 13.4 |
| 216 | Wo wird das Recht „Punktwolken bearbeiten“ geprüft? | **Auf dem Server für alles, was ihn betrifft — auch beim Einchecken: ändern sich Messachsen gegenüber der Elternrevision ohne Recht, lehnt er ab. Nur in der Oberfläche für den lokalen Import**, weil der ganz im Browser läuft. Beim Spezifizieren festgelegt am 2026-10-08. → AP 13.1 |
| 217 | Wie wird eine Weiche auf Gleis verschoben, und was hält sie vor WA? | **Ein Schieber wie in der Weichenverbindung über das Element, auf dem WA liegt: er zeigt den Abstand von WA zum Elementwechsel hinter der Weiche und hält auf beiden Elementknoten und auf ganzen Metern ab l_min — nur dort, wo die Weiche liegt und das Reststück vor WA null oder mindestens l_min ist (LP.EL.01 bei der Geschwindigkeit des Elements). Hinter WE wird nicht geprüft.** Der Klick rastet auf die nächste solche Stelle ein; eine Umstellung von Richtung, Form oder Seite verschiebt WA nur, wo es dort nicht mehr liegen darf. Das Stationsfeld bleibt frei: ein zu kurzes Reststück ist dann ein Fehler, der das Übernehmen sperrt; ohne Geschwindigkeit ab 40 km/h wird nicht geprüft und das gesagt. Vom Auftraggeber gewünscht am 2026-10-08 (nur vor WA, einrasten auf gültige Punkte); Schieber je Element und Einrasten des Klicks beim Bauen festgelegt. |
| 218 | Wo müssen die beiden Gleise einer Weichenverbindung dieselbe Überhöhung tragen? | **An der ldS der beiden Weichen** (WA–WE entlang des Stammgleises plus `lds` der Form; ohne ldS am WE), auf 1 mm; am WA darf sie verschieden sein. Das Zwischenelement trägt den gerundeten Mittelwert der beiden; die Zweige folgen weiter der Überhöhung ihres Gleises unter der Weiche. Gelesen auf dem gewählten Element — liegt die ldS dahinter, gilt der Wert an seinem Ende. Die Meldung nennt beide Werte. Vom Auftraggeber gesetzt am 2026-10-08 (ersetzt den Vergleich am WE). |
| 219 | Welche Geschwindigkeit bestimmt l_min vor WA? | **Immer die des abzweigenden Gleises** — in „Weiche auf Gleis“ die Geschwindigkeit des Dialogs, in der Weichenverbindung die des Verbindungsgleises —, nicht die des Elements, in dem WA liegt; das gilt auch auf einem Element ohne Geschwindigkeit. Hinter WE (nur Weichenverbindung) bleibt es die des Elements. Ändert sich die Geschwindigkeit, rastet WA in „Weiche auf Gleis“ auf die nächste gültige Stelle. Ersetzt in Entscheidung 166 und 217 „bei der Geschwindigkeit des Elements“ für das Stück vor WA. Vom Auftraggeber gesetzt am 2026-10-08. |
| 220 | Wie wird ein Upload auf Unversehrtheit geprüft? | **Je Stück von 8 MB: der Browser schickt dessen SHA-256 mit, der Server prüft vor dem Schreiben und lehnt ein verfälschtes Stück ab (es wird neu geschickt); nach dem letzten Stück hasht der Server die ganze Datei und hält den Wert an der Wolke fest.** Ein SHA-256 der ganzen Datei im Browser bräuchte einen fortschreibbaren Hash über Neuladen hinweg, den WebCrypto nicht bietet; die Prüfung je Stück fängt Fehler dort, wo sie sich beheben lassen. Ersetzt „SHA-256 am Ende“ aus AP 13.2. Beim Bauen festgelegt am 2026-10-08. → AP 13.2 |
| 221 | In welchen Einheiten speichern die groben Stufen? | **In Einheiten der Stufe: 1 mm (L1, wie bisher), 2 mm (L2), 8 mm (L3), 32 mm (L4) — eine Kachel ist 2 000 bzw. 4 000 Einheiten breit und passt in Uint16.** Statt auf den Voxel gerundet behält jeder Punkt so seine Lage auf ein Viertel bis ein Vierzigstel des Voxels; die 3D-Ansicht zeigt kein Raster. Weicht von „Voxel-Einheiten“ in AP 13.4 ab. Beim Bauen festgelegt am 2026-10-08. → AP 13.4 |
| 222 | Wie lange gilt eine geprüfte Mitgliedschaft beim Ausliefern? | **60 s je Sitzung, Nutzer und Projekt, im Speicher von `olt-server`.** Wer aus einem Projekt genommen wird, liest dessen Kacheln also bis zu einer Minute weiter; dafür kostet ein Querprofil keine Projektabfrage je Anfrage. Beim Bauen festgelegt am 2026-10-08. → AP 13.5 |
| 223 | Wie ist der OPFS-Cache für Serverwolken aufgebaut? | **In Paketen: jede Antwort des Servers wird eine Datei, ein Index (`cloudcache/index.json`) sagt, welches Segment wo liegt; verdrängt wird paketweise, das am längsten nicht benutzte zuerst. Vorgabe 2 GB, im Panel einstellbar (¼–100 GB) und leerbar.** Eine Datei je Segment wären Zehntausende kleine Dateien; Pakete werden einmal geschrieben und nie geändert. Ohne beschreibbare OPFS-Dateien im Hauptfenster bleibt der Cache leer, gelesen wird dann vom Server. Beim Bauen festgelegt am 2026-10-08. → AP 13.6 |
| 224 | Was geschieht mit einem Job, wenn `olt-cloudjobs` neu startet? | **Er bleibt „läuft“ und wird beim nächsten Start wieder eingereiht, nicht als fehlgeschlagen markiert; jeder Job läuft in einem eigenen Prozess (768 MB Heap).** Ein Deploy startet den Dienst neu, das ist kein Fehler der Wolke; ein Absturz oder Speichermangel trifft nur den einen Job, der mit Grund fehlschlägt. Beim Bauen festgelegt am 2026-10-08. → AP 13.3 |
| 225 | Wo laufen gleisweite Prüfung und Verfolgung auf Serverwolken, solange AP 13.7 fehlt? | **Im Browser, über dieselbe Lesequelle; die Fortschrittsanzeige sagt „Läuft im Browser“. Starten dürfen sie alle Mitglieder; nur das Speichern einer Messachse braucht das Recht.** Erst als Serverjob (13.7) ist das Starten selbst ein Ändern im Sinn von Entscheidung 203. Beim Bauen festgelegt am 2026-10-08. → AP 13.6, 13.7 |
| 226 | Wann gilt eine Messachse beim Einchecken als geändert? | **Wenn sie — oder ihr Fehlen — weder so in der Basis noch so in der Merge-Elternrevision steht; verglichen wird das Objekt mit sortierten Schlüsseln.** So bringt ein Merge die Messachsen der anderen Seite ohne Recht mit, ein eigenes Speichern oder Löschen nicht. Beim Bauen festgelegt am 2026-10-08. → AP 13.1 |
| 227 | Wie kommen die Bytes eines Stücks am JSON-Zwang vorbei (Phase 10)? | **Nur `PUT /api/projects/:id/clouds/:cid/raw` mit `application/octet-stream` und dem Kopf `x-olt-upload: 1`.** Einen eigenen Kopf kann eine fremde Seite nicht ohne Vorabfrage senden — dieselbe Wirkung wie der JSON-Zwang; dazu bleibt SameSite=Strict. Grenze 8 MB + 64 kB nur für diese Route. Beim Bauen festgelegt am 2026-10-08. → AP 13.2 |
| 228 | Wofür gilt der Auflösungsschalter im Querprofil? | **Nur für die Wolken auf dem Server (2-cm-Voxel L1 oder Original L0); lokal eingelesene bleiben, wie sie eingelesen wurden.** Er erscheint nur, wenn eine Serverwolke da ist. Beim Bauen festgelegt am 2026-10-08. → AP 13.6 |
| 229 | Woher hat das 3D-Fenster Gleise und Station? | **Vom Hauptfenster über einen BroadcastChannel des Projekts — mit allen Änderungen der Arbeitskopie, auch ungespeicherten; ohne Hauptfenster (Antwort bleibt 1,2 s aus) vom eingecheckten Kopf der Variante aus der Adresse, mit Hinweis.** Die Querprofil-Station folgt dem Hauptfenster; ein Doppelklick in 3D auf einen Punkt bis 50 m neben einem Gleis öffnet dort das Querprofil. Das 3D-Fenster öffnet selbst keine Arbeitskopie. Beim Bauen festgelegt am 2026-10-08. → AP 13.10 |
| 230 | Wann wird eine Kachel durch ihre feineren ersetzt? | **Solange ihr Voxel auf dem Bildschirm größer als 1 px erscheint und die sichtbaren Kinder ins Punktbudget passen; gezeichnet wird die grobe Kachel, bis alle sichtbaren Kinder geladen sind.** Die Stufen bilden einen Baum über die Kachelindizes (4 × 4 Kinder je Kachel); weil jede gröbere Stufe eine Auswahl der feineren ist, wird nie beides gezeichnet. L0 wird nicht gezeichnet, nur beim Messen gelesen. Beim Bauen festgelegt am 2026-10-08. → AP 13.9 |
| 231 | Wie wird ein Punkt gewählt? | **Auf der Grafikkarte: zwei Durchgänge in einem Fenster von 17 × 17 px um den Klick — Kachel und obere Bits des Punktindex, dann sein unterstes Byte —, der nächste Treffer innerhalb von 8 px; danach der nächste Originalpunkt innerhalb von 10 cm.** Liegt im Original keiner so nah, bleibt der Punkt der Detailstufe, mit Hinweis. Beim Bauen festgelegt am 2026-10-08. → AP 13.11 |
| 232 | Welchen Bereich spannt die Färbung nach Höhe? | **Je Wolke das 2. bis 98. Perzentil der Höhen ihrer gröbsten Kacheln.** Ein Vogel oder ein Kran über dem Gleis spreizt die Farbskala sonst so, dass alles einfarbig wird (beim Bauen so gesehen). Beim Bauen festgelegt am 2026-10-08. → AP 13.8 |
| 233 | Wie fährt man am Gleis? | **Augenhöhe 2,5 m über SO auf der Achse, W/S entlang (6 m/s, mit Umschalt 24 m/s), A/D quer, R/F höher und tiefer, Ziehen mit der Maus zum Umsehen; Start an der Station des Querprofils, wenn es dasselbe Gleis ist, sonst am Anfang.** R/F kamen zu W/S/A/D dazu, um über Bahnsteige zu sehen. Ohne Gradiente keine Fahrt. Beim Bauen festgelegt am 2026-10-08. → AP 13.8 |
| 234 | Welche Wolken zeigt die 3D-Ansicht? | **Die Wolken des Projekts auf dem Server, die aufbereitet sind und in einem bekannten Lagesystem liegen; jede ein- und ausblendbar.** Wolken nur auf diesem Gerät nicht (Entscheidung 204); Wolken im lokalen System erst mit der zweiteiligen Ansicht (AP 13.13). Beim Bauen festgelegt am 2026-10-08. → AP 13.8 |
| 235 | In welchem System und um welchen Ursprung wird gezeichnet? | **In der Ebene der meisten Gleise (ohne Gleise der ersten Wolke), relativ zum auf 10 m gerundeten Mittelpunkt der Wolke aus der Adresse; Höhe ab ihrem tiefsten Punkt.** Andere Ebenen rechnet der Worker punktweise um; die erste Ansicht rahmt nur diese Wolke ein — eine zweite kann Kilometer entfernt liegen (beim Bauen so gesehen). Beim Bauen festgelegt am 2026-10-08. → AP 13.8 |
| 236 | Wie kommt three.js in die App? | **Als eigener Chunk, den nur das 3D-Fenster lädt (`main.jsx` verzweigt nach der Adresse); ohne Farbmanagement, damit Shader und EDL auf den gespeicherten Werten arbeiten.** Die App selbst lädt three.js nie. Beim Bauen festgelegt am 2026-10-08. → AP 13.8 |
| 237 | Wo laufen gleisweite Prüfung und Verfolgung, seit es Serverjobs gibt? | **Auf dem Server, wenn der Nutzer Punktwolken bearbeiten darf und alle Wolken, die gelesen würden, dort liegen; sonst im Browser wie bisher.** Ohne Recht bleibt das Prüfen jedem Mitglied (Entscheidung 225), eine Wolke nur auf diesem Gerät kennt der Server nicht. Die Ergebnisse der Serverläufe sehen alle Mitglieder. Beim Bauen festgelegt am 2026-10-08. → AP 13.7 |
| 238 | Wie lange bleibt ein Serverlauf? | **Sein Ergebnis sieben Tage, eine Verfolgung bis sie als Messachse gespeichert ist; höchstens vier Läufe je Projekt warten oder laufen; eine eigene Warteschlange neben der Aufbereitung, zwei Läufe zugleich mit je 320 MB Heap.** Eine Prüfung über 4 km soll nicht Stunden hinter der Aufbereitung einer Lieferung warten. Beim Bauen festgelegt am 2026-10-08. → AP 13.7 |
| 239 | Was bestimmen Querprofil-Paare allein? | **Auf einer Geraden nicht die Lage längs, auf einem einzigen Kreisbogen nicht die Drehung um seinen Mittelpunkt — beides meldet die Rangprüfung als „Längsverschiebung nicht bestimmbar“ mit dem Rat zum 3D-Paar.** Erst eine Gerade und ein Bogen zusammen, oder ein 3D-Paar, legen alles fest. Beim Bauen gefunden am 2026-10-08. → AP 13.12 |
| 240 | In welcher Ebene liegt T, und was wird aus einem T, das schon da ist? | **In der Ebene, in der die Bezugswolke gelesen wird (durch ihr eigenes T, wenn sie eines hat); die Punkte der anzupassenden Wolke kommen ohne ihr bisheriges T in diese Ebene. Ein neues T ersetzt das alte, es wird nicht verkettet.** So bleibt jedes T für sich verständlich, und der Verlauf kann jedes wieder in Kraft setzen. Querprofil-Paare allein starten beim T in Kraft. Beim Bauen festgelegt am 2026-10-08. → AP 13.13 |
| 241 | Wie zeigt die 3D-Ansicht eine Wolke mit T? | **Der Worker rechnet die Punkte in die Ebene von T um einen Ursprung nahe der Wolke, eine Modellmatrix (T und der Wechsel in die Ebene der Ansicht, affin um die Wolke) bringt sie in die Ansicht.** Ein neues T — die Vorschau beim Anpassen — verschiebt die geladenen Kacheln, statt sie neu zu lesen; ohne T bleibt alles wie in AP 13.8. Beim Bauen festgelegt am 2026-10-08. → AP 13.13 |
| 242 | Wie kommt ein Paar aus dem Querprofil in die Liste? | **Über den BroadcastChannel des Projekts: das 3D-Fenster sagt, welche Wolken angepasst werden und mit welcher Vorschau; das Querprofil (auch abgedockt) zeigt dann nur diese zwei in eigenen Farben und schickt ein gewähltes Paar zurück — der Punkt der angepassten Wolke durch die Vorschau zurückgerechnet.** Beim Bauen festgelegt am 2026-10-08. → AP 13.14 |
| 243 | Wann ist ein Paar verdächtig? | **Wenn eine seiner normierten Verbesserungen über 3,29 liegt (zweiseitig, α = 0,1 %).** Es wird gelb gezeigt und lässt sich abschalten; ohne Überbestimmung wird nicht geprüft, und das Panel sagt es. Beim Bauen festgelegt am 2026-10-08. → AP 13.12, 13.14 |
| 244 | Was geschieht mit einer Messachse, deren Wolke danach anders gelesen wird? | **Sie merkt sich die Serverwolken, aus denen sie verfolgt wurde, mit dem T von damals; ändert es sich, wird sie markiert. Verschieben rechnet jeden Punkt auf dem alten Weg in die Datei zurück und auf dem neuen heraus — nur bei einer einzigen Wolke; „Neu verfolgen“ geht ihre Führung noch einmal ab und ersetzt sie.** Messachsen von vor AP 13.15 tragen keine Wolken und werden nicht markiert. Beim Bauen festgelegt am 2026-10-08. → AP 13.15 |
| 245 | Wie zeigt der Höhenplan eine Bestandsachse? | **Ihre Höhe dort, wo ihre Normale an runden Metern der Bestandsachse das Gleis trifft, über der Station des Gleises an diesem Schnitt — derselbe Weg wie die Verschiebewerte (Entscheidung 199), also dieselben Zahlen; die Abweichung als eigener Streifen in mm unter dem Profil, weil sie in der Überhöhung des Profils nicht zu sehen wäre.** An/aus wird auf dem Gerät gemerkt; ohne gemeinsames Höhensystem wird nichts gezeichnet, und der Kopf sagt es. Beim Bauen festgelegt am 2026-10-08. → AP V.6 |
| 246 | Was bleibt fest, wenn ein Neigungswechsel in der Tabelle geändert wird? | **Zwei seiner vier Werte (Station, Höhe, Neigung davor, Neigung danach) sind vorgegeben und eingebbar — wird einer geändert, bleibt der andere; die beiden übrigen folgen. Die Nachbarpunkte bleiben immer, wo sie sind.** Am Gleisanfang/-ende fehlt eine Neigung, an ihre Stelle tritt Station oder Höhe; an einem Gleisanschluss bleibt die Station fest (Höhe und Neigung eingebbar), Punkte, die eine Weiche setzt, sind gesperrt. Mindestens 0,1 m zu den Nachbarn, sonst Meldung statt Änderung. Wahl der Ansicht und der Vorgabe auf dem Gerät gemerkt. Beim Bauen festgelegt am 2026-10-08 (Wunsch des Auftraggebers: „Gradiente 1 + Höhe oder Höhe + Station“). |
| 247 | Wie werden die Übergangsbögen beim Zusammenfügen gewählt? | **Je Seite für sich: eingeschaltet oder nicht (auch nur eine Seite), Form Klothoide oder Bloss, Länge; die Form gehört zum geklickten Element, gleich wie die Lösung läuft. Eingeschaltet bekommt eine Seite einmal die Regellänge ihrer Form (wie Entscheidung 185); ein späterer Formwechsel lässt die Länge stehen, die Knöpfe nennen die Längen der neuen Form.** Der direkte Übergangsbogen von Bogen zu Bogen behält eine Form. Wunsch des Auftraggebers, gebaut am 2026-10-08. |
| 248 | Was speichert eine Route? | **Name und die Gleise in Fahrtrichtung, sonst nichts; die Richtung jedes Gleises wird beim Lesen aus den Anschlüssen bestimmt, eine Route aus einem Gleis läuft in dessen Richtung.** So bleibt sie richtig, wenn ein Gleis umgedreht wird; ohne Anschluss zwischen zwei Gleisen ist sie unterbrochen und sagt wo. Mit dem Auftraggeber festgelegt am 2026-10-08. → AP RT.1 |
| 249 | Was wird aus einer Route, deren Gleis geteilt, zusammengelegt oder gelöscht wird? | **Der Speicher ersetzt es im selben Schritt durch die Gleise, die jetzt dort liegen, in der Reihenfolge längs des alten Gleises (Geometrie, wie beim Tragen der Bahnsteige im Merge); ebenso beim Zusammenführen von Varianten. Ein ganz gelöschtes Gleis fällt heraus, die Route ist dort unterbrochen.** Festgelegt am 2026-10-08. → AP RT.1 |
| 250 | Wie wird eine Route angelegt? | **Gleis für Gleis auf der Karte in Fahrtrichtung; liegt ein geklicktes Gleis nicht am Ende der bisherigen Route, wird der kürzeste zusammenhängende Weg über die Fahrwege der Weichen ergänzt.** „Letztes entfernen“ nimmt das zuletzt gewählte Stück weg. Festgelegt am 2026-10-08. → AP RT.2 |
| 251 | Wie verhält sich das Höhenprofil einer Route? | **Wie das eines Gleises und bearbeitbar — ein Gleis ist eine Route aus einem Stück; jede Änderung landet im Gleis, dem der Punkt gehört, ein Punkt verschiebt sich nur innerhalb seines Gleises, am Gleisübergang bleibt die Station fest (Höhe, Neigungen, Ausrundung eingebbar). Die Regelprüfung läuft je Gleis und wird auf die Route abgebildet; Ausrundungen und ihre Überschneidungen werden über die Gleisgrenzen hinweg gezeichnet.** Auftraggeber am 2026-10-08: „Bearbeiten“. → AP RT.4 |
| 252 | In welche Richtung blickt das Querprofil auf einer Route? | **In Fahrtrichtung der Route: wo sie ein Gleis gegen seine Richtung befährt, wird das Bild gespiegelt.** Gemeldet wird weiter Gleis + Station, die Route dazu. Auftraggeber am 2026-10-08. → AP RT.3 |
| 253 | Wie kommt eine Route ins 3D-Fenster? | **Mit dem Projekt — über den Kanal aus dem Hauptfenster oder aus dem eingecheckten Stand; die Gleissicht einer Route geht durchgehend über ihre Gleise.** Festgelegt am 2026-10-08. → AP RT.5 |
| 254 | Was trägt der Link zur Gleissicht? | **Gleis oder Route, Station, Blickrichtung, Neigung, Querversatz und Augenhöhe — das Bild ist dasselbe; für Mitglieder die Adresse des 3D-Fensters, bei Freigabelinks auf Wunsch angehängt.** Fehlt Gleis oder Route im Stand, öffnet das Fenster wie bisher und sagt es. Festgelegt am 2026-10-08. → AP RT.6 |
| 255 | Wer darf Routen anlegen? | **Wer die Variante bearbeiten darf; Routen gehen mit Einchecken, Zusammenführen und Rückgängig wie Gleise.** Festgelegt am 2026-10-08. → AP RT.1 |
| 256 | Wo liegen die Schwellen einer Weiche? | **Entlang der Winkelhalbierenden von Stamm- und Zweiggleis (Punkte gleichen Abstands zu beiden Achsen): Schwelle k bei s_k = 0,3 + 0,6 · k ab WA, rechtwinklig zur Winkelhalbierenden an ihrer Stelle; die ldS ist die Schwelle durch den Stammgleispunkt WE + `lds`, das Raster endet davor.** Keine Einstellungen, nichts gespeichert. Vom Auftraggeber gesetzt am 2026-10-09. → AP WH.1 |
| 257 | Wie kommt die Höhe über eine schräge Schwelle? | **Örtliche Ebene am Fußpunkt P im Stammgleis: z_Q = z_P + g · a + u/1500 · y** (a, y längs und quer zum Stammgleis). Bei rechtwinkliger Schwelle Entscheidung 154. Festgelegt am 2026-10-09. → AP WH.1 |
| 258 | Was ist „die gleiche Stelle“ im anderen Gleis? | **Dieselbe Schwelle: jeder Höhenpunkt hinter WA bis zur ldS sitzt auf einer Schwelle und hat dort einen Partner im anderen Gleis; Setzen und Verschieben rasten auf die nächste Schwelle ein, Höhe, Ausrundung, Begründung, Verschieben und Löschen wirken auf beide.** Am Zweig immer ein Punkt an der ldS, im Stammgleis nur wo gebraucht. Vom Auftraggeber gesetzt am 2026-10-09. → AP WH.2 |
| 259 | Wer führt in der Weiche? | **Beide Gleise sind eingebbar (ersetzt „das Stammgleis führt“ aus Entscheidung 155): hat ein Schreiben nur das Zweiggleis geändert, folgt das Stammgleis, sonst folgt das Zweiggleis — auch bei Lage- und Überhöhungsänderungen.** Weichenstraßen werden weitergereicht, jede Weiche einmal je Schreiben. Vom Auftraggeber gesetzt am 2026-10-09. → AP WH.2 |
| 260 | Wie werden die Höhen einer Weiche gesperrt? | **Checkbox „Höhen der Weiche sperren“ (`heightsLocked`) unter Bearbeiten › Weiche und im Höhenprofil; gesperrt sind die Punkte vom WA-Stoß bis zur ldS in beiden Gleisen, ein Schreiben, das sie ändert, lehnt der Speicher mit Hinweis ab. Lage und Überhöhung bleiben änderbar, die Höhen stehen, die Prüfung meldet „Weichenebene verletzt“.** Vom Auftraggeber gesetzt am 2026-10-09. → AP WH.3 |
| 261 | Wie wird ein Neigungswechsel in der Weiche begründet? | **Mit einem Text am Höhenpunkt (`reason`), einer je Paar, auf den Partner gespiegelt; HP.AR.06 warnt ohne Begründung, mit ihr ist der Wechsel „begründet“, und der Plan zeigt sie.** Vom Auftraggeber gesetzt am 2026-10-09. → AP WH.4 |
| 262 | Darf eine Ausrundung in der Weiche unter dem Regelwert liegen? | **Nein — Fehler, den keine Begründung behebt (HP.AR.07).** Die Ril lässt Ausrundungen in Weichen nur mit r_a ≥ Regelwert zu. Vom Auftraggeber bestätigt am 2026-10-09. → AP WH.4 |
| 263 | Was wird aus Punkten bestehender Projekte im Weichenbereich? | **Sie rasten beim nächsten Schreiben an der Weiche (oder „Alle Weichen koppeln“) auf die nächste Schwelle ein, die Höhe bleibt; die ldS-Punkte rücken auf die schräge Schwelle.** Festgelegt am 2026-10-09. → AP WH.2 |
| 264 | Was gilt, wo sich die Weichenbereiche zweier Weichen auf einem Gleis überlappen? | **Die langen Schwellen dort tragen alle drei Gleise: jede Weiche behält ihr Raster (0,3 + 0,6 · k ab ihrem WA) bis zur Mitte der Überlappung, und jede Schwelle darin koppelt das gemeinsame Gleis an das andere Gleis beider Weichen — eine Eingabe auf einem der drei nimmt die beiden anderen mit.** Kommt bei Weichenverbindungen oft vor (das Verbindungsgleis ist Zweig beider Weichen; in PEK Bestand bei den 1200er-Verbindungen um 1,3 m, bei 2034/2035 um 8,5 m). Eine Weiche, deren ldS im Teil der anderen liegt, setzt dort keinen ldS-Punkt. Zuerst als bloße Teilung gebaut, vom Auftraggeber am 2026-10-09 korrigiert („der Bereich zwischen den ldS wird an drei Gleise gekoppelt“), Raster je Weiche bis zur Mitte von ihm gewählt. → AP WH.5 |
| 265 | Wie genau werden Höhen geführt? | **Auf 0,1 mm (4 Nachkommastellen), damit eine Neigung auch über kurze Abschnitte auf 0,01 ‰ stimmt; Stationen weiter auf mm.** Die Höhentabelle zeigt und nimmt 4 Stellen; gerundet wird an einer Stelle (`roundHeight`) beim Lösen und Einfügen eines Punkts, in der Weichenkopplung (Partnerhöhen, Toleranz 0,05 mm; „Weichenebene verletzt“ ab 0,2 mm) und beim Angleichen einer Weichenverbindung. Vom Auftraggeber verlangt am 2026-10-09. |
| 266 | Was geschieht mit einer Ausrundung, deren Länge maßgebend ist, wenn sich eine Neigung daneben ändert? | **Der Punkt vermerkt die maßgebende Länge (`la`), und R wird bei jeder Änderung neu berechnet: kleinster Radius mit l_a ≥ `la`, nicht unter dem Regelwert (wo die Entwurfsgeschwindigkeit bekannt ist), auf volle 100 m aufgerundet, höchstens der Höchstwert.** Vermerkt wird, wenn der Regelwert-Knopf R aus den 20 m nach HP.AR.02 statt aus Tabelle 12 nimmt (sonst wird der Vermerk entfernt), oder wenn eine Länge in der neuen Tabellenspalte „Länge l_a“ eingegeben wird. Ein eingegebener Radius gilt fest und nimmt den Vermerk weg; das Angleichen einer Weichenverbindung, das selbst Radien setzt, ebenso. Neu gerechnet wird im Store bei jedem Schreiben, für Gleise mit geänderten Höhen oder Elementen, vor und nach der Weichenkopplung, im selben Undo-Schritt; nur an inneren Punkten eines Gleises. Anzeige: Länge fett in der Tabelle, „l ≥ 20“ hinter R im Profil und in der Bearbeitungsleiste. Vom Auftraggeber verlangt am 2026-10-09. |
| 267 | Worauf wird eine Weiche der Weichenverbindung gebogen, die in einem Übergangsbogen liegt? | **Auf das Klothoidenstück unter ihrem Stammgleis ({ r1 am WA, r2 am WE }), nicht auf den Radius am WA; der Übergangsbogen wird am WA an der Station als Klothoide geteilt.** Vorher lag das WE um Δκ·L²/6 neben dem Gleis (SBSS switch.004: R 1342,5 → 470 über 41,59 m = 0,40 m), und der Einschnitt erzeugte ein Querstück mit zwei Knicken von ~90° sowie zwei Klothoidenstücke mit den Radien des ganzen Übergangsbogens. Der Zweig folgte schon immer der Klothoide. `mainRadius` bleibt der Radius am WA. Gemeldet vom Auftraggeber am 2026-10-09. |
| 268 | Wie genau zeigt der Trackeditor Länge und Radius, und wo steht der Vergleichsradius? | **Angezeigt auf 3 Nachkommastellen (auch die Radien eines Übergangsbogens), eingegeben und gespeichert mit voller Genauigkeit: Im Feld steht beim Bearbeiten der gespeicherte Wert, nur eine echte Änderung wird übernommen. Der Vergleichsradius r_w (1/r_w = \|1/r₁ − 1/r₂\|, LP.UB.01) steht in der letzten Spalte der Tabelle, sein Feld auf der Linie zwischen den Zeilen der beiden Elemente (vom Auftraggeber nachgeschärft, zuerst stand es nach dem Radius in der Zeile des späteren Elements); „–“ ohne Krümmungssprung; die Zelle trägt die Farbe der Übergangsregeln, der Tooltip ihre Meldungen.** Vom Auftraggeber verlangt am 2026-10-09. |
| 269 | Was gilt für die Punkte an der ldS? | **Stamm- und Zweiggleis haben immer einen Punkt an der ldS; beide sind nicht löschbar und nur Anzeige** — im Stammgleis auf der Geraden Q → P (270), im Zweig auf der Weichenebene (257). Vom Auftraggeber gesetzt am 2026-10-09. → Paket WK |
| 270 | Woher kommen die Höhen von WA und ldS im Stammgleis? | **Von der Geraden zwischen dem letzten Punkt vor dem WA (Q) und dem ersten hinter der ldS (P): zwischen allen vier Punkten dieselbe Neigung.** Allgemein liegt jeder WA- und ldS-Punkt auf der Geraden zwischen den nächsten freien Punkten davor und dahinter entlang des Fahrwegs, auch über dicht folgende Weichen; ein begründeter Paarpunkt dazwischen ist frei; ohne Punkt vor dem WA ist der WA frei. Vom Auftraggeber gesetzt am 2026-10-09. → Paket WK |
| 271 | Was gilt für den Punkt hinter der ldS im Zweiggleis? | **Er liegt auf der Fortführung der Gradiente, mit der der Zweig in die ldS läuft; eingebbar sind Station und Neigung danach, die einander bestimmen (der nächste Punkt bleibt), die Höhe ist Anzeige.** Ohne Punkt bis zum Gleisende ist das Gleisende dieser Punkt; ist es der WA der nachfolgenden Weiche, legt die Fortführung ihn fest, und deren Stammgleis läuft auf ihr bis zu seinem P. Vom Auftraggeber gesetzt am 2026-10-09. → Paket WK |
| 272 | Was gilt zwischen den beiden ldS einer Weichenverbindung? | **Über 20 m: genau ein Punkt, der Schnitt beider Fortführungen (Kopplungspunkt beider Weichen, nur Anzeige); schneiden sie sich nicht dazwischen, keiner. Bis 20 m: kein Punkt; die führende Weiche (Stammgleis im Projekt zuerst; seit 275 die bearbeitete) legt mit ihrer Fortführung den WA der anderen fest, deren Gerade Q₂ → P₂ wird parallel durch diesen WA verschoben.** Vom Auftraggeber gesetzt am 2026-10-09. → Paket WK |
| 273 | Bleibt die Sperre der Weichenhöhen? | **Nein, sie entfällt ganz** (ersetzt 260): keine Checkbox, keine Ablehnung im Speicher, `heightsLocked` wird nicht mehr gelesen. Vom Auftraggeber gesetzt am 2026-10-09. → Paket WK |
| 274 | Was wird aus bestehenden Projekten? | **Die neuen Regeln gelten beim nächsten Schreiben an einer Weiche oder mit „Weichen jetzt koppeln“; Höhen ändern sich dabei, Kompatibilität ist nicht verlangt.** Vom Auftraggeber gesetzt am 2026-10-09. → Paket WK |
| 275 | Welche Weiche einer Weichenverbindung (≤ 20 m) führt? | **Die, deren Seite das Schreiben geändert hat (Gerade Q → P durch ihren WA oder ihre Punkte im Verbindungsgleis); die andere folgt mit WA, Q₂ und P₂ (um dasselbe Maß). Keine oder beide Seiten geändert: die, die den WA der anderen schon festlegt, sonst die mit dem Stammgleis im Projekt zuerst.** Über 20 m bleibt M (272). Vom Auftraggeber gesetzt am 2026-10-09 (Rückfall und Ring als eigene Annahmen). → Paket WK, AP WK.5 |
