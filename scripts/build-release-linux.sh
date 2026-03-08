#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Building Vibe Research (Linux release)"

echo "==> Step 1: Build JS bundles"
cd "$ROOT_DIR"
# Clean leftover electron-builder artifacts and staged files from dist/
rm -rf "$ROOT_DIR/dist/linux-arm64" "$ROOT_DIR/dist/linux-unpacked" "$ROOT_DIR/dist/linux" "$ROOT_DIR/dist/builder-debug.yml" "$ROOT_DIR/dist/node_modules"
npm run build

echo "==> Step 2: Copy Prisma native engine to dist/native/"
mkdir -p "$ROOT_DIR/dist/native"

# Linux x64 engine
PRISMA_ENGINE_X64=$(find "$ROOT_DIR/node_modules/.prisma/client" -name "libquery_engine-linux-x64.so.node" 2>/dev/null | head -1)
if [ -n "$PRISMA_ENGINE_X64" ]; then
  cp "$PRISMA_ENGINE_X64" "$ROOT_DIR/dist/native/"
  echo "  Copied: $(basename "$PRISMA_ENGINE_X64") → dist/native/"
else
  echo "  WARNING: Prisma Linux x64 engine not found"
fi

# Linux arm64 engine (for ARM servers like AWS Graviton)
PRISMA_ENGINE_ARM64=$(find "$ROOT_DIR/node_modules/.prisma/client" -name "libquery_engine-linux-arm64.so.node" 2>/dev/null | head -1)
if [ -n "$PRISMA_ENGINE_ARM64" ]; then
  cp "$PRISMA_ENGINE_ARM64" "$ROOT_DIR/dist/native/"
  echo "  Copied: $(basename "$PRISMA_ENGINE_ARM64") → dist/native/"
fi

# Debian/Ubuntu specific engine (musl for Alpine)
PRISMA_ENGINE_MUSL=$(find "$ROOT_DIR/node_modules/.prisma/client" -name "libquery_engine-linux-musl.so.node" 2>/dev/null | head -1)
if [ -n "$PRISMA_ENGINE_MUSL" ]; then
  cp "$PRISMA_ENGINE_MUSL" "$ROOT_DIR/dist/native/"
  echo "  Copied: $(basename "$PRISMA_ENGINE_MUSL") → dist/native/"
fi

echo "==> Step 2.5: Rebuild native modules for Electron"
npx electron-rebuild -f -w better-sqlite3

echo "==> Step 2.6: Prepare .prisma/client for packaging"
if [ -d "$ROOT_DIR/node_modules/.prisma/client" ]; then
  mkdir -p "$ROOT_DIR/node_modules/_prisma"
  cp -R "$ROOT_DIR/node_modules/.prisma/client" "$ROOT_DIR/node_modules/_prisma/"
  echo "  Copied: node_modules/.prisma/client → node_modules/_prisma/client"
fi

echo "==> Step 3: Package Linux AppImage (x64)"
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" \
  npx electron-builder --linux --x64 --publish never

# Cleanup: remove the temporary _prisma directory after packaging
rm -rf "$ROOT_DIR/node_modules/_prisma"

echo ""
echo "==> Done! Output:"
ls -lh "$ROOT_DIR/release/"*.AppImage 2>/dev/null || echo "  No .AppImage files found, check release/ directory"
