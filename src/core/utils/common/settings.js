// The user's own settings (language, colour, layers, terrain source) — per
// browser, in localStorage, never part of a project.
export const SETTINGS_KEY = 'olt_settings'

export function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') } catch { return {} }
}

export function saveSettings(patch) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...loadSettings(), ...patch }))
}
