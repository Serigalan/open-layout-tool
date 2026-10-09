import { createElement } from 'react'
import { I18nContext, i18nValue } from '../locales/i18nContext'

// Components are rendered in German in the tests, as the app shows them there.
const DE = i18nValue('de', () => {})

/** The German translate function. */
export const t = DE.t

/** `element` under a German I18n provider. */
export const inGerman = (element) => createElement(I18nContext.Provider, { value: DE }, element)
