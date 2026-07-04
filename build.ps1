# Luna — PyInstaller onedir build (SPEC §10).
# Run from the repo root:  powershell -ExecutionPolicy Bypass -File build.ps1
# Output: dist/Luna/Luna.exe
#
# Notes:
# - onedir, NOT onefile (faster start, fewer AV false positives).
# - luna/ui is bundled via --add-data so the static mount works in the exe.
# - The faster-whisper tiny.en model is NOT bundled; it downloads to
#   %LOCALAPPDATA%\Luna\whisper_models on first mic use.

$ErrorActionPreference = "Stop"

Write-Host "==> Syncing dependencies (incl. dev group for PyInstaller)"
uv sync

$icon = "assets\icon.ico"
$iconArgs = @()
if (Test-Path $icon) {
    $iconArgs = @("--icon", $icon)
} else {
    Write-Warning "assets\icon.ico not found - building without an icon."
}

Write-Host "==> Running PyInstaller (onedir)"
uv run pyinstaller `
    --name Luna `
    --noconsole `
    --onedir `
    --noconfirm `
    --clean `
    @iconArgs `
    --add-data "luna\ui;luna\ui" `
    --collect-all faster_whisper `
    --collect-all ctranslate2 `
    --hidden-import "winotify" `
    --hidden-import "sounddevice" `
    --hidden-import "pyttsx3.drivers" `
    --hidden-import "pyttsx3.drivers.sapi5" `
    luna\main.py

if ($LASTEXITCODE -ne 0) {
    Write-Error "PyInstaller failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "==> Build complete: dist\Luna\Luna.exe"
