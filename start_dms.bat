@echo off
setlocal enabledelayedexpansion

echo Starting DMS Application (Backend + Frontend)...
echo.

REM Start Backend in a new window
echo Launching Backend...
start "DMS Backend" cmd /k "cd /d Backend && venv\Scripts\activate.bat && python manage.py runserver 0.0.0.0:8000"

REM Wait for backend to be ready
echo.
echo Waiting for Backend to start and be ready...
:wait_backend
timeout /t 3 /nobreak >nul
netstat -ano | find ":8000" >nul 2>&1
if errorlevel 1 (
    goto wait_backend
)

echo Backend is ready!
echo.

REM Start Frontend in a new window
echo Launching Frontend...
start "DMS Frontend" cmd /k "cd /d Frontend && npm run dev -- --host 0.0.0.0"

echo.
echo ===================================== 
echo Services are starting:
echo - Backend:  http://localhost:8000
echo - Frontend: http://localhost:3000
echo ===================================== 
echo.
