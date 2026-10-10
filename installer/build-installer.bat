@echo off
chcp 65001 >nul
rem ===== Nova Al-Jamal: build the customer installer (custom WPF installer, no external tools needed) =====
setlocal
cd /d "%~dp0\.."

set FW=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319
if not exist "%FW%\csc.exe" set FW=%WINDIR%\Microsoft.NET\Framework\v4.0.30319
set REFS=/r:"%FW%\WPF\PresentationFramework.dll" /r:"%FW%\WPF\PresentationCore.dll" /r:"%FW%\WPF\WindowsBase.dll" /r:"%FW%\System.Xaml.dll" /r:System.IO.Compression.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll
set RES=/resource:installer\assets\fonts\Cairo-Regular.ttf,Cairo-Regular.ttf /resource:installer\assets\fonts\Cairo-Bold.ttf,Cairo-Bold.ttf /resource:public\img\nova-icon-256.png,logo.png /resource:installer\EULA.txt,eula.txt
set FLAGS=/nologo /target:winexe /optimize+ /codepage:65001 /win32icon:installer\assets\nova.ico /win32manifest:installer\setup\app.manifest

echo [1/6] Generating brand art...
node tools\build\make-art.js || goto :fail

echo [2/6] Building the Windows service hosts...
pushd installer
call .\build-service.bat || (popd & goto :fail)
popd

echo [3/6] Staging files (no data, no private keys)...
node installer\stage.js || goto :fail

echo [4/6] Building the uninstaller...
"%FW%\csc.exe" %FLAGS% /define:UNINSTALLER /out:installer\stage\uninstall.exe %REFS% %RES% installer\setup\Setup.cs || goto :fail

echo [5/6] Packing the payload...
node installer\pack.js || goto :fail

echo [6/6] Building the installer...
"%FW%\csc.exe" %FLAGS% /out:installer\output\NovaAlJamal-Setup-1.0.0.exe %REFS% %RES% /resource:installer\output\payload.zip,payload.zip installer\setup\Setup.cs || goto :fail

echo.
echo DONE: installer\output\NovaAlJamal-Setup-1.0.0.exe
exit /b 0
:fail
echo.
echo BUILD FAILED
exit /b 1
