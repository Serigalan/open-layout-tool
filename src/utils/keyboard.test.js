import { describe, it, expect } from 'vitest'
import { isProjectUndo, isTypingTarget } from './keyboard'

const key = (extra) => ({ key: 'z', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, target: { tagName: 'DIV' }, ...extra })

describe('keyboard shortcuts (R0.6)', () => {
  it('Ctrl+Z and Cmd+Z undo the project step outside a field', () => {
    expect(isProjectUndo(key())).toBe(true)
    expect(isProjectUndo(key({ ctrlKey: false, metaKey: true }))).toBe(true)
  })

  it('leave Ctrl+Z to inputs, textareas, selects and contenteditable', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'input']) {
      expect(isProjectUndo(key({ target: { tagName } }))).toBe(false)
    }
    expect(isProjectUndo(key({ target: { tagName: 'DIV', isContentEditable: true } }))).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })

  it('is not Shift+Ctrl+Z or a plain z', () => {
    expect(isProjectUndo(key({ shiftKey: true }))).toBe(false)
    expect(isProjectUndo(key({ ctrlKey: false }))).toBe(false)
  })
})
