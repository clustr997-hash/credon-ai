@echo off
setlocal
cd /d "%~dp0"
if not exist "frontend\package.json" (
  echo [Credon AI] Run this script from the extracted credon-ai repo folder.
  exit /b 1
)
cd frontend
echo [Credon AI] Installing frontend packages ...
call npm install || exit /b 1
echo [Credon AI] Starting frontend at http://localhost:3000 ...
call npm run dev
