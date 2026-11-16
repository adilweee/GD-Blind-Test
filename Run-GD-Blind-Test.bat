@echo off
setlocal
set "APPDIR=%~dp0"
if exist "%~dp0index.html" goto serve
if exist "%~dp0outputs\index.html" set "APPDIR=%~dp0outputs\"
if not exist "%APPDIR%index.html" goto notfound
:serve
echo Serving site folder: %APPDIR%
echo Open http://127.0.0.1:8765/ and keep this window open.
python -m http.server 8765 --bind 127.0.0.1 --directory "%APPDIR%"
if errorlevel 1 pause
exit /b
:notfound
echo ERROR: index.html not found.
echo Run this file from the project folder or its outputs folder.
echo The launcher and index.html must be in the same folder, or outputs must be next to the launcher.
pause

