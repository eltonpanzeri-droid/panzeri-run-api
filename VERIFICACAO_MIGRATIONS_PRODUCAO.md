# Verificação do histórico de migrations em produção (somente leitura)

> Preparado em 10/10/2026 (correção pós-revisão do Astra, item 4). **Nada foi executado em produção.** Nenhuma migration antiga foi alterada. A consulta abaixo é exclusivamente de leitura e precisa ser executada por Elton (ou por quem ele autorizar) com acesso ao banco.

## Por que isto importa
A migration `20260916164659_add_data_layer_phase_0` (0916) teve uma versão original (commit `617788a`, que falha ao rodar depois da `20260915120000` por recriar a coluna `firstPaidAt`) e uma corrigida (`db3bb6c`). Mais quatro migrations antigas também tiveram o arquivo editado depois de criado (tabelas abaixo). O Prisma grava, em `_prisma_migrations.checksum`, o **sha256 completo do arquivo no momento em que aplicou**; comparar esse valor com cada versão do arquivo no git diz **exatamente qual versão rodou em produção**, sem tocar em nada.

## Passo a passo
1. **Gerar o arquivo com o histórico (somente leitura).** A sessão é forçada a somente-leitura, então nem um erro de digitação consegue escrever:

```bash
PGOPTIONS="-c default_transaction_read_only=on" psql "<URL de produção>" -X -t -A -f apps/api/scripts/verify-migrations-production.sql -o migrations-producao.json
```

   Alternativa sem psql local: abrir o console do banco no EasyPanel, executar o conteúdo de `apps/api/scripts/verify-migrations-production.sql` e salvar a saída (um JSON) como `migrations-producao.json`.

2. **Comparar offline com o repositório** (não se conecta a banco algum; lê só o git local; leva cerca de 1 minuto):

```bash
node apps/api/scripts/verify-migration-checksums.cjs migrations-producao.json
```

3. **Ler o resultado:**

| Status | Significado | Ação |
|---|---|---|
| `IGUAL` / `IGUAL_FIM_DE_LINHA_DIFERENTE` | O arquivo atual é o que rodou (a segunda só difere em CRLF×LF, mesmo SQL). | Nenhuma. |
| `VERSAO_ANTIGA_APLICADA` | Produção rodou uma versão anterior do arquivo (o verificador diz qual commit). | **Decidir antes do deploy**: comparar o schema real do banco com o esperado; corrigir por migration NOVA se preciso. Nunca editar a antiga. |
| `CHECKSUM_DESCONHECIDO` | Nenhuma versão do git bate: arquivo alterado fora do git ou aplicado à mão. | Investigar antes do deploy. |
| `NAO_EXISTE_NO_REPOSITORIO` | Migration aplicada em produção que o repositório não tem. | Investigar antes do deploy. |
| `NAO_APLICADA_NO_BANCO` | Esperado para as duas migrations novas (`20261009120000_prescription_trace`, `20261010120000_prescription_trace_hardening`) e qualquer outra ainda não publicada. | Conferir que só as esperadas aparecem. |
| flag `NAO_CONCLUIDA` / `REVERTIDA` | A migration falhou ou foi revertida (`finished_at` vazio / `rolled_back_at` preenchido). | **Bloqueia o deploy** até resolver. |

O código de saída é 0 só quando tudo bate com o arquivo atual.

## Migrations com mais de uma versão no histórico (cinco)
Valores calculados do próprio git (blob); o verificador usa estes mesmos hashes. "(atual)" é o arquivo hoje no repositório.

### 20260705120000_add_onboarding_interview
| Versão (commit, data) | Assunto | sha256 completo |
|---|---|---|
| 71b4e229, 2026-09-17 (**atual**) | fix(admin): barra percorrido empilhada com extra… | `df2509634d2c372ca3968c6b297db8f8559e5709940b18e74861022b8157a251` |
| 9c47ab83, 2026-09-17 | Update migration.sql | `672e021f10489f8784eea6b3d11cda34d4785ee54af1171122d87182172a4a44` |
| b0336799, 2026-07-05 | Criar entrevista guiada no onboarding | `df2509634d2c372ca3968c6b297db8f8559e5709940b18e74861022b8157a251` |

### 20260710120000_add_coupons_and_coach_reports
| Versão (commit, data) | Assunto | sha256 completo |
|---|---|---|
| 8b63e664, 2026-07-10 (**atual**) | Resolver migracao travada de cupons | `b40c6776ab762a9283e28c32026c2c865b58af7e7bdcad2571b872fc93e7f818` |
| b5a9bef1, 2026-07-10 | Corrigir deploy da API e adicionar painel de cupons financeiro | `54e77cea9155eea18eadd62ca8be0b2a8d88c062f912140074ef4fc1c41530e2` |

### 20260729160000_add_strava_analysis_cache
| Versão (commit, data) | Assunto | sha256 completo |
|---|---|---|
| 83df4160, 2026-07-29 (**atual**) | legenda skip 1,2 3 | `8b455e17f4b105f5aed13a7abe11eb9e5435123154d080d4f945a5a751dbdbe6` |
| bf4d7f8e, 2026-07-29 | alterações da estrutura da alteração dos treinos | `b394f5e3a46856a000a92ab0e4613aadef658164d31241319b12400115e55bd1` |
| 16e77b66, 2026-07-29 | não gerar nova semana automática | `8b455e17f4b105f5aed13a7abe11eb9e5435123154d080d4f945a5a751dbdbe6` |

### 20260916164659_add_data_layer_phase_0
| Versão (commit, data) | Assunto | sha256 completo |
|---|---|---|
| db3bb6c3, 2026-09-16 (**atual**) | fix: restaura recordFirstViewed, FunnelEvent.journeyId e corrige migration Fase 0 | `eb6fe9f70f80f86c2ab9f03e2f37d67d2ee74f1560fe9f4078337c6fd051d37a` |
| 617788a6, 2026-09-16 | f | `8410d1da7eb4c57e51eb309623ee75a96fe85869aaf375120dd94c5785792390` |

### 20261002120000_add_workout_delivery
| Versão (commit, data) | Assunto | sha256 completo |
|---|---|---|
| 889ff32a, 2026-10-07 (**atual**) | Corrige drift de WorkoutDelivery com migration para deliveredAt e canceledAt | `ae9d32f4db611518ec831684bb672103eebe82fcb085963222d4739362bb8ab3` |
| b3ebfffc, 2026-10-02 | Adicionar delivered_to_device e canceled ao lifecycle de WorkoutDelivery | `31a5cd123c175cd2742cc3631a5560c2534cc5344100bea6e13b6d64e1334de0` |
| 5c53a1b2, 2026-10-02 | Criar fundação canônica de WorkoutDelivery, agnóstica de provedor | `ae9d32f4db611518ec831684bb672103eebe82fcb085963222d4739362bb8ab3` |

Observação: em três casos a versão atual é **idêntica** a uma versão antiga (onboarding = original; strava = a mais antiga; workout_delivery = a original); a edição do meio foi desfeita depois. Se produção aplicou a versão do meio, o verificador acusa `VERSAO_ANTIGA_APLICADA`.

## O que foi provado localmente (PostgreSQL 17 de teste, dados sintéticos)
- As 90 migrations (incluindo as duas novas desta etapa) aplicam do zero em banco vazio, todas concluídas, sem divergência nova entre migrations e `schema.prisma`.
- A consulta gera o JSON esperado e roda com a sessão em somente-leitura.
- O verificador, alimentado com um histórico **simulado** (0916 original aplicada, um checksum inventado, uma migration só de produção e uma não concluída), classifica corretamente cada caso e sai com código 1. Alimentado com o histórico do banco de teste, só aponta diferenças de fim de linha do Windows (uma migration tem fim de linha misto no checkout local; no git/Docker ela é LF e bate).
- Os hashes completos acima foram confirmados contra o checksum que o Prisma realmente grava (sha256 dos bytes do arquivo).

## Limites
- Só Elton consegue rodar a consulta em produção; o resultado real continua **desconhecido** até lá.
- Este material não decide o que fazer em caso de divergência; ele diz **qual** versão rodou. A decisão (migration corretiva) é um passo separado, com aprovação.
