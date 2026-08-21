# Proposta: Harness de agentes do Panzeri Run (revisor + Hipótese de Trabalho)

**Status: discussão em andamento, NADA disso foi implementado ainda.** Este documento existe pra
essa conversa sobreviver entre sessões — retomar aqui quando o treinador voltar ao assunto.

Discutido em 21/08/2026, a partir de uma pergunta do treinador sobre harness engineering (o LLM é
o motor, o harness é o carro) e uma preocupação central: nenhum agente deveria interpretar, decidir
e validar a própria decisão ao mesmo tempo.

## Como começou

O treinador pediu uma auditoria crítica da arquitetura de agentes já existente (agente de
prescrição, Gerente Técnico, agente de análise do Strava, prontuário do aluno) sob a ótica de
harness engineering — antes de propor qualquer mudança.

## O que já existe e está bem construído (confirmado no código)

- **Prontuário do aluno** (`StudentProfileService`, `apps/api/src/training-plans/student-profile.service.ts`)
  já é memória hierárquica bem feita: eventos gravados por código puro (zero custo), resumo só
  reprocessado quando há novidade real acumulada, regra explícita de nunca apagar fato antigo (só
  compactar com o tempo).
- **Cache de prompt** já implementado nos 7 pontos de chamada de IA.
- **Regras determinísticas já estão nos lugares certos**: cooldowns, elegibilidade de geração,
  limites de tentativa — tudo código puro. Única exceção numérica: piso de 8:30/km (decisão
  consciente do treinador, não acidente).
- **Reparo isolado** no agente de prescrição (refaz só o dia que falhou tecnicamente, não a semana
  inteira) já é uma miniatura do loop verificar→corrigir.
- **Gerente Técnico** (`technical-manager-agent.service.ts`) já tem engenharia madura de tool-use:
  nunca confia em `tool_use` parcial, exige confirmação explícita do treinador antes de salvar
  diretriz permanente, regra de consolidação pra nunca ter duas diretrizes conflitantes ativas ao
  mesmo tempo sobre o mesmo assunto.

## A fragilidade real identificada

O agente de prescrição (`PrescriptionAgentService`) interpreta, decide e se autovalida na mesma
chamada. O Zod garante estrutura (campos certos, tipos certos), nunca qualidade ou fidelidade à
metodologia real do treinador. Não existe segunda opinião hoje.

## Peça nova proposta: a "Hipótese de Trabalho"

Diferente do prontuário (fato acumulado — o que aconteceu), essa seria a **interpretação**: quem é
essa pessoa, o que ela quer, o que ela realmente consegue hoje, se está conseguindo aplicar o que
consegue, como está a sequência dela, o que ajuda ou atrapalha — o mesmo raciocínio que o treinador
já faz mentalmente toda vez que monta uma planilha, só que registrado e revisável. Comparável à
distinção real de prontuário clínico entre fato (subjetivo/objetivo) e avaliação/plano.

### Conteúdo (rascunho, precisa aprofundar a parte de riscos)

- Quem é essa pessoa (perfil resumido)
- O que ela quer (objetivo declarado + o que isso exige de verdade)
- O que ela consegue hoje (capacidade real demonstrada)
- O gap entre os dois
- Rotina e limitações práticas reais
- Riscos e cuidados (**seção ainda rasa — depende em parte da pergunta final da entrevista, ainda
  não fechada**)
- Direção inicial e por quê
- Nível de confiança da leitura (baixa/média/alta)
- O que confirmaria ou derrubaria essa leitura

### Cadência de revisão

Não todo dia (caro à toa). Reaproveitar a mesma regra já provada no prontuário: só reprocessa
(chama IA) quando há evidência nova de verdade acumulada desde a última vez, checado antes de cada
geração de treino. Sem evidência nova, zero custo extra.

### A correção mais importante da discussão

Risco real identificado pelo treinador: se o revisor tratar essa hipótese como especificação a
cumprir, reprova qualquer desvio legítimo — e treinador bom desvia do plano o tempo todo, com
razão. Metáfora que resolveu isso: **dois profissionais experientes conversando entre si**, não um
fiscal de checklist. Regra de dois lados, ambos tratados como erro:

1. Desviar da hipótese sem motivo real visível na evidência.
2. Seguir a hipótese à risca ignorando evidência nova clara que já devia ter mudado o plano.

O revisor avalia o raciocínio, nunca a obediência.

## Achados concretos na entrevista atual do app (prontos pra corrigir quando o treinador quiser)

1. `important_injury` (App.tsx) não pergunta há quanto tempo a pessoa está recuperada — trata
   "recuperado há 3 semanas" igual a "recuperado há 5 anos". Sugestão: pergunta de follow-up "há
   quanto tempo você está sem sintomas dessa lesão?" quando a resposta não for "Nunca.".
2. `longest_distance` e `weekly_running_km` têm piso de 1km na roda de resposta (`wheelMin: 1`) —
   quem não consegue correr nem 1km contínuo não tem como expressar isso.
3. `training_consistency` (ótima pergunta, com a opção "Sempre começo e abandono") está classificada
   sob o módulo "Treinamento de força" — pode fazer a IA subestimar o peso dela pra decisões de
   corrida, mesmo sendo genérica sobre frequência de treino.

Ponto positivo confirmado: `running_experience` já é uma pergunta muito bem desenhada — cobre
inclusive "tentei mas nunca consegui manter rotina", exatamente o tipo de sinal que o treinador
queria garantir que fosse capturado.

## Em aberto, ainda não fechado

- **Pergunta final da entrevista sobre "postura de risco"** (quanto a aluna quer ser desafiada vs.
  protegida, independente do nível técnico dela) — ainda em rascunho, o treinador pediu pra entender
  melhor antes de finalizar a redação/opções. Objetivo explícito: a pergunta deve fazer a aluna
  sentir "nossa, ele quer mesmo fazer um treino especial pra mim", não parecer um formulário de
  responsabilidade genérico.
- **A profundidade da seção de riscos** na Hipótese de Trabalho — depende em parte dessa mesma
  pergunta final.
- **Onde tecnicamente a Hipótese de Trabalho seria gerada/armazenada** — ainda não desenhado (novo
  modelo Prisma? Campo em `StudentProfile`? Documento separado?).
- **Onde o revisor se encaixaria no fluxo** — antes de salvar o plano gerado? Com que ação em caso
  de reprovação (retry automático limitado, ou só avisar o treinador como o `checkPlanFreshness` já
  faz)?

## Achado paralelo, sobre o harness de desenvolvimento (como as sessões de IA trabalham no projeto)

Falha real, não implementada ainda: arquivos que só existiam no espelho do GitHub e nunca na pasta
de origem nem no script de sincronização causaram 3 quebras de build reais em 20-21/08
(`DEPLOY_APP_ALUNO.md`, `Dockerfile` da raiz, `tsconfig.build.json`). Proposta: um diff
determinístico (sem IA) entre a pasta de origem e o espelho, rodado antes de cada sincronização —
ainda não implementado.

## Nota de correção registrada durante a discussão

Foi citado "geração em massa às 19h de domingo" como risco de escala futuro — informação errada em
dois níveis: o horário real de liberação é meio-dia (`WEEKLY_RELEASE_HOUR = 12`), e mais importante,
esse mecanismo de geração em massa sincronizada nem existe mais no sistema (virou geração sob
demanda, por aluno). Lição registrada: sempre verificar o código atual antes de afirmar qualquer
fato operacional do sistema numa discussão real, nunca confiar em memória de sessões anteriores.
