"""CLI: optimize one track from an app tracks-JSON export.

Workflow:
  1. In der App: Datenaustausch → Tracks exportieren  →  tracks.json
  2. olt-optimize tracks.json --track <Name|Id> [--corridor-cm 50] [--uf 130]
  3. In der App: Datenaustausch → Tracks importieren (gleiche Id ersetzt den Track)
"""

import argparse
import pathlib

from .api import optimize_payload
from .track_io import load_tracks, save_tracks, find_track


def _report(res, corridor_cm, uf):
    print(f"\nKorridor {corridor_cm:.0f} cm | u_f {uf:.0f} mm")
    for row in res["report"]:
        label = f"Bogen {row['group']}" + (f".{row['arc']}" if row["arcs"] > 1 else "")
        if not row["changed"]:
            print(f"  {label}:  r {row['rAlt']:7.1f} m | u {row['uAlt']:3.0f} mm"
                  f" | v {row['vAlt']:5.1f} km/h | unverändert (keine zulässige Lösung)")
            continue
        print(f"  {label}:  r {row['rAlt']:7.1f} → {row['rNeu']:7.1f} m"
              f" | u {row['uAlt']:3.0f} → {row['uNeu']:3.0f} mm"
              f" | v {row['vAlt']:5.1f} → {row['vNeu']:5.1f} km/h"
              f" | Abrückung {row['offsetCm']:4.1f} cm")
    pretty = ", ".join(f"#{idx}: {s * 100:+.1f} cm" for idx, s in res["shifts"].items() if abs(s) > 1e-4)
    if pretty:
        print(f"  Geraden-Verschiebungen: {pretty}")
    print(f"  Engpass-v: Bestand {res['vBestand']:.1f} | Baseline {res['vBaseline']:.1f}"
          f" | Joint {res['vNeu']:.1f} km/h")
    print(f"  Übergangsbogen-Profil: {res['variant']}")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="olt-optimize",
                                 description="Optimiert einen Track aus einem Open-Layout-Tool-Export "
                                             "(größere Radien / mehr Überhöhung im Abrückungs-Korridor).")
    ap.add_argument("input", help="tracks.json aus dem Datenaustausch-Export")
    ap.add_argument("--track", help="Name oder Id des Tracks (bei genau einem Track optional)")
    ap.add_argument("--corridor-cm", type=float, default=50.0, help="max. Abrückung in cm (Default 50)")
    ap.add_argument("--uf", type=float, choices=[110.0, 130.0, 150.0], default=130.0,
                    help="Überhöhungsfehlbetrag u_f in mm (110 = Weichen)")
    ap.add_argument("--per-curve", action="store_true",
                    help="nur Baseline (Geraden bleiben fix, wie im App-Panel)")
    ap.add_argument("--uebergang", choices=["bestand", "bloss", "auto"], default="auto",
                    help="Übergangsbogen-Profil: bestand = wie vorhanden, bloss = alle Rampen "
                         "auf Bloss (k=6 statt 8 → kürzere Rampen), auto = beide Varianten "
                         "rechnen und die mit höherer Engpass-v übernehmen")
    ap.add_argument("--maxiter", type=int, default=150, help="DE-Iterationen (Default 150)")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--regelwerk", default=None,
                    help="Id des Regelwerks (Default: db-ril-800, siehe olt_optimizer/regelwerke/)")
    ap.add_argument("-o", "--out", help="Ausgabedatei (Default: <input>_optimized.json)")
    args = ap.parse_args(argv)

    tracks = load_tracks(args.input)
    if args.track:
        track = find_track(tracks, args.track)
    elif len(tracks) == 1:
        track = tracks[0]
    else:
        raise SystemExit("Mehrere Tracks in der Datei – bitte --track angeben. Verfügbar: "
                         + ", ".join(t.get("name") or t.get("id", "?") for t in tracks))

    try:
        res = optimize_payload(track, corridor_cm=args.corridor_cm, uf=args.uf,
                               uebergang=args.uebergang, per_curve=args.per_curve,
                               maxiter=args.maxiter, seed=args.seed, regelwerk=args.regelwerk)
    except ValueError as exc:
        raise SystemExit(str(exc)) from None

    _report(res, args.corridor_cm, args.uf)

    track["elements"] = res["elements"]
    out = args.out or str(pathlib.Path(args.input).with_suffix("")) + "_optimized.json"
    save_tracks(out, tracks)
    print(f"\ngeschrieben: {out}  (Import: Datenaustausch → Tracks importieren)")


if __name__ == "__main__":
    main()
