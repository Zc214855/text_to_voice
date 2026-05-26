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
echo Starting Edge TTS Server (:5174) ...
cd /d "%WEB_DIR%"
start "Edge-TTS Server" cmd /k "node server/index.js"

timeout /t 2 /nobreak >nul

echo.
echo Starting FairyVoice Frontend (:5173) ...
cd /d "%WEB_DIR%"
start "FairyVoice Frontend" cmd /k "npm run dev"

timeout /t 3 /nobreak >nul

echo.
echo ======================================
echo   FairyVoice started!
echo   Frontend:  http://localhost:5173
echo   Edge TTS:  http://localhost:5174
echo ======================================
echo.
echo Close both windows to stop.
echo.
echo Press any key to open browser...
pause >nul
start http://localhost:5173
