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
