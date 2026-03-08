# Windows release build script (PowerShell — no WSL/bash required)
$ErrorActionPreference = "Stop"

$ROOT_DIR = Split-Path -Parent $PSScriptRoot

Write-Host "==> Building Vibe Research (Windows release)"

# Step 1: Build JS bundles
Write-Host "==> Step 1: Build JS bundles"
Set-Location $ROOT_DIR

# Clean leftover electron-builder artifacts
$cleanPaths = @(
  "dist\win-arm64", "dist\win-unpacked", "dist\win",
  "dist\builder-debug.yml", "dist\node_modules"
)
foreach ($p in $cleanPaths) {
  $full = Join-Path $ROOT_DIR $p
  if (Test-Path $full) { Remove-Item -Recurse -Force $full }
}

npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Step 2: Copy Prisma native engine to dist/native/
Write-Host "==> Step 2: Copy Prisma native engine to dist/native/"
$nativeDir = Join-Path $ROOT_DIR "dist\native"
New-Item -ItemType Directory -Force -Path $nativeDir | Out-Null

$prismaClientDir = Join-Path $ROOT_DIR "node_modules\.prisma\client"

# Windows x64 engine
$engineX64 = Get-ChildItem -Path $prismaClientDir -Filter "query_engine-windows*.dll.node" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($engineX64) {
  Copy-Item $engineX64.FullName $nativeDir
  Write-Host "  Copied: $($engineX64.Name) -> dist/native/"
} else {
  Write-Host "  WARNING: Prisma Windows engine not found in $prismaClientDir"
}

# Step 2.5: Rebuild native modules for Electron
Write-Host "==> Step 2.5: Rebuild native modules for Electron"
npx electron-rebuild -f -w better-sqlite3
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Step 2.6: Prepare .prisma/client for packaging
Write-Host "==> Step 2.6: Prepare .prisma/client for packaging"
if (Test-Path $prismaClientDir) {
  $prismaBackup = Join-Path $ROOT_DIR "node_modules\_prisma\client"
  New-Item -ItemType Directory -Force -Path $prismaBackup | Out-Null
  Copy-Item -Recurse -Force "$prismaClientDir\*" $prismaBackup
  Write-Host "  Copied: node_modules\.prisma\client -> node_modules\_prisma\client"
}

# Step 3: Package Windows NSIS installer (x64)
Write-Host "==> Step 3: Package Windows NSIS installer (x64)"
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
npx electron-builder --win --x64 --publish never
$exitCode = $LASTEXITCODE

# Cleanup: remove the temporary _prisma directory after packaging
$prismaTemp = Join-Path $ROOT_DIR "node_modules\_prisma"
if (Test-Path $prismaTemp) { Remove-Item -Recurse -Force $prismaTemp }

if ($exitCode -ne 0) { exit $exitCode }

Write-Host ""
Write-Host "==> Done! Output:"
$exeFiles = Get-ChildItem -Path (Join-Path $ROOT_DIR "release") -Filter "*.exe" -ErrorAction SilentlyContinue
if ($exeFiles) {
  $exeFiles | ForEach-Object { Write-Host "  $($_.FullName)  ($([math]::Round($_.Length/1MB, 1)) MB)" }
} else {
  Write-Host "  No .exe files found, check release/ directory"
}
