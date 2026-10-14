@echo off
setlocal
set "GPTIBO_NODE="
if exist "D:\ChatGPT\CodexCache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "GPTIBO_NODE=D:\ChatGPT\CodexCache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not defined GPTIBO_NODE for /f "delims=" %%N in ('where.exe node.exe 2^>nul') do if not defined GPTIBO_NODE set "GPTIBO_NODE=%%N"
if not defined GPTIBO_NODE (
  echo Node.js was not found. Restore the D-drive local runtime described in docs\LOCAL_SETUP.md.
  pause
  exit /b 1
)
set "GPTIBO_ROLE=%~1"
if not defined GPTIBO_ROLE set "GPTIBO_ROLE=admin"
set "GPTIBO_WATCH=--watch"
if /i "%~2"=="--once" set "GPTIBO_WATCH="
"%GPTIBO_NODE%" "%~dp0scripts\local\auth.mjs" "%GPTIBO_ROLE%" %GPTIBO_WATCH%
set "GPTIBO_EXIT=%ERRORLEVEL%"
if not "%GPTIBO_EXIT%"=="0" pause
exit /b %GPTIBO_EXIT%
