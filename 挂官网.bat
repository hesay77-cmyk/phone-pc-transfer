@echo off
chcp 65001 >nul
cd /d "%~dp0"
"C:\Program Files\Git\bin\bash.exe" -c "sh scripts/deploy-site.sh 2>&1 | tee deploy-log.txt"
echo.
echo 好了，回到 Claude 说一声「好了」就行。
pause
