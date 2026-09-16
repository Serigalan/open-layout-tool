import { defineConfig } from 'vitest/config'

// The modules under test (elementUtils, clothoidUtils, switchUtils, …) are
// plain math on plain objects — no DOM, no React. Node is enough and keeps
// the suite fast; add a jsdom project later if component tests show up.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
})
