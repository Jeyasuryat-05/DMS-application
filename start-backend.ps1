Set-Location "$PSScriptRoot\Backend"
Write-Host "Starting DMS Backend on http://localhost:8000 ..." -ForegroundColor Cyan
.\venv\Scripts\python.exe manage.py runserver
