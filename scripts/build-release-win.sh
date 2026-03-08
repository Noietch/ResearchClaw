#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Building Vibe Research (Windows release)"

echo "==> Step 1: Build JS bundles"
cd "$ROOT_DIR"
# Clean leftover electron-builder artifacts and staged files from dist/
rm -rf "$ROOT_DIR/dist/win-arm64" "$ROOT_DIR/dist/win-unpacked" "$ROOT_DIR/dist/win" "$ROOT_DIR/dist/builder-debug.yml" "$ROOT_DIR/dist/node_modules"
npm run build

echo "==> Step 2: Copy Prisma native engine to dist/native/"
mkdir -p "$ROOT_DIR/dist/native"

# Windows x64 engine
PRISMA_ENGINE_X64=$(find "$ROOT_DIR/node_modules/.prisma/client" -name "query_engine-windows-x64.dll.node" 2>/dev/null | head -1)
if [ -n "$PRISMA_ENGINE_X64" ]; then
  cp "$PRISMA_ENGINE_X64" "$ROOT_DIR/dist/native/"
  echo "  Copied: $(basename "$PRISMA_ENGINE_X64") → dist/native/"
else
  echo "  WARNING: Prisma Windows x64 engine not found"
fi

# Windows arm64 engine (for ARM-based Windows devices)
PRISMA_ENGINE_ARM64=$(find "$ROOT_DIR/node_modules/.prisma/client" -name "query_engine-windows-arm64.dll.node" 2>/dev/null | head -1)
if [ -n "$PRISMA_ENGINE_ARM64" ]; then
  cp "$PRISMA_ENGINE_ARM64" "$ROOT_DIR/dist/native/"
  echo "  Copied: $(basename "$PRISMA_ENGINE_ARM64") → dist/native/"
fi

echo "==> Step 2.5: Rebuild native modules for Electron"
npx electron-rebuild -f -w better-sqlite3

echo "==> Step 2.6: Prepare .prisma/client for packaging"
if [ -d "$ROOT_DIR/node_modules/.prisma/client" ]; then
  mkdir -p "$ROOT_DIR/node_modules/_prisma"
  cp -R "$ROOT_DIR/node_modules/.prisma/client" "$ROOT_DIR/node_modules/_prisma/"
  echo "  Copied: node_modules/.prisma/client → node_modules/_prisma/client"
fi

echo "==> Step 3: Package Windows NSIS installer (x64)"
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" \
  npx electron-builder --win --x64 --publish never

# Cleanup: remove the temporary _prisma directory after packaging
rm -rf "$ROOT_DIR/node_modules/_prisma"

echo ""
echo "==> Done! Output:"
ls -lh "$ROOT_DIR/release/"*.exe 2>/dev/null || echo "  No .exe files found, check release/ directory"
