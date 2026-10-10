@echo off
chcp 65001 >nul
rem ===== Nova Al-Jamal: build the customer installer =====
setlocal
cd /d "%~dp0\.."

echo [1/5] Generating brand art...
node tools\build\make-art.js || goto :fail

echo [2/5] Building the Windows service host...
pushd installer
call .\build-service.bat || (popd & goto :fail)
popd

echo [3/5] Staging files (no data, no private keys)...
node installer\stage.js || goto :fail

echo [4/5] Locating Inno Setup...
set ISCC=
for %%P in ("%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" "%ProgramFiles%\Inno Setup 6\ISCC.exe" "%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe") do if exist %%P set ISCC=%%~P
if not defined ISCC (
  echo.
  echo Inno Setup 6 is not installed. Install it free from https://jrsoftware.org/isdl.php then run this file again.
  goto :fail
)

echo [5/5] Compiling the installer...
"%ISCC%" installer\nova.iss || goto :fail

echo.
echo DONE: installer\output\NovaAlJamal-Setup-*.exe
exit /b 0
:fail
echo.
echo BUILD FAILED
exit /b 1
