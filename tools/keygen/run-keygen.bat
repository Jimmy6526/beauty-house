@echo off
chcp 65001 >nul
title Nova Beauty - License Generator
cd /d "%~dp0"
start "" http://127.0.0.1:47199
node keygen.js ui
pause
