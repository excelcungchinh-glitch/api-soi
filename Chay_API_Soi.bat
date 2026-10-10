@echo off
chcp 65001 >nul
title API Soi - dong cua so nay de tat tool
cd /d "%~dp0"
where node >nul 2>nul || (echo Chua cai Node.js. Tai tai https://nodejs.org roi chay lai. & pause & exit /b)
node server.js
pause
