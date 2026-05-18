@echo off
cd /d Backend
if not exist venv python -m venv venv
call venv\Scripts\activate.bat
set DJANGO_SETTINGS_MODULE=config.settings.development
pip install -r requirements.txt --quiet
python manage.py migrate
echo.
echo =====================================
echo Backend is RUNNING at http://localhost:8000
echo =====================================
echo.
python manage.py runserver 0.0.0.0:8000
