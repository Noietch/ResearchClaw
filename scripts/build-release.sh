#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Building Vibe Research (Mac release)"

echo "==> Step 1: Build JS bundles"
cd "$ROOT_DIR"
# Clean leftover electron-builder artifacts and staged files from dist/
rm -rf "$ROOT_DIR/dist/mac-arm64" "$ROOT_DIR/dist/mac" "$ROOT_DIR/dist/builder-debug.yml" "$ROOT_DIR/dist/node_modules"
npm run build

echo "==> Step 2: Copy Prisma native engine to dist/native/"
# @prisma/client JS is shipped via node_modules (it's in `dependencies`).
# The native query engine (.dylib.node) must be outside asar — copy to dist/native/
# and let asarUnpack extract it.
mkdir -p "$ROOT_DIR/dist/native"

PRISMA_ENGINE=$(find "$ROOT_DIR/node_modules/.prisma/client" -name "libquery_engine-darwin-arm64.dylib.node" 2>/dev/null | head -1)
if [ -n "$PRISMA_ENGINE" ]; then
  cp "$PRISMA_ENGINE" "$ROOT_DIR/dist/native/"
  echo "  Copied: $(basename "$PRISMA_ENGINE") → dist/native/"
else
  echo "  WARNING: Prisma arm64 engine not found"
fi

# Copy x64 engine for Intel Macs
PRISMA_ENGINE_X64=$(find "$ROOT_DIR/node_modules/.prisma/client" -name "libquery_engine-darwin-x64.dylib.node" 2>/dev/null | head -1)
if [ -n "$PRISMA_ENGINE_X64" ]; then
  cp "$PRISMA_ENGINE_X64" "$ROOT_DIR/dist/native/"
  echo "  Copied: $(basename "$PRISMA_ENGINE_X64") → dist/native/"
fi

echo "==> Step 2.5: Rebuild native modules for Electron"
npx electron-rebuild -f -w better-sqlite3

echo "==> Step 2.6: Prepare .prisma/client for packaging"
# electron-builder ignores hidden dirs (starting with .) in files config.
# Copy .prisma/client to _prisma/client (non-hidden) so it gets included in asar.
# @prisma/client's default.js does require('.prisma/client/default'), which will
# resolve to node_modules/.prisma/client. We create _prisma as backup and handle
# the path in main process.
if [ -d "$ROOT_DIR/node_modules/.prisma/client" ]; then
  mkdir -p "$ROOT_DIR/node_modules/_prisma"
  cp -R "$ROOT_DIR/node_modules/.prisma/client" "$ROOT_DIR/node_modules/_prisma/"
  echo "  Copied: node_modules/.prisma/client → node_modules/_prisma/client"
fi

echo "==> Step 3: Package Mac DMG (arm64 + x64)"
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" \
  npx electron-builder --mac --publish never

# Cleanup: remove the temporary _prisma directory after packaging
rm -rf "$ROOT_DIR/node_modules/_prisma"

echo ""
echo "==> Done! Output:"
ls -lh "$ROOT_DIR/release/"*.dmg
