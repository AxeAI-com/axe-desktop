#!/usr/bin/env bash
# Shrinks the changed test screenshots without changing a pixel, so the screenshot tests
# still pass and each UI change adds less to git history. Run after `playwright test -u`.
# Needs oxipng (brew install oxipng).
set -euo pipefail
command -v oxipng >/dev/null || { echo "oxipng missing: brew install oxipng" >&2; exit 1; }
files=()
while IFS= read -r f; do [[ -f "$f" ]] && files+=("$f"); done < <(
  { git diff --name-only -- '*-snapshots/*.png'; git ls-files --others --exclude-standard -- '*-snapshots/*.png'; } | sort -u
)
[[ ${#files[@]} -gt 0 ]] || { echo "no changed screenshots"; exit 0; }
oxipng -o max --strip safe -q "${files[@]}"
echo "optimized ${#files[@]} screenshots"
