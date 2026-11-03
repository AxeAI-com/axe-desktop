#!/usr/bin/env bash
# Runs the app in dev mode against the local website (axe-web ./dev.sh on :3000),
# with its own data folder so it never shares sign-in or the single-instance lock
# with the installed Axe AI. Window edits hot-reload; engine edits restart the app.
set -euo pipefail
cd "$(dirname "$0")/.."

data="${AXE_DATA_DIR:-$HOME/Library/Application Support/Axe AI Dev}"
mkdir -p "$data"

# pnpm can skip Electron's download; fetch it if it's missing.
[[ -f node_modules/electron/path.txt ]] || node node_modules/electron/install.js

# macOS: run as "Axe AI Dev", a copy of Electron with its own bundle id, so sign-in links
# (axedesktop://) reach this window, not some other Electron copy or the installed app.
if [[ "$(uname)" == "Darwin" ]]; then
  src="$(node -p "require('path').dirname(require.resolve('electron/package.json'))")/dist/Electron.app"
  dev_app="node_modules/.cache/axe-dev/Axe AI Dev.app"
  # The suffix changes when the bundle recipe does, so an old copy is rebuilt.
  stamp="$(node -p "require('electron/package.json').version")-axe-icon-2"
  if [[ "$(cat "$dev_app/.electron-version" 2>/dev/null)" != "$stamp" ]]; then
    rm -rf "$dev_app" && mkdir -p "$(dirname "$dev_app")" && cp -R "$src" "$dev_app"
    plist="$dev_app/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.axeai.desktop.dev" \
      -c "Set :CFBundleName Axe AI Dev" -c "Set :CFBundleDisplayName Axe AI Dev" "$plist"
    /usr/libexec/PlistBuddy -c "Delete :CFBundleURLTypes" "$plist" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes array" -c "Add :CFBundleURLTypes:0 dict" \
      -c "Add :CFBundleURLTypes:0:CFBundleURLName string Axe AI sign-in" \
      -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string axedesktop" "$plist"
    # Axe's icon, not Electron's, in the Dock and on notifications.
    iconset="$(mktemp -d)/axe.iconset" && mkdir -p "$iconset"
    for size in 16 32 128 256 512; do
      sips -z $size $size resources/icon-mac.png --out "$iconset/icon_${size}x${size}.png" >/dev/null
      sips -z $((size * 2)) $((size * 2)) resources/icon-mac.png --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
    done
    iconutil -c icns "$iconset" -o "$dev_app/Contents/Resources/electron.icns"
    codesign --force --deep --sign - "$dev_app" >/dev/null 2>&1
    echo "$stamp" > "$dev_app/.electron-version"
  fi
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$dev_app"
  export ELECTRON_EXEC_PATH="$PWD/$dev_app/Contents/MacOS/Electron"
fi

# Google for pages (Analytics, Search Console): Axe's "Desktop app" OAuth client, kept outside the repo.
# The file holds AXE_GOOGLE_CLIENT_ID=… and AXE_GOOGLE_CLIENT_SECRET=….
if [[ -f "$HOME/.axe-google.env" ]]; then set -a; source "$HOME/.axe-google.env"; set +a; fi

# Computer use on the Mac needs the axe-hands helper; release builds make it, so dev does too.
node scripts/build-hands.mjs

export AXE_BASE_URL="${AXE_BASE_URL:-http://localhost:3000}"
export AXE_DATA_DIR="$data"
exec pnpm exec electron-vite dev --watch -- --user-data-dir="$data" --remote-debugging-port="${AXE_DEBUG_PORT:-9333}"
