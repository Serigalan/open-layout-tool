import { useI18n } from '../../../locales/i18nContext'

/**
 * Choosing among several solutions (Entscheidung 180): the one shown, which
 * ends it joins, how two arcs are joined, how much it rebuilds — stepping to
 * the next, and where the one shown joins two arcs the other way than asked
 * for, taking that way over (`onAdopt`).
 */
export default function SolutionSwitch({ solutions, solution, picks, onChoose, onAdopt }) {
  const { t, fill, num } = useI18n()
  const i = Math.max(0, solutions.indexOf(solution))
  const { ends, rebuilt, arcJoin, alternative } = solution.result
  const end = (k) => fill(ends[k] === 'end' ? 'splice_at_end' : 'splice_at_start', { track: picks[k].label })
  const several = solutions.length > 1
  return (
    <div className="splice-solutions">
      {several && (
        <button type="button" className="panel-btn" aria-label={t('splice_solution_prev')}
          onClick={() => onChoose(solutions[(i + solutions.length - 1) % solutions.length])}>◀</button>
      )}
      <span>
        {fill('splice_solution', { i: String(i + 1), n: String(solutions.length) })}: {end(0)} ↔ {end(1)}
        {arcJoin && ` · ${t(`splice_arc_join_${arcJoin}`)}`}
        {' · '}{fill('splice_rebuilt', { l: num(rebuilt, { digits: 0, unit: 'm' }) })}
      </span>
      {several && (
        <button type="button" className="panel-btn" aria-label={t('splice_solution_next')}
          onClick={() => onChoose(solutions[(i + 1) % solutions.length])}>▶</button>
      )}
      {alternative && arcJoin && (
        <button type="button" className="panel-btn secondary" onClick={() => onAdopt(solution)}>{t('splice_adopt')}</button>
      )}
    </div>
  )
}
