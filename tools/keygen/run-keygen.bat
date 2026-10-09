@echo off
chcp 65001 >nul
title Nova Al-Jamal - License Generator
cd /d "%~dp0"
start "" http://127.0.0.1:5199
node keygen.js ui
pause
