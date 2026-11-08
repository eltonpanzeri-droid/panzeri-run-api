# Inventário de segredos e configurações — Panzeri Run

> **Criado em 08/11/2026, a pedido de Elton.** Este arquivo lista **somente NOMES, finalidade e consequência de trocar**. **NUNCA escreva aqui o valor de nenhum segredo** (a pasta vai para o GitHub e para o OneDrive). Os valores ficam **só no EasyPanel** (Ambiente da API) e, para consulta humana, num gerenciador de senhas.
> Lista extraída do código em 08/11/2026 (variáveis que `apps/api/src` lê). Se uma variável nova for criada, acrescentar aqui.

## Regras
- **Segredo** = se vazar, troque. **Config** = não é segredo (liga/desliga, endereços, ids públicos).
- Trocar uma chave de **criptografia** depois que há contas conectadas invalida os tokens guardados: as alunas precisam **reconectar**.
- Trocar `JWT_*` desloga todo mundo. Perder `BACKUP_ENCRYPTION_KEY` torna as cópias de segurança ilegíveis.
- Quem decide trocar e quando é o Elton. Eu (Claude) **não digito senha em tela nem registro valor**: o servidor lê as variáveis sozinho.
- Decisão registrada em 08/11/2026: os segredos da Garmin foram expostos no chat e Elton escolheu **não trocar** (ver PRONTUARIO e a memória `garmin_secrets_exposed_decision_20261108`).

## Núcleo
| Variável | Tipo | Para que serve | Se trocar |
|---|---|---|---|
| `DATABASE_URL` | Segredo | Conexão com o banco de **produção** | Atualizar nos dois lados; nunca rodar a API local contra ele |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Segredo | Assinam o login das alunas e do painel | Todos são deslogados |
| `ADMIN_EMAILS`, `COACH_EMAILS` | Config | Quem é administrador e treinador | — |
| `APP_PUBLIC_URL`, `STUDENT_APP_URL` | Config | Endereços públicos da API e do Panzeri Run | Links antigos deixam de funcionar |
| `PANZERI_RUN_INTERNAL_TOKEN` | Segredo | Chamadas internas entre serviços | Atualizar quem chama |
| `NODE_ENV`, `PORT`, `API_PORT`, `TRUST_PROXY_HOPS`, `PGDATABASE`, `PGSSLMODE` | Config | Execução do servidor | — |

## Inteligência artificial
| Variável | Tipo | Para que serve |
|---|---|---|
| `ANTHROPIC_API_KEY` | Segredo | Todas as chamadas da IA (Atlas e agentes) |
| `CLAUDE_TOOLING_API_KEY` | Segredo | Chave de ferramentas internas |
| `AI_CONTEXT_MAX_CHARS`, `AI_TOKEN_COMPARE_MAX`, `PRESCRIPTION_TRACE_INPUT_RETENTION_MONTHS` | Config | Limites e retenção |
| `COROS_EXTERNAL_AI_ENABLED`, `ZEPP_EXTERNAL_AI_ENABLED`, `HEALTH_CONNECT_EXTERNAL_AI_ENABLED` | Config (trava) | Segunda trava: libera enviar dados do provedor à IA externa |

## Pagamento
| Variável | Tipo | Para que serve |
|---|---|---|
| `ASAAS_API_KEY` | Segredo | Cobrança pelo Asaas (**ação financeira: só o Elton age no Asaas**) |
| `ASAAS_WEBHOOK_TOKEN` | Segredo | Prova de que o aviso de pagamento veio do Asaas |
| `ASAAS_SANDBOX` | Config | Ambiente de teste do Asaas |
| `REVENUECAT_SECRET_API_KEY`, `REVENUECAT_WEBHOOK_SECRET` | Segredo | Assinaturas das lojas (Google Play e App Store) |
| `ACCESS_COUPONS` | Config | Cupons de acesso |

## E-mail, avisos e métricas
| Variável | Tipo | Para que serve |
|---|---|---|
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | Segredo | Envio de e-mails e eventos de entrega |
| `RESEND_FROM_EMAIL` | Config | Remetente dos e-mails |
| `TELEGRAM_BOT_TOKEN` | Segredo | Aviso interno ao treinador |
| `TELEGRAM_CHAT_ID` | Config | Para qual conversa vão os avisos |
| `META_ACCESS_TOKEN` | Segredo | Eventos de conversão da Meta |
| `META_PIXEL_ID`, `META_TEST_EVENT_CODE` | Config | Pixel e código de teste da Meta |

## Cópias de segurança (Cloudflare R2)
| Variável | Tipo | Para que serve | Se trocar/perder |
|---|---|---|---|
| `BACKUP_ENCRYPTION_KEY` | Segredo **crítico** | Cifra as cópias do banco antes de saírem do servidor | **Perder = não dá para restaurar nenhuma cópia.** Guardar em gerenciador de senhas |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Segredo | Acesso ao armazenamento | Novas chaves no Cloudflare |
| `R2_ACCOUNT_ID`, `R2_BUCKET` | Config | Conta e pasta das cópias | — |
| `TARGET_DATABASE_URL` | Segredo | Banco de destino ao restaurar/testar cópia | — |

## Integrações com relógios e plataformas
Cada integração tem: `*_CLIENT_ID` (config), `*_CLIENT_SECRET` (segredo), `*_REDIRECT_URI` (config), `*_TOKEN_ENCRYPTION_KEY` (**segredo, exclusiva por integração**), e portas `*_ENABLED_USER_IDS` (fail-closed: vazio = ninguém).

| Integração | Variáveis |
|---|---|
| **Garmin** (08/11/2026) | `GARMIN_CLIENT_ID`, `GARMIN_CLIENT_SECRET` (segredo), `GARMIN_REDIRECT_URI`, `GARMIN_TOKEN_ENCRYPTION_KEY` (segredo), `GARMIN_WEBHOOK_KEY` (segredo; vai dentro do endereço dos avisos de atividade, saúde e desregistro), `GARMIN_ENABLED_USER_IDS` (`*` = todas; fail-closed se vazia), `GARMIN_EXTERNAL_AI_ENABLED` (segunda trava do Atlas), `GARMIN_WORKOUT_PUBLISH_ENABLED` (liga por padrão; `false` desliga o envio de treinos) |
| **COROS** | `COROS_CLIENT_ID`, `COROS_REDIRECT_URI`, `COROS_TOKEN_ENCRYPTION_KEY`, `COROS_ENABLED_USER_IDS`, `COROS_ISSUER`, `COROS_SYNC_ENABLED`, `COROS_WORKOUT_PUBLISH_ENABLED` |
| **Zepp/Amazfit** | `ZEPP_CLIENT_ID`, `ZEPP_CLIENT_SECRET`, `ZEPP_REDIRECT_URI`, `ZEPP_TOKEN_ENCRYPTION_KEY`, `ZEPP_WEBHOOK_SECRET`, `ZEPP_ENABLED_USER_IDS`, `ZEPP_BACKFILL_ENABLED`, `ZEPP_WORKOUT_PUBLISH_ENABLED` |
| **Polar** | `POLAR_CLIENT_ID`, `POLAR_CLIENT_SECRET`, `POLAR_REDIRECT_URI`, `POLAR_TOKEN_ENCRYPTION_KEY`, `POLAR_HEALTH_ENABLED`, `POLAR_FALLBACK_INTERVAL_MINUTES`, `POLAR_PROBE_*` |
| **Wahoo** | `WAHOO_CLIENT_ID`, `WAHOO_CLIENT_SECRET`, `WAHOO_REDIRECT_URI`, `WAHOO_TOKEN_ENCRYPTION_KEY`, `WAHOO_WEBHOOK_TOKEN`, `WAHOO_ENABLED_USER_IDS`, `WAHOO_SCOPES`, `WAHOO_WEBHOOK_ENABLED`, `WAHOO_FALLBACK_*` |
| **Strava** | `STRAVA_CLIENT_ID`, `STRAVA_REDIRECT_URI`, `STRAVA_TOKEN_ENCRYPTION_KEY`, `STRAVA_WEBHOOK_VERIFY_TOKEN` |

## Outros
`PROVIDER_HUB_WORKER_ENABLED`, `PHYSICAL_TESTS_REMINDERS`, `LEGACY_ROUTINE_COMPAT` — liga/desliga (config).

## Contas externas (onde cada chave nasce)
EasyPanel (servidor) · Portal de desenvolvedores da Garmin (app `panzeri_run`) · Asaas · RevenueCat · Resend · Cloudflare (R2) · Telegram (BotFather) · Meta · Anthropic · Google Play Console · App Store Connect · Expo/EAS. Logins ficam com o Elton, em gerenciador de senhas.
