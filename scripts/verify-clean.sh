#!/usr/bin/env bash
# Build (and optionally test) a copy of the repo with NO .env files, no
# private/ data and an empty app environment — proves `pnpm build` needs no env.
#   bash scripts/verify-clean.sh [--test]
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
dest="$root/.work/clean"
mkdir -p "$dest"
rsync -a --delete \
  --exclude='.env*' --exclude='node_modules' --exclude='.next' --exclude='private' \
  --exclude='.work' --exclude='.git' --exclude='SPEC-revamp-draft.md' \
  --exclude='.claude-brief*' --exclude='claude-run*' --exclude='*.tsbuildinfo' \
  "$root/" "$dest/"
cd "$dest"
# Only PATH/HOME survive: no DATABASE_URL, auth, analytics or API keys.
env -i PATH="$PATH" HOME="$HOME" CI=1 pnpm install --offline --frozen-lockfile --reporter=silent
env -i PATH="$PATH" HOME="$HOME" CI=1 NEXT_TELEMETRY_DISABLED=1 pnpm build
if [[ "${1:-}" == "--test" ]]; then
  env -i PATH="$PATH" HOME="$HOME" CI=1 pnpm test
fi
echo "Clean build OK (no env)."
