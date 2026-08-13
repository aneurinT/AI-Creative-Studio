@echo off
chcp 65001 >nul
echo Starting AI Creative Studio...

REM Start Backend
echo Starting Backend (port 3001)...
start "AI Backend" /MIN cmd /c "cd /d %~dp0 && npx tsx api/server.ts"

REM Start Frontend
echo Starting Frontend (port 5173)...
start "AI Frontend" /MIN cmd /c "cd /d %~dp0 && npx vite --host 0.0.0.0"

echo All services are starting...
echo Backend: http://localhost:3001
echo Frontend: http://localhost:5173
timeout /t 3 /nobreak >nul
start http://localhost:5173
echo Done!  