@echo off
echo Starting DMS Frontend...

if not exist node_modules (
    echo Installing dependencies...
    npm install
)

echo Frontend running at http://localhost:3000
npm run dev
