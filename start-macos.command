#!/bin/sh
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo 'Please install Node.js 22 or later from https://nodejs.org/'
  echo 'Then reopen this file. Press Enter to close.'
  read -r answer
  exit 1
fi
exec node scripts/start-local.mjs
