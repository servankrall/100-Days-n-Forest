@echo off
REM 100 Gun Ormanda - Windows tek-tik baslatici. Cift tikla calistir.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js bulunamadi. Once kur:  https://nodejs.org
  echo.
  pause
  exit /b 1
)
node launch.cjs
pause
