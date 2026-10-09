#!/bin/sh
# The Open Layout Tool, local version: serves app/ on http://localhost:8080/ (see README.md).
cd "$(dirname "$0")" && exec node serve.mjs "$@"
