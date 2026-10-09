@echo off
rem Builds LicenseTool.exe (native launcher with the key icon) using the csc.exe that ships with Windows
cd /d "%~dp0"
set "CSC=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%SystemRoot%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
"%CSC%" /nologo /target:winexe /optimize+ /codepage:65001 /win32icon:keygen.ico /out:LicenseTool.exe /r:System.Windows.Forms.dll LicenseTool.cs
exit /b %errorlevel%
