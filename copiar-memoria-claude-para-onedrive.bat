@echo off
setlocal
rem Copia para uma pasta de BACKUP no OneDrive tudo o que o GitHub NAO guarda:
rem   1) a MEMORIA do Claude (decisoes e licoes do projeto) - fica fora do OneDrive e do GitHub;
rem   2) a pasta "Documentacao Garmin" (material licenciado; o Git ignora de proposito).
rem So' COPIA e atualiza: nunca apaga nada no destino (sem /MIR e sem /PURGE). Pode rodar quantas vezes quiser; rode ao final de cada semana de trabalho.
set "RAIZ=%~dp0"
set "MEMORIA=%USERPROFILE%\.claude\projects\C--Users-elton-OneDrive-Documentos-Aplicativo-Panzeri-Run\memory"
if defined OneDrive (set "BASE=%OneDrive%") else (set "BASE=%USERPROFILE%\OneDrive")
set "DESTINO=%BASE%\Documentos\Backup-Panzeri-Run"
set "FALHOU=0"

echo.
echo === 1) Memoria do Claude ===
if exist "%MEMORIA%" (
  robocopy "%MEMORIA%" "%DESTINO%\Memoria-Claude" /E /XO /R:1 /W:1 /NFL /NDL /NP /NJH
  if errorlevel 8 set "FALHOU=1"
) else (
  echo ERRO: nao encontrei a pasta de memoria do Claude: %MEMORIA%
  set "FALHOU=1"
)

echo.
echo === 2) Documentacao Garmin ===
set "GARMIN_ENCONTRADA="
for /d %%D in ("%RAIZ%Documenta*Garmin") do set "GARMIN_ENCONTRADA=%%D"
if defined GARMIN_ENCONTRADA (
  robocopy "%GARMIN_ENCONTRADA%" "%DESTINO%\Documentacao-Garmin" /E /XO /R:1 /W:1 /NFL /NDL /NP /NJH
  if errorlevel 8 set "FALHOU=1"
) else (
  echo ERRO: nao encontrei a pasta Documentacao Garmin ao lado deste arquivo.
  set "FALHOU=1"
)

echo.
if "%FALHOU%"=="1" (
  echo ATENCAO: alguma copia teve erro. Avise o Claude.
  pause
  exit /b 1
)
echo Pronto. Tudo foi copiado para:
echo %DESTINO%
echo Essa pasta fica no OneDrive e sobe para a nuvem sozinha.
pause
exit /b 0
