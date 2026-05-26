@echo off
title FairyVoice Tool
set "WEB_DIR=%~dp0web"

if not exist "%WEB_DIR%\node_modules" (
    echo Installing frontend dependencies...
    cd /d "%WEB_DIR%"
    npm install
    if errorlevel 1 (
        echo [ERROR] Failed to install frontend dependencies
        pause
        exit /b 1
    )
)

echo.
echo Starting FairyVoice (Vite :5173) ...
cd /d "%WEB_DIR%"
start "FairyVoice Frontend" cmd /k "npm run dev"

timeout /t 3 /nobreak >nul

echo.
echo ======================================
echo   FairyVoice started!
echo   Frontend: http://localhost:5173
echo ======================================
echo.
echo Close 'FairyVoice Frontend' window to stop.
echo.
echo Press any key to open browser...
pause >nul
start http://localhost:5173
