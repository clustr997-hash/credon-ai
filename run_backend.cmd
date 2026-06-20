@echo off
setlocal
cd /d "%~dp0"
if not exist "backend\requirements.txt" (
  echo [Credon AI] Run this script from the extracted credon-ai repo folder.
  exit /b 1
)
if exist "backend\.venv\Scripts\python.exe" (
  set "PY=backend\.venv\Scripts\python.exe"
) else (
  set "PY=python"
)
echo [Credon AI] Installing backend requirements with %PY% ...
%PY% -m pip install -r backend\requirements.txt || exit /b 1
echo [Credon AI] Starting backend at http://127.0.0.1:8000 ...
%PY% -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
