#!/usr/bin/env node
// The module hook first (src/esmHook.mjs), then the command: the server
// imports the browser's own modules from src/, which only resolve with it.
import '../src/register.mjs'

await import('../src/cli.js')
