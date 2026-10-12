# Validar a exclusão de conta no iPhone (somente conta de teste)

Este roteiro roda a API **real** (login, regras de exclusão, limite de tentativas) contra o **PostgreSQL local de teste**
e mostra o app no Safari do iPhone. **Nada de produção é tocado**:

- o banco precisa ser local e terminar em `_test` (a API recusa subir se não for);
- o Asaas e o R2 (tombstone) são **simulados** — nenhuma cobrança, cancelamento ou arquivo real;
- não há `.env` no clone, então e-mail, Telegram, IA e Meta ficam desligados.

Use **somente** uma conta criada por você neste ambiente local (ex.: `teste.exclusao1@example.com`). Nunca use sua conta real.

## Cenários (variável `CENARIO`)
| CENARIO | O que simula |
|---|---|
| `sem-assinatura` | sem cobrança recorrente: exclusão direta |
| `asaas-ativa` | assinatura Asaas ativa; "cancelar junto" funciona |
| `asaas-ativa-cancelamento-falha` | assinatura ativa; o cancelamento FALHA (conta deve ficar intacta) |
| `asaas-suspensa-com-cobranca` | assinatura suspensa no Asaas, mas com cobrança já emitida em aberto (a tela deve avisar que continua válida) |
| `asaas-indisponivel` | Asaas fora do ar (situação desconhecida) |
| `asaas-cancelada` | assinatura já cancelada |
| `loja` | assinatura pela loja (Google Play) |

## Passos (PowerShell, a partir de `C:\Users\elton\OneDrive\Documentos\GitHub\panzeri-run-api`)

1. Subir o PostgreSQL de teste (conforme `apps/api/test/integration/README.md`; ajuste `$bin` e `$data`) e aplicar as migrations uma vez:
   ```powershell
   $bin = "C:\pg17\pgsql\bin"; $data = "C:\pg17\data"
   & "$bin\pg_ctl.exe" -D $data -o "-p 55432 -c listen_addresses=127.0.0.1" -l "C:\pg17\pg.log" -w start
   $env:DATABASE_URL = "postgresql://postgres@127.0.0.1:55432/panzeri_test"; cd apps\api; npx prisma migrate deploy; cd ..\..
   ```
2. Subir a API local de teste num terminal (troque o cenário quando quiser; é preciso reiniciar para trocar):
   ```powershell
   $env:TEST_DATABASE_URL = "postgresql://postgres@127.0.0.1:55432/panzeri_test"; $env:CENARIO = "asaas-ativa"; cd apps\api; npx ts-node --transpile-only test\manual\exclusao-iphone-api.ts
   ```
3. Em **outro** terminal, gerar o app web (leva ~2 minutos) e servir na rede local:
   ```powershell
   cd apps\mobile; $env:CI = "1"; npx expo export --platform web --output-dir dist; cd ..\..
   node tools\validacao-exclusao-iphone\servidor-web.cjs apps\mobile\dist 8099 3333
   ```
4. Descobrir o IP do computador e, se o Windows perguntar, permitir o Node na rede **privada**:
   ```powershell
   ipconfig | findstr IPv4
   ```
5. No **iPhone** (mesmo Wi-Fi do computador), abra no Safari `http://<IP-do-computador>:8099`, toque em **Criar conta** com um e-mail de teste e entre.
   Vá em **menu → Privacidade e dados**, role até **Excluir minha conta**.

## O que conferir em cada cenário
- **Todos:** texto "O que será excluído / O que permanece"; botão "Excluir definitivamente" desabilitado até ter senha **e** a frase `EXCLUIR CONTA`; senha errada mostra "Senha incorreta" e **não** desloga; botão "Cancelar e manter minha conta".
- `asaas-suspensa-com-cobranca`: o aviso deve dizer que **ainda há cobranças já emitidas pendentes ou vencidas**, que segundo o Asaas cancelar a assinatura as remove e que, sem cancelar, **continuam válidas**.
- `asaas-ativa`: aviso destacado de que excluir **não cancela** a cobrança; botão "Ver e cancelar minha assinatura antes"; duas opções. Escolhendo **"sem cancelar"** aparece um aceite em destaque ("as cobranças poderão continuar mesmo sem acesso ao aplicativo…") e o botão só habilita depois de marcá-lo.
- `asaas-ativa-cancelamento-falha`: escolha "Cancelar minha assinatura…" → mensagem de que a conta **NÃO foi excluída**; a conta continua funcionando (faça login de novo para provar).
- `asaas-indisponivel`: aviso "não conseguimos confirmar… tratamos como possivelmente ativa"; mesma escolha obrigatória.
- `loja`: passos para cancelar no Google Play + link; é preciso marcar o aceite para prosseguir.
- `sem-assinatura` / `asaas-cancelada`: exclusão direta, sem escolha.
- **Sucesso:** aparece "Conta excluída", o app volta para a tela de login e tentar entrar de novo com o mesmo e-mail falha.

## Encerrar
Feche os dois terminais (Ctrl+C) e pare o banco:
```powershell
& "$bin\pg_ctl.exe" -D $data stop -m fast
```
Apague `apps\mobile\dist` se quiser (a pasta já é ignorada pelo Git).

## Limites desta validação
- Valida a **interface web (PWA no Safari)**, que é o que as alunas de iPhone usam hoje. O app **nativo** iOS usa a mesma tela, mas só pode ser testado com uma compilação instalada (TestFlight) apontando para uma API com esta mudança publicada.
- Asaas e R2 são simulados: a integração real com o Asaas só será exercitada depois do deploy, com a assinatura de uma conta de teste sua no ambiente do Asaas (nunca de aluna real).
