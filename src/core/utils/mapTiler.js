/**
 * The MapTiler key for the satellite basemap and the terrain-RGB tiles. It is
 * not restricted to any domain (checked 2026-10-09), so every instance can use
 * it; an instance that needs its own sets VITE_MAPTILER_KEY at build time.
 * `?.` because the project server loads browser modules under plain Node too.
 */
export const MAPTILER_KEY = import.meta.env?.VITE_MAPTILER_KEY || 'QojDLOuI2wG4mNbHjzA7'
