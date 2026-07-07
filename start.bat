@echo off
cd /d "%~dp0"

if not exist .env (
  echo Missing .env file.
  echo Copy env.example to .env first, then fill in the Discord token, channel IDs, and secret.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing bot dependencies...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Starting Retro Rewind Lounge Discord bot...
echo Leave this window open while the bot is running.
echo Press Ctrl+C to stop it.
echo.
call npm start

echo.
echo Bot stopped.
pause
