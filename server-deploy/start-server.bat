@echo off
chcp 65001 >nul
echo Starting AI Creative Studio Server...
echo.

cd /d "%~dp0"

if not exist "node_modules" (
    echo Installing dependencies...
    npm install
    echo.
)

echo Starting server on port 3000...
echo Frontend: http://localhost:3000
echo API: http://localhost:3000/api
echo.

node server.js

pause