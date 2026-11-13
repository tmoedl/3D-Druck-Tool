@echo off
rem Startet den STL-Farbeditor unter Windows (Doppelklick). Gegenstueck zu start.sh.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if errorlevel 1 pause
