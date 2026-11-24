# VERNOVA YOLO + OpenCV Training Studio Server Launcher
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "  VERNOVA YOLO + OpenCV Training Studio Backend" -ForegroundColor Green
Write-Host "  Listening on: http://127.0.0.1:8000" -ForegroundColor White
Write-Host "  Interactive API Docs: http://127.0.0.1:8000/docs" -ForegroundColor Yellow
Write-Host "===================================================" -ForegroundColor Cyan

$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
    Write-Host "[ERROR] Python tidak ditemukan di PATH. Silakan instal Python 3.10+." -ForegroundColor Red
    exit 1
}

python -m uvicorn yolo_studio.server:app --host 127.0.0.1 --port 8000 --reload
