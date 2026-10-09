# Testes de integração (PostgreSQL 17 local, dados sintéticos)

Rodam **só** com um PostgreSQL local de teste e **nunca** contra produção: `pg-guard.ts` recusa qualquer `TEST_DATABASE_URL` cujo host não seja
loopback ou cujo banco não termine em `_test`. Ficam fora da suíte padrão (`npm test`); rodam por `npm run test:integration`.

## Preparar (uma vez)
1. Baixar os binários portáteis oficiais do PostgreSQL 17 para Windows (EnterpriseDB — o mesmo link da página oficial de downloads do
   postgresql.org): `postgresql-17.11-5-windows-x64-binaries.zip` (~364 MB). Extrair numa pasta qualquer (ex.: `C:\pg17`).
2. Criar e subir um cluster descartável (porta 55432, só em 127.0.0.1):
   ```powershell
   $bin = "C:\pg17\pgsql\bin"; $data = "C:\pg17\data"
   & "$bin\initdb.exe" -D $data -U postgres -A trust -E UTF8 --locale=C
   & "$bin\pg_ctl.exe" -D $data -o "-p 55432 -c listen_addresses=127.0.0.1" -l "C:\pg17\pg.log" -w start
   & "$bin\psql.exe" -h 127.0.0.1 -p 55432 -U postgres -d postgres -c "create database panzeri_test" -c "create database panzeri_restore_test"
   ```
3. Aplicar TODAS as migrations nesse banco (nunca em outro):
   ```powershell
   $env:DATABASE_URL = "postgresql://postgres@127.0.0.1:55432/panzeri_test"
   cd apps/api; npx prisma migrate deploy
   ```

## Rodar
```powershell
$env:TEST_DATABASE_URL = "postgresql://postgres@127.0.0.1:55432/panzeri_test"
$env:TEST_PG_BIN = "C:\pg17\pgsql\bin"
npm run test:integration
```

## O que cobrem
- `environment-and-migrations`: travas do ambiente, PostgreSQL 17, cadeia completa de migrations, divergências conhecidas entre migrations e
  `schema.prisma` (só as já documentadas) e a evidência do incidente da migration `20260916164659`.
- `backup-restore`: `pg_dump` real + `pg_restore` real + fail-closed das integrações + reaplicação de tombstones, em outro banco.
- `prescription-trace`: rastreabilidade (Etapa 1.2a) ponta a ponta — geração semanal, regeneração de um dia, atomicidade, retenção,
  exclusão de dados de provedor × desconexão e exclusão de conta.
- `app-boot`: a API sobe com o grafo real de módulos.

Parar o cluster: `pg_ctl -D <data> stop`. Apagar a pasta `data` descarta tudo.
