@echo off
echo =============================================
echo  DMS Application - Reset Data
echo  WARNING: This will DELETE all documents,
echo  users, and configurations, then re-seed
echo  with sample data.
echo =============================================
echo.
set /p CONFIRM=Type YES to confirm reset:
if /i not "%CONFIRM%"=="YES" (
    echo Reset cancelled.
    pause
    exit /b
)

echo.
echo Stopping any running DMS services...
for /f "tokens=5" %%a in ('netstat -ano ^| find ":8000" ^| find "LISTENING"') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| find ":3000" ^| find "LISTENING"') do taskkill /PID %%a /F >nul 2>&1

echo.
echo Activating Python environment...
cd /d Backend
call venv\Scripts\activate.bat

echo.
echo Resetting database migrations...
python manage.py migrate api zero --no-input
if errorlevel 1 (
    echo ERROR: Failed to rollback migrations.
    pause
    exit /b 1
)

echo.
echo Re-applying all migrations...
python manage.py migrate --no-input
if errorlevel 1 (
    echo ERROR: Failed to apply migrations.
    pause
    exit /b 1
)

echo.
echo Seeding sample data (doc types, test users)...
python manage.py shell -c "
from django.test.utils import setup_test_environment
import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.development')
import requests, json
# Use the seed API endpoint via management command style
from api.views.admin_views import seed_data
from unittest.mock import MagicMock
req = MagicMock()
req.method = 'POST'
req.user = MagicMock()
req.user.role = 'System Admin'
res = seed_data(req)
print('Seed result:', res.status_code)
" 2>nul

REM Fallback: seed via direct management
python manage.py seed_metadata_schemas 2>nul

cd /d ..

echo.
echo =============================================
echo Reset complete! Sample data restored.
echo Run START_APP.bat to start the application.
echo =============================================
pause
