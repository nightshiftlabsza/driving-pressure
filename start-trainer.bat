@echo off
title ICU Respiratory Trainer
echo ========================================================
echo               ICU Respiratory Trainer
echo ========================================================
echo.
echo Starting offline local trainer server...
echo.
cd /d "%~dp0"

REM Check for Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found in PATH.
    echo Please install Node.js 18+ to run the trainer offline.
    echo Download from: https://nodejs.org/
    pause
    exit /b 1
)

REM Build production distribution if missing
if not exist "dist" (
    echo Production build not found. Building offline bundle (first-time setup)...
    call npm run build
    if %errorlevel% neq 0 (
        echo [ERROR] Build failed. Please inspect errors above.
        pause
        exit /b 1
    )
)

echo Starting local server at http://localhost:3100/#/trainer ...
start "" "http://localhost:3100/#/trainer"
call npm run preview -- --port 3100 --strictPort
