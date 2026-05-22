@echo off
echo Stopping DMS Application...
echo.

REM Kill Backend (Django on port 8000)
echo Stopping Backend (port 8000)...
for /f "tokens=5" %%a in ('netstat -ano ^| find ":8000" ^| find "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)

REM Kill Frontend (Vite on port 3000 or 5173)
echo Stopping Frontend (port 3000/5173)...
for /f "tokens=5" %%a in ('netstat -ano ^| find ":3000" ^| find "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| find ":5173" ^| find "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)

REM Also close the named console windows if still open
taskkill /FI "WINDOWTITLE eq DMS Backend*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq DMS Frontend*" /F >nul 2>&1

echo.
echo =====================================
echo DMS Application stopped.
echo =====================================
pause
