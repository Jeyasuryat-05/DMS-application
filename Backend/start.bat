@echo off
echo Starting DMS Backend (Django)...

if not exist venv (
    python -m venv venv
)
call venv\Scripts\activate

pip install -r requirements.txt --quiet

set DJANGO_SETTINGS_MODULE=config.settings.development

:: Read PORT from .env (default 8000)
for /f "tokens=2 delims==" %%A in ('findstr /i "^PORT=" .env 2^>nul') do set APP_PORT=%%A
if not defined APP_PORT set APP_PORT=8000

echo Running migrations...
python manage.py migrate

echo Backend running at http://localhost:%APP_PORT%
python manage.py runserver 0.0.0.0:%APP_PORT%
