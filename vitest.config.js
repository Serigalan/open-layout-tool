import { defineConfig } from 'vitest/config'

// The modules under test (elementUtils, clothoidUtils, switchUtils, …) are
// plain math on plain objects, and the one component with tests of its own is
// rendered to static markup — no DOM either way. Node is enough and keeps the
// suite fast. JSX is transformed with the automatic runtime — the same one the
// app builds with (@vitejs/plugin-react); esbuild's classic default would want
// React in scope, which no component imports.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
})
