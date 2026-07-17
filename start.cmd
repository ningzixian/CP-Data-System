@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

REM ========================================
REM   智问模块 - 启动模式选择
REM ========================================
REM   [1] 开发模式 (dev)        - 端口 5173，带热更新
REM   [2] 生产预览 (preview)   - 端口 8080，基于 dist/
REM ========================================

:menu
cls
echo ========================================
echo    智问模块 - 启动模式选择
echo ========================================
echo.
echo   [1] 开发模式 (dev)
echo       端口 5173 - 改代码自动热更新
echo.
echo   [2] 生产预览 (preview)
echo       端口 8080 - 基于 dist/ 静态资源
echo.
echo   [3] 一键 build（生成生产产物）
echo.
echo   [Q] 退出
echo.
echo ========================================
echo.

set /p choice=请输入选择 (1/2/3/Q):

if /i "%choice%"=="1" goto dev
if /i "%choice%"=="2" goto prod
if /i "%choice%"=="3" goto build
if /i "%choice%"=="q" exit /b
if /i "%choice%"=="Q" exit /b
echo.
echo 无效选择: "%choice%"
timeout /t 2 > nul
goto menu

:dev
cls
cd /d "%~dp0frontend"
echo ========================================
echo   [dev] 启动 Vite 开发服务器
echo   访问地址: http://localhost:5173
echo   局域网内: http://本机IP:5173
echo   按 Ctrl+C 停止
echo ========================================
echo.
call "node_modules\.bin\vite.cmd" --host 0.0.0.0 --port 5173
goto end

:prod
cls
cd /d "%~dp0frontend"
echo ========================================
echo   [prod] 启动生产预览
echo ========================================
echo.

REM 检查 dist 是否存在，不存在就自动 build
if not exist "dist\index.html" (
  echo [提示] 还没 build，先自动 build...
  echo.
  call "node_modules\.bin\vite.cmd" build
  if errorlevel 1 (
    echo.
    echo [错误] build 失败
    pause
    goto menu
  )
  echo.
)

echo 访问地址: http://localhost:8080
echo 局域网内: http://本机IP:8080
echo 按 Ctrl+C 停止
echo.
call "node_modules\.bin\vite.cmd" preview --host 0.0.0.0 --port 8080
goto end

:build
cls
cd /d "%~dp0frontend"
echo ========================================
echo   [build] 生成生产产物
echo ========================================
echo.
call "node_modules\.bin\vite.cmd" build
if errorlevel 1 (
  echo.
  echo [错误] build 失败
) else (
  echo.
  echo [完成] 产物在 frontend\dist\
)
echo.
pause
goto menu

:end
echo.
echo 服务已停止
pause
