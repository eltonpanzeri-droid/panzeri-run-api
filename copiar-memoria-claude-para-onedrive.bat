@echo off
setlocal
rem Copia a MEMORIA do Claude (decisoes e licoes do projeto) para uma pasta do OneDrive, porque a pasta de origem fica FORA do OneDrive e do GitHub.
rem So' COPIA e atualiza: nunca apaga nada no destino (sem /MIR e sem /PURGE). Pode rodar quantas vezes quiser; rode ao final de cada semana de trabalho.
set "ORIGEM=%USERPROFILE%\.claude\projects\C--Users-elton-OneDrive-Documentos-Aplicativo-Panzeri-Run\memory"
if defined OneDrive (set "BASE=%OneDrive%") else (set "BASE=%USERPROFILE%\OneDrive")
set "DESTINO=%BASE%\Documentos\Backup-Memoria-Claude"

if not exist "%ORIGEM%" (
  echo ERRO: nao encontrei a pasta de memoria do Claude:
  echo %ORIGEM%
  pause
  exit /b 1
)

echo Copiando a memoria do Claude para:
echo %DESTINO%
robocopy "%ORIGEM%" "%DESTINO%" /E /XO /R:1 /W:1 /NFL /NDL /NP
rem robocopy usa codigos 0 a 7 para "deu certo" (1 = arquivos copiados).
if errorlevel 8 (
  echo.
  echo ATENCAO: a copia teve erro. Avise o Claude.
  pause
  exit /b 1
)
echo.
echo Pronto. A pasta de destino fica no OneDrive e sobe para a nuvem sozinha.
pause
exit /b 0
