# Play Console — justificativas do Health Connect (rascunho de 31/10/2026)

> Texto para colar no formulário "Aplicativos de saúde / Health Connect" da Play Console (o formulário é em inglês).
> Base: `apps/mobile/app.json` (18 permissões de leitura, todas `READ_*`), consentimento do Health Connect v1.3 e as telas do app. Conferido contra o código em 31/10/2026.
> **Antes de enviar:** o build Android novo precisa conter as telas descritas (tela "Minha recuperação" e potência/elevação no detalhe do treino). Quem confere e envia é o Elton.
> **Conferir na tela antes de enviar:** os nomes de telas/campos desta tabela foram conferidos no código (`activityDetail.tsx`, `recovery-summary.ts`), mas confirme no app instalado que cada dado aparece com a conta de teste.
> **Honestidade obrigatória:** cada item abaixo só afirma o que o código FAZ hoje. Itens com ressalva estão marcados com ⚠.

## Texto geral (campo "How does your app use Health Connect data?")

Panzeri Run is a running-coaching app. A student's coach prescribes a weekly running programme; the app compares what was prescribed with what the student actually did, and shows the student how they are recovering. The app only READS data from Health Connect, only the data categories the student explicitly authorizes inside the app (each category has its own checkbox and can be withdrawn at any time), and shows the student what it collected. Data is never sold, never used for advertising, and never shared with third parties except the processors needed to run the service (hosting and, only if the student separately authorizes it, an AI provider). Use and transfer of information received from Health Connect adheres to the Health Connect Permissions policy, including the Limited Use requirements.

## Por permissão

| Permissão | Para que serve | Onde o aluno VÊ |
|---|---|---|
| `READ_EXERCISE` | Importar as sessões de corrida/caminhada/força para compará-las com o treino prescrito. | Lista e detalhe da atividade (treinos realizados). |
| `READ_DISTANCE` | Distância percorrida de cada sessão e do dia. | Detalhe da atividade (distância). |
| `READ_SPEED` | Ritmo/velocidade da sessão, comparado com o ritmo prescrito. | Detalhe da atividade (ritmo). |
| `READ_HEART_RATE` | FC média/máxima da sessão para avaliar a intensidade real do treino. | Detalhe da atividade ("FC média … (máx …)"). |
| `READ_POWER` | Potência média/máxima da sessão (quando o relógio mede). | Detalhe da atividade ("Potência média"). |
| `READ_ELEVATION_GAINED` | Ganho de elevação do treino. | Detalhe da atividade ("Ganho de elevação"). |
| `READ_STEPS` | Passos do dia e cadência da sessão. | Tela "Minha recuperação" (passos) e detalhe ("Cadência média"). |
| `READ_ACTIVE_CALORIES_BURNED` | Calorias ativas do DIA. | Tela "Minha recuperação" ("Calorias ativas do dia"). ⚠ Calorias POR TREINO não são exibidas hoje. |
| `READ_SLEEP` | Duração do sono para acompanhar a recuperação. | Tela "Minha recuperação" ("Sono"). |
| `READ_RESTING_HEART_RATE` | FC de repouso como indicador de recuperação, comparada ao histórico da própria aluna. | Tela "Minha recuperação". |
| `READ_HEART_RATE_VARIABILITY` | HRV como indicador de recuperação, comparada ao histórico da própria aluna (nunca a uma média populacional). | Tela "Minha recuperação". |
| `READ_VO2_MAX` | VO₂ máx. medido pelo relógio como referência de condicionamento. | Tela "Minha recuperação" ("VO₂ máximo"). |
| `READ_OXYGEN_SATURATION` | SpO₂ como indicador de saúde/recuperação. | Tela "Minha recuperação". |
| `READ_RESPIRATORY_RATE` | Frequência respiratória como indicador de recuperação. | Tela "Minha recuperação". |
| `READ_NUTRITION` | Energia consumida no dia, para contextualizar a recuperação. | Tela "Minha recuperação" ("Energia consumida"). |
| `READ_HYDRATION` | Hidratação do dia, para contextualizar a recuperação. | Tela "Minha recuperação" ("Hidratação"). |
| `READ_HEALTH_DATA_HISTORY` | Importar o histórico anterior aos últimos 30 dias, SOMENTE se a aluna marcar a opção específica de importação do histórico (ela pode retirar). Serve para o coach conhecer a evolução prévia da aluna. | Opção "Autorizo a importação dos meus dados anteriores…" no consentimento. |
| `READ_HEALTH_DATA_IN_BACKGROUND` | Sincronizar treinos novos com o app fechado, para o coach e a aluna verem o treino do dia sem precisar abrir o app. Só roda se a aluna ligar a opção no cartão do Health Connect; pode desligar a qualquer momento. | Botão ligar/desligar no cartão do Health Connect; treino aparece na lista sem abrir manualmente a sincronização. |

## Itens que NÃO são pedidos (removidos em 30/10/2026)
Composição corporal (peso, gordura, massa magra, massa óssea, água corporal) e calorias totais: removidos por decisão do Elton após a rejeição de "acesso mínimo". Percurso GPS (`READ_EXERCISE_ROUTES`) e temperatura da pele não estão no `app.json` desta versão.

## Pontos que o revisor costuma verificar
- **Conta de teste:** o revisor deve ver os dados na tela. Sem relógio, as telas mostram um estado vazio explicativo (nada é estimado). Recomenda-se um vídeo curto de demonstração mostrando: conectar → marcar categorias → treino importado → "Minha recuperação" com dados.
- **Retirada:** a aluna retira cada categoria em Dispositivos e integrações > Health Connect; os novos dados daquela categoria deixam de ser guardados e ela pode pedir a exclusão dos importados.
- **Política de privacidade:** `/politica-privacidade` (seção 5B traz a declaração de Uso Limitado). **Texto em revisão por advogado** (pendência ativa).
- **Samsung:** a Samsung só sincroniza com o Health Connect parte desses tipos (sem HRV, FC de repouso, respiração, cadência, elevação, hidratação e calorias ativas). Isso não muda a justificativa (os tipos servem para outros relógios), mas explica telas vazias para quem usa Galaxy Watch.

## Atualização de 31/10/2026 (decisões de Elton)
- **Nutrição e hidratação FICAM** (impactam desempenho, percepção de esforço, FC e lesões; entram nos indicadores da IA com autorização separada). Marcar "Controle de nutrição e peso" na etapa 1. O app NÃO prescreve dieta.
- **Calorias totais VOLTAM** (`READ_TOTAL_CALORIES_BURNED`): gasto energético total do dia para acompanhar disponibilidade energética / REDs (Mountjoy et al., Br J Sports Med 2023;57(17):1073-1097, doi:10.1136/bjsports-2023-106994). Agora há cartão "Gasto energético total do dia" em "Minha recuperação" e calorias por treino no detalhe (ativas; senão totais do exercício). Texto de justificativa: ver a conversa de 31/10 (menciona o artigo, o cartão, que o app NÃO diagnostica REDs e que a IA só atua com autorização separada).
- **Composição corporal (peso, gordura, massa magra/óssea/água) continua REMOVIDA.** Sem ela a análise de REDs aponta indícios, não mede.
- **Textos finais colados na Play Console em 31/10/2026** (aluna vê cada dado no app; "sem fins de diagnóstico médico"; IA externa só com autorização separada). Conferir com a conta de teste no app instalado antes de enviar para revisão.
- **Dados que o aparelho não envia:** a tela "Minha recuperação" lista "Dados que não chegaram" e, para Samsung, diz que é o aparelho/app da Samsung que não envia (HRV, FC de repouso, respiração, hidratação, calorias ativas e gasto total do dia); o detalhe do treino avisa quando a Samsung não envia cadência e ganho de elevação.
