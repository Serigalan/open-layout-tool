import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

// ESLint's own no-unused-vars does not see a component used only as JSX
// (`<Panel />`). This marks such names as used — the one rule of
// eslint-plugin-react this codebase needs, without its hundred dependencies.
const jsxUsesVars = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    return {
      JSXOpeningElement(node) {
        let name = node.name
        while (name.type === 'JSXMemberExpression') name = name.object
        if (name.type !== 'JSXIdentifier') return
        if (node.name.type === 'JSXIdentifier' && !/^[A-Z]/.test(name.name)) return
        context.sourceCode.markVariableAsUsed(name.name, node)
      },
    }
  },
}

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: { local: { rules: { 'jsx-uses-vars': jsxUsesVars } } },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'local/jsx-uses-vars': 'error',
      // `const { a: _a, ...rest } = obj` is how this codebase omits keys — the
      // named siblings of a rest element are omissions, not unused variables.
      'no-unused-vars': ['error', { varsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },
  {
    // The one direction between the two layers (Paket L, decision 277): the
    // browser components never import the server components. Where a server
    // part has to show up in core, core offers an extension point
    // (core/extensions.js) that src/server/register.js fills.
    files: ['src/core/**/*.{js,jsx}'],
    rules: {
      'no-restricted-imports': ['warn', {
        patterns: [{
          regex: '^(\\.\\./)+server(/|$)',
          message: 'src/core never imports from src/server (decision 277) — add an extension point to core/extensions.js instead.',
        }],
      }],
    },
  },
  {
    files: ['src/**/*.test.js', 'src/test/**/*.js', 'tools/server/**/*.{js,mjs}', '*.config.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
])
