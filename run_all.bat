@echo off
echo Starting Database Security Portfolio and RMP Components...
echo.

REM Start RMP API server in background
echo Starting RMP API server on port 3001...
start /B cmd /C "cd rmp && npm run api-server"

REM Wait a moment for RMP server to start
timeout /t 3 /nobreak > nul

REM Start Flask portfolio
echo Starting Flask portfolio on port 5000...
start /B cmd /C "python main.py"

echo.
echo Both services are running:
echo - Portfolio: http://localhost:5000
echo - RMP API: http://localhost:3001
echo - RMP UI: http://localhost:5000/rmp/scripts/rmp_ui.html
echo.
echo Press Ctrl+C in each terminal window to stop the services
echo.
pause