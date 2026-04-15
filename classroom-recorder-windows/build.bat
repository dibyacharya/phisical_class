@echo off
title LectureLens Recorder — Build
color 0A

echo.
echo  ╔═══════════════════════════════════════════╗
echo  ║    LectureLens Recorder — Windows Build     ║
echo  ║    Output: dist\LectureLens-Recorder*.exe   ║
echo  ╚═══════════════════════════════════════════╝
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found!
    echo         Install from: https://nodejs.org  ^(LTS version^)
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo [OK] Node.js %NODE_VER% found

:: Install dependencies
echo.
echo [1/3] Installing dependencies...
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] npm install failed
    pause & exit /b 1
)

:: Check icon
if not exist "assets\icon.ico" (
    echo.
    echo [WARN] assets\icon.ico not found — generating SVG placeholder...
    node create-icon.js
    echo        For best results, convert assets\icon.svg to assets\icon.ico
    echo        Online: https://convertio.co/svg-ico/
    echo.
)

:: Build
echo.
echo [2/3] Building Windows executables...
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] Build failed
    pause & exit /b 1
)

echo.
echo [3/3] Done!
echo.
echo  ╔══════════════════════════════════════════════════════════╗
echo  ║  Output files in dist\ folder:                          ║
echo  ║                                                          ║
echo  ║  LectureLens-Recorder-Setup.exe    ← Installer (.exe)     ║
echo  ║  LectureLens-Recorder-Portable.exe ← No install needed    ║
echo  ║                                                          ║
echo  ║  Distribute EITHER file to classrooms.                   ║
echo  ║  No Node.js required on target machine!                  ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.
explorer dist
pause
