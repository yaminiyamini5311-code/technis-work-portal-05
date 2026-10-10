@echo off
echo ============================================
echo GitHub Push Helper
echo ============================================
echo.
echo Please enter your GitHub Personal Access Token
echo (If you don't have one, create it at: https://github.com/settings/tokens)
echo Required scope: repo (Full control of private repositories)
echo.
set /p TOKEN="Enter your token: "
echo.
echo Pushing to repository...
git push https://%TOKEN%@github.com/techinsportal/Techins_portal.git main
echo.
if %ERRORLEVEL% EQU 0 (
    echo ============================================
    echo SUCCESS! Code pushed to GitHub successfully!
    echo ============================================
    echo Repository: https://github.com/techinsportal/Techins_portal
) else (
    echo ============================================
    echo FAILED! Please check your token and permissions
    echo ============================================
)
echo.
pause
