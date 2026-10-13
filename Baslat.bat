@echo off
rem Deniz Seviyesi Simulatoru - yerel sunucuyu baslatir ve tarayiciyi acar (Windows).
rem Python 3 gerekir. Diger sistemlerde: python3 serve.py
set "APPDIR=%~dp0"
where pythonw >nul 2>nul && (start "" pythonw "%APPDIR%serve.py" 8770 & goto :eof)
if exist "%LOCALAPPDATA%\Programs\Python\Python312\pythonw.exe" (start "" "%LOCALAPPDATA%\Programs\Python\Python312\pythonw.exe" "%APPDIR%serve.py" 8770 & goto :eof)
start "" python "%APPDIR%serve.py" 8770
