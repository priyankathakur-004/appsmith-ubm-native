#!/bin/sh
# Offline tests for the Correction Rules page: the SQL compiler, then the
# RuleBuilder widget driven in jsdom. The UI test's packages (react, htm,
# jsdom) install into a folder outside the repo, given as $1 or a temp dir.
#
# Usage: sh scripts/correction-rules-tests/run.sh [deps-dir]
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
DEPS=${1:-${TMPDIR:-/tmp}/correction-rules-test-deps}

node "$HERE/compiler.test.js"

mkdir -p "$DEPS"
if [ ! -d "$DEPS/node_modules/jsdom" ]; then
  (cd "$DEPS" && npm init -y >/dev/null && npm i --silent react@18.2.0 react-dom@18.2.0 htm@3.1.1 jsdom@24)
fi
cp "$HERE/ui.test.mjs" "$DEPS/ui.test.mjs"
REPO="$HERE/../.." node "$DEPS/ui.test.mjs"
