@echo off
setlocal
rem Abre o painel admin a partir DESTE repositorio (a copia canonica, com todas as abas, inclusive "Atividades externas").
rem A pasta antiga "Aplicativo Panzeri Run" foi descontinuada (02/10/2026): o painel aberto de la' e' uma copia velha e
rem NAO tem a aba "Atividades externas" — foi isso que fazia a aba "sumir".
set "ROOT=%~dp0"
cd /d "%ROOT%"

findstr /C:"atividadesExternas" "apps\admin\app\page.tsx" >nul 2>&1
if errorlevel 1 (
  echo ERRO: este codigo do painel nao tem a aba "Atividades externas" — pasta/versao errada.
  echo Pasta: %ROOT%
  pause
  exit /b 1
)

where pnpm >nul 2>&1
if errorlevel 1 (
  echo ERRO: pnpm nao encontrado no PATH.
  pause
  exit /b 1
)

echo Painel admin Panzeri Run - pasta: %ROOT%
echo Endereco: http://127.0.0.1:3000
echo IMPORTANTE: mantenha esta janela aberta.
echo.
call pnpm --dir apps/admin dev --hostname 127.0.0.1 --port 3000
echo.
echo O servidor fechou.
pause
