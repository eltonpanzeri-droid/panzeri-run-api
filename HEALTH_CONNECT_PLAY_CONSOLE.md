# Health Connect — texto para o formulário de declaração da Play Console (22/10/2026)

Preencher em **Play Console → Política do app → Apps de saúde → Health Connect**, marcando **somente leitura** (nenhuma escrita) para os tipos abaixo. A justificativa é a mesma base: *"O Panzeri Run é um aplicativo de acompanhamento e prescrição de treinos de corrida. Com autorização expressa da aluna, por categoria, lê o dado indicado para acompanhar a evolução, comparar o treino planejado com o realizado, entender a recuperação e personalizar o treinamento. O dado não é usado para publicidade."*

| Permissão (Health Connect) | Para que o app usa |
|---|---|
| READ_EXERCISE, READ_DISTANCE, READ_SPEED | Sessões de exercício (tipo, horário, duração, distância e velocidade) para comparar com o treino prescrito |
| READ_HEART_RATE, READ_POWER, READ_STEPS (cadência), READ_ELEVATION_GAINED | Intensidade do esforço durante o exercício (FC, potência, cadência, elevação) |
| READ_ACTIVE_CALORIES_BURNED, READ_TOTAL_CALORIES_BURNED | Gasto energético do exercício e do dia |
| READ_STEPS | Passos do dia (carga diária) |
| READ_SLEEP | Sono e recuperação para ajustar a carga de treino |
| READ_RESTING_HEART_RATE, READ_HEART_RATE_VARIABILITY | Indicadores de recuperação |
| READ_VO2_MAX | Capacidade aeróbica ao longo do tempo |
| READ_WEIGHT, READ_BODY_FAT, READ_LEAN_BODY_MASS, READ_BONE_MASS, READ_BODY_WATER_MASS | Composição corporal (acompanhamento de evolução) |
| READ_OXYGEN_SATURATION, READ_RESPIRATORY_RATE | Indicadores de recuperação |
| READ_NUTRITION, READ_HYDRATION | Nutrição e hidratação que a aluna já registra em outro aplicativo |
| READ_HEALTH_DATA_HISTORY | Importar, se a aluna autorizar, dados anteriores aos últimos 30 dias |

**Build 13 (22/10/2026) — acrescentar ao formulário:**

| Permissão / uso | Texto para colar |
|---|---|
| `READ_HEALTH_DATA_IN_BACKGROUND` | `Optional: lets the app read the data the athlete has already authorized while the app is closed (periodic background sync), so training and recovery data reach the coach without the athlete having to open the app. The athlete grants this in a separate Android prompt and can turn it off in the app at any time. The app checks the athlete's per-category consent on our server on every background run.` |
| Percurso GPS (leitura de `ExerciseRoute` pela confirmação por exercício do Android, sob `READ_EXERCISE`) | Acrescente à justificativa de `READ_EXERCISE`: `When the athlete authorizes the "GPS route" group and confirms access in Android for a specific exercise, the app also reads that exercise's route to show where the run happened. Routes are never sent to third parties or to AI.` |

**Continua FORA do formulário:** qualquer permissão de **escrita**. O app só lê.

Confira também: Política de Privacidade (seção 5) atualizada e publicada; declaração de segurança de dados da Play (dados de saúde e condicionamento coletados, criptografados em trânsito, exclusão a pedido).

## Versão 1.0.3 (03/11/2026) — o Google recusou a versão 15; REMOVER da declaração e do manifesto

Recusa de 2/11/2026: "Acesso excessivo a dados (escopo mínimo)" e "login da declaração inválido". Decisão de Elton: tirar as permissões abaixo e manter VO₂ máx.

| Permissão a REMOVER | Estado no app 1.0.3 |
|---|---|
| `READ_TOTAL_CALORIES_BURNED` | fora do `app.json` e de `categories.ts` |
| `READ_OXYGEN_SATURATION` | idem |
| `READ_RESPIRATORY_RATE` | idem |
| `READ_NUTRITION` e `READ_HYDRATION` | idem (mesmo grupo no app: saem juntas) |

Continuam: exercício, distância, velocidade, FC, potência, passos/cadência, elevação, calorias ativas, sono, FC de repouso, HRV, VO₂ máx, histórico e segundo plano. **Ciclo menstrual NÃO é pedido no Android.** Depois de subir o build novo: apagar as linhas removidas do formulário, conferir o login (conta com acesso e dados nas telas de saúde; nunca colar a credencial em arquivo do repositório) e reenviar.
