import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { inGerman, t } from '../../test/i18n'
import CommitBar from './CommitBar'

/**
 * What only the rulebook holds back may be committed anyway (Entscheidung
 * 361): a link under the locked Commit, where the form offers it.
 */
const render = (props) => renderToStaticMarkup(inGerman(createElement(CommitBar, {
  onCommit: () => {}, onCancel: () => {}, ...props,
})))

describe('CommitBar', () => {
  it('offers to commit anyway under a locked Commit', () => {
    const html = render({ reason: t('commit_blocked_rules'), onOverride: () => {} })
    expect(html).toContain('commit-override')
    expect(html).toContain(t('commit_override'))
    // Under the bar, before the reason.
    expect(html.indexOf('commit-override')).toBeGreaterThan(html.indexOf('commit-bar-row'))
    expect(html.indexOf('commit-override')).toBeLessThan(html.indexOf('commit-reason'))
  })

  it('offers nothing where the form does not, or Commit is free', () => {
    expect(render({ reason: t('commit_blocked_rules') })).not.toContain('commit-override')
    expect(render({ onOverride: () => {} })).not.toContain('commit-override')
  })
})
