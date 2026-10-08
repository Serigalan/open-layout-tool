import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PROJECT_IMAGES, fitToSlot, textToBase64 } from './projectImages'
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

describe('fitToSlot', () => {
  it('pads a portrait picture left and right to 4:3', () => {
    expect(fitToSlot(300, 600)).toEqual({ w: 800, h: 600, x: 250, y: 0, dw: 300, dh: 600 })
  })

  it('pads a wide picture above and below', () => {
    expect(fitToSlot(800, 200)).toEqual({ w: 800, h: 600, x: 0, y: 200, dw: 800, dh: 200 })
  })

  it('leaves a 4:3 picture as it is', () => {
    expect(fitToSlot(640, 480)).toEqual({ w: 640, h: 480, x: 0, y: 0, dw: 640, dh: 480 })
  })

  it('scales a large picture down to the width limit', () => {
    expect(fitToSlot(4000, 4000)).toEqual({ w: 960, h: 720, x: 120, y: 0, dw: 720, dh: 720 })
  })
})
