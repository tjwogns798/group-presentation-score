@echo off
chcp 65001 > nul
cd /d "%~dp0"
where node > nul 2>&1
if errorlevel 1 (
  echo.
  echo  Node.js가 설치되어 있지 않아요.
  echo  https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해 주세요.
  echo.
  pause
  exit /b 1
)
start "" http://localhost:8080
node ai-hancut-server.js
pause
