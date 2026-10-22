import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../../locales/i18nContext'
import { provided } from '../../../extensions'
import { adoptCrossover, crossoverRequest, optimizeErrorText } from '../../../utils/commands'

const fmt = (v, digits = 1) => v.toFixed(digits)

/** One middle element of an answer, as the dialog names it: type, length and an arc's radius. */
function pieceText(t, piece) {
  const name = t(`scurve_mid_type_${piece.type}`)
  return piece.type === 'arc'
    ? `${name} ${fmt(piece.length)} m · R ${fmt(1 / Math.abs(piece.kappa), 0)} m`
    : `${name} ${fmt(piece.length)} m`
}

/**
 * The Python solver of the switch connection (Entscheidung 357): offered
 * where no position of the slider gives a connection, and only where the
 * service is there (the server build provides `crossoverSolver`). It searches
 * the toes of both turnouts and one to three middle elements; each answer
 * lists its elements, where its first toe stands and what of LP.KS.01 it only
 * keeps at the Ermessensgrenze. Adopting one hands the shift, the middle
 * elements and the seed to the dialog (`onAdopt`), which solves it again.
 *
 * `stationOf(shift)` names the first toe's station along track 1.
 */
export default function CrossoverSolver({ picks, speed, form = null, stationOf, onAdopt }) {
  const { t, fill } = useI18n()
  const solver = provided('crossoverSolver', null)
  // { picks, speed, running | none | solutions | error, failed? } — a run
  // belongs to the picks and the speed it was asked for; another pair or
  // another speed is a new question, and an answer to the old one is dropped.
  const [state, setState] = useState(null)
  const run = state?.picks === picks && state?.speed === speed ? state : null
  const setRun = (next) => setState(typeof next === 'function'
    ? (prev) => next(prev)
    : next && { picks, speed, ...next })
  const ctl = useRef(null)
  useEffect(() => () => ctl.current?.abort(), [])
  if (!solver) return null

  const start = async () => {
    ctl.current?.abort()
    const controller = new AbortController()
    ctl.current = controller
    setRun({ running: true })
    try {
      const answer = await solver(crossoverRequest({ picks, speed, form }), { signal: controller.signal })
      setRun(answer?.solutions?.length ? { solutions: answer.solutions } : { none: true })
    } catch (err) {
      if (err?.name === 'AbortError') return
      setRun({ error: optimizeErrorText(t, err?.code ?? 'unavailable', err?.detail) })
    }
  }
  const cancel = () => { ctl.current?.abort(); setRun(null) }
  const adopt = (solution, i) => {
    const adopted = adoptCrossover({ picks, speed, solution, form })
    if (!adopted) { setRun(r => ({ ...r, failed: i })); return }
    setRun(null)
    onAdopt(adopted)
  }

  return (
    <div className="crossover-solver">
      {!run && (<>
        <p className="msg-hint">{t('scurve_solver_hint')}</p>
        <button type="button" className="panel-btn panel-btn-full secondary" onClick={start}>
          {t('scurve_solver_button')}
        </button>
      </>)}
      {run?.running && (<>
        <p className="msg-info">{t('scurve_solver_running')}</p>
        <button type="button" className="panel-btn panel-btn-full secondary" onClick={cancel}>{t('btn_cancel')}</button>
      </>)}
      {run?.none && <p className="msg-error">{t('scurve_solver_none')}</p>}
      {run?.error && <p className="msg-error">{run.error}</p>}
      {run?.solutions && (
        <ul className="crossover-solutions">
          {run.solutions.map((sol, i) => (
            <li key={sol.template.join('-')} className="crossover-solution">
              <div className="crossover-solution-text">
                <strong>{sol.pieces.map(p => pieceText(t, p)).join(' + ')}</strong>
                <span>{fill('scurve_solver_station', {
                  st: fmt(stationOf(sol.s1), 2),
                  total: fmt(sol.pieces.reduce((sum, p) => sum + p.length, 0)),
                  form: sol.label ?? '',
                })}</span>
                {sol.hints.length > 0 && (
                  <span className="msg-hint">{fill('scurve_solver_rw_hint', { rw: fmt(Math.min(...sol.hints), 0) })}</span>
                )}
                {run.failed === i && <span className="msg-error">{t('scurve_solver_adopt_failed')}</span>}
              </div>
              <button type="button" className="panel-btn secondary" onClick={() => adopt(sol, i)}>
                {t('scurve_solver_adopt')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
