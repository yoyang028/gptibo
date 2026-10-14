@echo off
setlocal
set "GPTIBO_PWSH="
if exist "D:\ChatGPT\CodexCache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe" set "GPTIBO_PWSH=D:\ChatGPT\CodexCache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe"
if not defined GPTIBO_PWSH for /f "delims=" %%N in ('where.exe pwsh.exe 2^>nul') do if not defined GPTIBO_PWSH set "GPTIBO_PWSH=%%N"
if not defined GPTIBO_PWSH (
  echo PowerShell 7 was not found. See docs\QUEFA_LOCAL.md.
  pause
  exit /b 1
)
set "GPTIBO_MODE=%~1"
if not defined GPTIBO_MODE set "GPTIBO_MODE=start"
"%GPTIBO_PWSH%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\local\quefa.ps1" -Mode "%GPTIBO_MODE%"
set "GPTIBO_EXIT=%ERRORLEVEL%"
if not "%GPTIBO_EXIT%"=="0" pause
exit /b %GPTIBO_EXIT%
