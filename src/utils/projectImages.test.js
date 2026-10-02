import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PROJECT_IMAGES, textToBase64 } from './projectImages'
import { translations } from '../locales/i18n'

const DIR = fileURLToPath(new URL('../../public/project-images/', import.meta.url))

describe('the default project pictures', () => {
  it('are each a file the app serves, and every file is listed', () => {
    const files = readdirSync(DIR).filter(f => f.endsWith('.svg')).sort()
    expect(PROJECT_IMAGES.map(i => i.file).sort()).toEqual(files)
  })

  it('have unique keys and a name in every language', () => {
    expect(new Set(PROJECT_IMAGES.map(i => i.key)).size).toBe(PROJECT_IMAGES.length)
    for (const lang of Object.keys(translations)) {
      for (const { labelKey } of PROJECT_IMAGES) {
        expect(typeof translations[lang][labelKey], `${lang}.${labelKey}`).toBe('string')
      }
    }
  })

  it('are 4:3 like the slot on the start page, and carry their credit', () => {
    for (const { file } of PROJECT_IMAGES) {
      const svg = readFileSync(DIR + file, 'utf8')
      expect(svg, file).toMatch(/viewBox="0 0 240 180"/)
      expect(svg, file).toMatch(/Natural Earth|Font Awesome Free/)
    }
  })
})

describe('textToBase64', () => {
  it('encodes UTF-8, not Latin-1', () => {
    expect(atob(textToBase64('Österreich — ✓'))).toBe(
      String.fromCharCode(...new TextEncoder().encode('Österreich — ✓')))
  })
})
