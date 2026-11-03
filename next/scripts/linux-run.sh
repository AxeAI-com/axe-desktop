#!/usr/bin/env bash
# Builds the app on Linux (arm64, in Docker) and runs tests/e2e/real-run.mjs against the website on
# this Mac's :3000. Usage: scripts/linux-run.sh <out-dir>   (needs AXE_SELFTEST_COOKIE)
# The dev server listens on [::1]:3000 and only accepts localhost names, so: a forwarder on the Mac's
# 127.0.0.1:3005 (Docker reaches it as host.docker.internal), and one in the container on localhost:3005.
set -euo pipefail
node -e 'require("net").createServer((c)=>{const u=require("net").connect(3000,"::1");c.pipe(u).pipe(c);u.on("error",()=>c.destroy());c.on("error",()=>u.destroy())}).listen(3005,"127.0.0.1")' &
fwd=$!
trap 'kill $fwd 2>/dev/null' EXIT
here="$(cd "$(dirname "$0")/.." && pwd)"
out="$(mkdir -p "$1" && cd "$1" && pwd)"
# Under $HOME: Docker Desktop shares it (not always the system temp folder).
mkdir -p "$HOME/.cache" && work="$(mktemp -d "$HOME/.cache/axe-linux-run.XXXX")"
rsync -a --exclude node_modules --exclude out --exclude dist --exclude test-results "$here/" "$work/app/"
cat > "$work/run.sh" <<'IN'
set -e
apt-get update -qq >/dev/null
apt-get install -y -qq xvfb xauth libgtk-3-0 libnss3 libasound2 libgbm1 libxss1 libxtst6 libatk-bridge2.0-0 libdrm2 fonts-noto-color-emoji >/dev/null
corepack enable >/dev/null 2>&1
cd /w/app
CI=1 pnpm install --frozen-lockfile >/dev/null
pnpm run build >/dev/null
node -e 'require("net").createServer((c)=>{const u=require("net").connect(3005,"host.docker.internal");c.pipe(u).pipe(c);u.on("error",()=>c.destroy());c.on("error",()=>u.destroy())}).listen(3005,"127.0.0.1")' &
AXE_BASE_URL=http://localhost:3005 AXE_SELFTEST_ORIGIN=http://localhost:3000 \
  xvfb-run -a -s "-screen 0 1440x900x24" node tests/e2e/real-run.mjs /out
IN
docker run --rm --platform linux/arm64 -e AXE_SELFTEST_COOKIE -v "$work":/w -v "$out":/out node:24-bookworm bash /w/run.sh
rm -rf "$work"
