@echo off
rem Builds NovaService.exe (Windows service host) and NovaUser.exe (per-user host, no admin needed)
rem with the C# compiler that ships with every Windows (no extra tools needed).
setlocal
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist stage mkdir stage
"%CSC%" /nologo /target:exe /optimize+ /out:stage\NovaService.exe /reference:System.ServiceProcess.dll service\NovaService.cs
if errorlevel 1 (echo BUILD FAILED & exit /b 1)
"%CSC%" /nologo /target:winexe /optimize+ /define:USERMODE /out:stage\NovaUser.exe /reference:System.ServiceProcess.dll service\NovaService.cs
if errorlevel 1 (echo BUILD FAILED & exit /b 1)
echo Built stage\NovaService.exe and stage\NovaUser.exe
