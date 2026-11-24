@echo off
title VERNOVA YOLO Studio Server
echo ===================================================
echo   VERNOVA YOLO + OpenCV Training Studio Backend
echo   Listening on: http://127.0.0.1:8000
echo   Docs: http://127.0.0.1:8000/docs
echo ===================================================

where python >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Python tidak ditemukan di PATH. Silakan install Python 3.10+ terlebih dahulu.
    pause
    exit /b 1
)

python -m uvicorn yolo_studio.server:app --host 127.0.0.1 --port 8000 --reload
pause
