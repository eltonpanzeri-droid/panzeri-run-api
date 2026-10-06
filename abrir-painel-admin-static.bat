@echo off
setlocal
set "ROOT=%~dp0"
set "NODE_BIN=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"

if exist "%NODE_BIN%\node.exe" set "PATH=%NODE_BIN%;%PATH%"

rem Mesmo mecanismo do atalho antigo (build estatico + servidor estatico). A pasta e a deste repositorio canonico (%~dp0).
if exist "%ROOT%.tools\pnpm\pnpm.exe" (
  set "PNPM=%ROOT%.tools\pnpm\pnpm.exe"
) else (
  set "PNPM=pnpm"
)

cd /d "%ROOT%"
echo Abrindo painel admin Panzeri Run...
echo Pasta: %ROOT%
echo.

rem Guarda contra abrir uma copia velha do codigo, sem a aba "Atividades externas".
findstr /C:"atividadesExternas" "%ROOT%apps\admin\app\page.tsx" >nul 2>&1
if errorlevel 1 (
  echo ERRO: este codigo do painel nao tem a aba "Atividades externas" - pasta ou versao errada.
  pause
  exit /b 1
)

echo Atualizando o painel com as alteracoes mais recentes...
powershell -NoProfile -Command "Remove-Item -LiteralPath '%ROOT%apps\admin\.next' -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item -LiteralPath '%ROOT%apps\admin\.next-build' -Recurse -Force -ErrorAction SilentlyContinue"
call "%PNPM%" --dir apps/admin build
if errorlevel 1 (
  echo Nao foi possivel atualizar o painel.
  pause
  exit /b 1
)

echo.
echo Abrindo em http://127.0.0.1:3000
echo Mantenha esta janela aberta.
start "" "http://127.0.0.1:3000"
node "%ROOT%scripts\serve-static.mjs" "%ROOT%apps\admin\.next-build" 3000
pause
