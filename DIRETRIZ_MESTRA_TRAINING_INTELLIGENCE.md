# Diretriz Mestra do Panzeri Run

**Training Intelligence, arquitetura longitudinal e sistemas complexos**

> Documento-bússola para desenvolvimento, arquitetura, análise e tomada de decisão técnica.
>
> Recebido de Elton em 25/09/2026 como referência de longo prazo. Deve ser usado pelo Claude como
> referência quando houver dúvida de arquitetura, nomenclatura, prioridade, desenho de dados,
> dashboard, análise, IA ou implementação. **Pergunta de desempate**: a decisão preserva e aumenta
> nossa capacidade de entender longitudinalmente como cada atleta funciona, como responde ao
> treinamento, como muda ao longo do tempo e como devemos usar esse conhecimento para orientar a
> próxima prescrição?
>
> Este é um documento de **visão**, não um plano de sprint. Elton pediu explicitamente: "podemos
> fazer ajustes e melhorias nisso com o tempo, mas é bem para esse lado que desejo." Funcionalidades,
> dashboards, agentes e modelos podem mudar — a arquitetura deve continuar servindo a esse propósito
> (seção 17).

---

## 1. Visão central

O Panzeri Run deve evoluir de um aplicativo que prescreve e registra treinos para um sistema
longitudinal de Training Intelligence. Cada atleta deve ser tratado como um sistema adaptativo
complexo, com história própria, baselines dinâmicos, relações entre variáveis, respostas
dependentes do estado atual e trajetórias que mudam com o tempo.

O ativo principal não é um gráfico, um score ou uma resposta isolada. É a sequência temporal
completa: estado anterior, estímulo prescrito, execução observada, resposta percebida e observada,
recuperação, novo estado e próxima decisão.

```
PRESCREVER → EXECUTAR → OBSERVAR → ATUALIZAR O ESTADO → PRESCREVER
```

## 2. Princípios que não devem ser quebrados

- **História antes de fotografia** — um valor atual só ganha significado quando comparado ao
  histórico do próprio atleta.
- **Indivíduo antes da média populacional** — a população gera hipóteses; o modelo individual
  verifica se elas se aplicam àquela pessoa.
- **Dado bruto é preservado** — nunca substituir o registro original por médias, índices ou
  interpretações. Derivados são camadas adicionais.
- **Tempo e ordem são parte do dado** — preservar quando aconteceu, o que veio antes, o que veio
  depois e a defasagem entre eventos.
- **Estado condiciona resposta** — o mesmo estímulo pode produzir respostas diferentes conforme
  sono, fadiga, estresse, motivação, carga recente, dor e história.
- **Percepção e observação são complementares** — subjetivo não significa falso; objetivo não
  significa verdade absoluta. O valor está no cruzamento longitudinal.
- **5 não significa universalmente bom** — a escala representa magnitude ou sentido do construto.
  Fadiga 5 é alta; motivação 5 é alta; execução 3 pode ser exatamente o prescrito.
- **Ausência de dado não é zero** — distinguir sem dados, não rastreado, indisponível e valor zero.
- **Associação não é causalidade** — relações descobertas devem carregar incerteza, n, consistência
  e janela temporal.
- **Semântica canônica** — antes de criar estrutura nova, procurar duplicidades, nomes diferentes
  para o mesmo conceito, regras conflitantes e implementações sobrepostas.
- **Training Intelligence e Customer Intelligence são diferentes** — podem usar os mesmos eventos,
  mas interpretação técnica do atleta e interpretação comercial devem permanecer separadas.

## 3. Arquitetura mental do produto: o Explorer

A interface deve seguir uma lógica de exploração progressiva, semelhante à navegação por pastas:
visão geral → domínio → variável → período → observação → sessão original. O usuário não precisa
receber tudo aberto. A informação deve existir, ser pesquisável e ser aberta conforme a investigação.

```
PANZERI RUN
|
+-- 01. VISAO GERAL
|   +-- Alunos
|   +-- Treinamento
|   +-- Estado dos alunos
|   +-- Resposta ao treinamento
|   +-- Saude / Dor
|   +-- Resultados
|   +-- Negocio
|
+-- 02. POPULACAO
|   +-- Treinamento
|   |   +-- Volume
|   |   +-- Frequencia
|   |   +-- Intensidade
|   |   +-- Ritmo
|   |   +-- Carga
|   +-- Feedback por treino
|   +-- Sono
|   +-- Prontidao
|   +-- Resposta ao treino
|   +-- Feedback semanal
|   +-- Aderencia
|   +-- Dor
|   +-- Performance
|   +-- Avaliacoes / Reavaliacoes
|   +-- Evolucao
|
+-- 03. ALUNOS
|   +-- [ALUNO]
|       +-- Visao geral
|       +-- Treinamento
|       +-- Feedback por treino
|       +-- Feedback semanal
|       +-- Sono
|       +-- Prontidao
|       +-- Resposta ao treino
|       +-- Dor
|       +-- Performance
|       +-- Avaliacoes
|       +-- Linha do tempo
|       +-- Sistema Complexo Individual
|
+-- 04. RESULTADOS DO METODO
|   +-- Aderencia
|   +-- Consistencia
|   +-- Performance
|   +-- Capacidade de treinamento
|   +-- Sono
|   +-- Prontidao
|   +-- Motivacao / estado percebido
|   +-- Dor limitante
|   +-- Retencao
|   +-- Evolucao longitudinal
|
+-- 05. EXPLORADOR DE DADOS
|   +-- Populacao
|   +-- Periodo
|   +-- Variaveis
|   +-- Filtros
|   +-- Agrupamentos
|   +-- Comparacoes
|   +-- Sobreposicoes
|   +-- Associacoes
|   +-- Drill-down
|
+-- 06. SISTEMAS COMPLEXOS
    +-- Estado atual
    +-- Baselines individuais
    +-- Rede individual
    +-- Relacoes temporais
    +-- Estados recorrentes
    +-- Transicoes de estado
    +-- Resposta aos estimulos
    +-- Perturbacoes
    +-- Recuperacao
    +-- Adaptabilidade
    +-- Estabilidade
    +-- Sensibilidade
    +-- Hipoteses individuais
```

## 4. Inventário mínimo de dados longitudinais

### 4.1 Treinamento e execução

- Sessões prescritas, realizadas, perdidas, sem registro e extras.
- Modalidade, tipo de estímulo, data, duração, distância, pace/velocidade, estrutura da sessão e
  prescrição.
- Km prescritos e realizados por sessão, semana, mês e períodos personalizados.
- Volume médio, frequência, intensidade, RPE, carga e aderência.
- Diferença prescrito × realizado, inclusive execução parcial e treino extra.
- Resultados de provas, testes, PRs e esforços comparáveis.

### 4.2 Feedback de cada treino

> Nota do Claude (25/09/2026): esta lista bate quase 1:1 com o feedback individual v2 (16
> perguntas) já implementado — ver `GLOSSARIO_METRICAS.md`.

1. Qualidade do sono.
2. Duração aproximada do sono.
3. Irregularidade do horário de sono em relação ao habitual.
4. Interrupção/fragmentação do sono.
5. Dificuldade para adormecer.
6. Cansaço físico antes do treino.
7. Cansaço mental antes do treino.
8. Estresse recente.
9. Vontade de treinar antes de começar.
10. Percepção geral de esforço (RPE 1–10).
11. Avaliação da elaboração do treino.
12. Execução percebida em relação ao prescrito.
13. Cansaço físico provocado pelo treino.
14. Cansaço mental provocado pelo treino.
15. Experiência emocional/afeto durante o treino.
16. Mudança do estado mental pré → pós.

Dor/desconforto: presença, intensidade, localização, momento, observação e impacto sobre a
execução. Observação livre/comentário do aluno.

### 4.3 Feedback semanal

> Nota do Claude (25/09/2026): bate com o check-in semanal v3 (9 perguntas) já implementado.

- Avaliação dos treinos propostos considerando histórico, evolução e feedbacks.
- Adequação percebida dos treinos ao que o aluno precisava naquele momento.
- Satisfação com a própria execução da semana.
- Exigência da semana comparada a uma semana normal.
- Resposta corporal comparada ao normal individual.
- Vontade de continuar treinando.
- Interferência esperada da rotina e compromissos da próxima semana.
- Preferência para a próxima semana: seguir planejamento, mais leve, avançar, mais recuperação ou
  considerar prova/evento.
- Campo livre para algo importante não perguntado.

### 4.4 Avaliações e contexto

- Avaliação inicial e reavaliações periódicas, preservando versão, data e respostas originais.
- Objetivo, prova-alvo, fase do treinamento, rotina, disponibilidade e histórico.
- Dor, intercorrências e diagnósticos quando informados, sem transformar dor automaticamente em
  lesão.
- Contexto menstrual quando aplicável e voluntariamente informado: menstruação, regularidade,
  contraceptivo, sintomas e associações individuais observadas. Nunca usar fase genérica como regra
  determinística.
- Integrações e dados observados de GPS/Strava ou outras fontes, quando disponíveis.

## 5. Camada matemática comum

Dashboard, Explorador de Dados e agentes devem consumir a mesma camada matemática e semântica.
Nenhuma fórmula relevante deve existir de um jeito no gráfico e de outro no prompt.

- Valor bruto/observações individuais.
- Média aritmética do período selecionado.
- Média móvel curta.
- Média móvel média/intermediária.
- Média móvel longa.
- Média móvel ponderada quando definida para o caso.
- Baseline individual dinâmico.
- Desvio absoluto e relativo do baseline.
- Inclinação/tendência.
- Persistência do desvio.
- Variabilidade e faixa habitual individual.
- Número de observações e completude.
- Tempo desde o último dado.
- Mudança absoluta e relativa entre avaliações.
- Agregação por sessão, dia, semana, mês, ano e janelas personalizadas.

Período exibido e janela de cálculo são conceitos diferentes. Exemplo: o usuário pode visualizar os
últimos 90 dias e manter uma média móvel longa calculada com 200 dias de histórico anterior. O
recorte visual nunca deve destruir o histórico necessário ao cálculo.

## 6. Explorador universal de métricas

Qualquer folha numérica da árvore deve, quando fizer sentido, abrir um explorador padronizado. O
objetivo é evitar dashboards rígidos e permitir investigação progressiva.

```
METRICA: [variavel selecionada]

PERIODO
[7d] [semana] [4 semanas] [mes] [3m] [6m] [ano] [tudo] [personalizado]

AGRUPAMENTO
[sessao] [dia] [semana] [mes]

CAMADAS VISUAIS
[ ] observacoes individuais
[ ] media aritmetica
[ ] media movel curta
[ ] media movel media
[ ] media movel longa
[ ] baseline/faixa habitual
[ ] eventos relevantes

JANELAS
curta: [configuravel]
media: [configuravel]
longa: [configuravel]

CRUZAR COM
[+ qualquer variavel compativel]

ABRIR
populacao -> aluno -> periodo -> sessao -> registro original
```

## 7. Sistemas complexos: o diferencial estratégico

O Panzeri Run deve modelar o atleta como um sistema dinâmico e adaptativo. Variáveis não devem ser
tratadas apenas como causas isoladas. O interesse é entender configurações do sistema, interações,
dependência da história, não linearidade, defasagens temporais, transições e recuperação.

### 7.1 Estado do sistema

Em cada momento, o atleta ocupa um estado composto por múltiplas dimensões: sono, fadiga física,
fadiga mental, estresse, motivação, carga recente, aderência, dor, resposta aos estímulos e
contexto. O mesmo valor isolado pode ter significado diferente conforme a configuração do restante
do sistema.

### 7.2 Estados recorrentes e regimes

Com dados suficientes, investigar se o indivíduo apresenta configurações recorrentes:
recuperado/motivado, cansado mas responsivo, estressado com pior sono, fadiga acumulada com queda
de execução etc. Esses estados devem emergir dos dados quando possível, em vez de serem impostos
por categorias arbitrárias.

### 7.3 Transições

Registrar e estudar como o atleta passa de um estado para outro. A trajetória importa. Dois atletas
podem chegar a um estado semelhante por caminhos diferentes e, por isso, exigir interpretações
diferentes.

### 7.4 Dependência do estado

O efeito de um estímulo depende do estado em que o sistema o recebe. 50 km semanais não são um
estímulo equivalente em qualquer contexto. Sono, fadiga, estresse, carga anterior, dor, motivação e
histórico podem modificar a resposta.

### 7.5 Relações temporais e defasagens

O sistema deve permitir investigar relações no mesmo momento e com atraso: sono(t) × RPE(t),
sono(t-1) × RPE(t), volume dos últimos 7 dias × fadiga atual, estresse atual × sono seguinte, fadiga
atual × execução futura etc. A defasagem deve fazer parte da relação, não ser perdida na agregação.

### 7.6 Perturbação, recuperação e adaptabilidade

Quando uma perturbação desloca o atleta do padrão individual, observar magnitude, quantidade de
dimensões deslocadas, duração, velocidade de retorno e estado subsequente. A capacidade de retornar
ou reorganizar-se após carga, estresse, sono ruim ou outro evento pode formar uma assinatura
individual de estabilidade/adaptabilidade, sem transformá-la prematuramente em diagnóstico clínico.

### 7.7 Adaptação

A evolução pode aparecer como mudança da resposta ao mesmo estímulo. Um treino semelhante pode,
meses depois, produzir menor RPE, menor fadiga, recuperação mais rápida ou melhor execução. Isso
permite medir adaptação além de pace e resultados de prova.

## 8. Panzeri Individual System Model

```
INDIVIDUAL SYSTEM MODEL
|
+-- Baselines
|   +-- curto
|   +-- medio
|   +-- longo
|
+-- Estado atual
+-- Estados recorrentes
+-- Rede individual
|   +-- nos
|   +-- conexoes
|   +-- intensidade
|   +-- direcao temporal
|   +-- defasagem
|   +-- estabilidade
|
+-- Resposta aos estimulos
|   +-- leve
|   +-- longo
|   +-- limiar
|   +-- intervalado
|   +-- VO2
|   +-- forca
|
+-- Transicoes
+-- Perturbacoes
+-- Recuperacao
+-- Adaptabilidade
+-- Estabilidade
+-- Sensibilidade
|
+-- Hipoteses individuais
    +-- evidencia
    +-- n de episodios
    +-- magnitude
    +-- consistencia
    +-- janela temporal
    +-- confianca
    +-- ultima atualizacao
```

## 9. Rede individual e hipóteses

As conexões de uma rede individual devem representar relações observadas no atleta, e não apenas
relações fisiologicamente plausíveis. Cada relação deve carregar direção temporal quando disponível,
magnitude, janela/lag, n de observações, consistência e incerteza.

Exemplos de hipóteses (ilustrativos, não regras):
- Queda persistente do sono parece anteceder aumento de RPE em 1–2 dias.
- Longos acima de determinado contexto de carga parecem aumentar fadiga física por cerca de 48h sem
  queda de motivação.
- Aumento de volume é bem tolerado quando sono permanece próximo do baseline individual.
- Estresse elevado combinado a sono abaixo do baseline costuma anteceder pior execução.

Essas afirmações devem ser armazenadas como **hipóteses atualizáveis**, nunca como verdades eternas.
Com novos dados, a hipótese pode fortalecer, enfraquecer, permanecer incerta ou deixar de aparecer.

## 10. Modelo populacional e modelo individual

O Panzeri Run deve trabalhar em dois níveis. O modelo populacional identifica padrões que aparecem
em grupos e gera hipóteses. O modelo individual pergunta se aquele padrão ocorre naquele atleta, em
quais condições e com qual magnitude. O caminho inverso também importa: um padrão descoberto em um
indivíduo pode ser procurado em outros atletas para verificar em quais perfis aparece.

## 11. O que o agente de prescrição deve receber

O agente não deve receber centenas de respostas brutas em toda geração. O backend/Training
Intelligence deve fazer matemática, agregação, comparação e detecção de sinais de forma
determinística e barata. A IA recebe um **Athlete State Snapshot** compacto, preservando
componentes suficientes para raciocinar.

```
ATHLETE STATE SNAPSHOT

goal
phase
days_to_event

training
  weekly_volume
  adherence
  volume_trend
  recent_session_types

current_state
  sleep
  physical_fatigue
  mental_fatigue
  stress
  motivation
  pain

for each relevant variable
  current
  period_mean
  short_mean
  medium_mean
  long_mean
  deviation_from_long
  slope
  persistence
  n
  completeness/confidence

response_by_stimulus
  easy
  long
  threshold
  interval
  strength

system_dynamics
  current_regime/state
  displaced_variables
  recovery_speed
  stability/adaptability signals

individual_patterns
  relation
  lag
  magnitude
  confidence

alerts/signals
context
constraints
evolution_report
```

A IA interpreta. Ela não deve ser forçada por regras simplistas como "fadiga > 3,5 = reduzir carga".
O sistema fornece estado, tendências, relações e evidência; o agente combina isso com objetivo,
fase, metodologia, histórico e contexto.

## 12. Qualidade e confiança do dado

Toda métrica derivada relevante deve carregar metadados de confiança. Um valor baseado em 2
observações não deve parecer epistemicamente equivalente ao mesmo valor baseado em 30 observações.

- n de observações;
- percentual de completude;
- tempo desde o último dado;
- versão do instrumento/pergunta;
- período efetivamente coberto;
- dados faltantes;
- confiança da tendência/relação;
- fonte do dado;
- eventuais mudanças de semântica.

## 13. Resultados do método Panzeri

A mesma arquitetura deve permitir demonstrar longitudinalmente resultados do método. As métricas
precisam ser definidas antes de serem usadas comercial ou cientificamente.

- Aderência e consistência ao longo do tempo.
- Performance em provas, testes e esforços comparáveis.
- Capacidade de treinamento: maior carga/volume tolerado com resposta igual ou melhor.
- Mudança da resposta a estímulos semelhantes.
- Sono e estado percebido em relação ao baseline.
- Prontidão e estabilidade longitudinal.
- Frequência de dor, recorrência e dor limitante.
- Retenção e continuidade do treinamento.
- Evolução entre avaliação inicial e reavaliações.
- Proporção de atletas que melhoram, mantêm ou pioram em cada domínio, com critérios transparentes.

Evitar alegações causais indevidas. Evolução observada em alunos acompanhados é evidência
longitudinal do produto, mas não equivale automaticamente a prova causal de que o método produziu
toda a mudança.

## 14. Reavaliação e escala temporal

O sistema deve combinar diferentes resoluções temporais: sessão para microestado, semana para
contexto recente e reavaliações periódicas para trajetória estrutural. A reavaliação deve comparar a
trajetória completa, não apenas o último par de avaliações.

O Evolution Report deve ser gerado quando uma reavaliação válida é concluída, persistido e
reutilizado. O agente de prescrição recebe duas escalas: Athlete State Snapshot para "como está
agora" e Evolution Report para "como mudou ao longo dos meses".

## 15. Regras para decisões futuras de desenvolvimento

- Antes de criar tabela, campo, endpoint, score ou gráfico, auditar se o conceito já existe.
- Antes de ampliar, consolidar semântica e escolher fonte canônica.
- Preservar compatibilidade e versionamento de perguntas antigas.
- Nunca sobrescrever histórico para fazer o dado novo parecer uniforme.
- Toda métrica do dashboard deve ter definição, fórmula, fonte, período, inclusão, exclusão e
  tratamento de ausência.
- Qualquer score composto deve ser explicável por seus componentes.
- Médias móveis, baselines, tendências e sinais devem ser calculados fora do LLM.
- O dashboard humano, o Explorador e os agentes devem consumir a mesma camada semântica/matemática.
- O drill-down deve permitir voltar do agregado ao aluno e, quando aplicável, à sessão/registro
  original.
- Não adicionar gráfico apenas porque é visualmente interessante. Cada visualização deve responder
  uma pergunta operacional ou investigativa.
- O sistema deve continuar útil mesmo sem IA; IA adiciona interpretação, síntese e decisão
  contextual.
- Preservar performance e escalabilidade: séries longas e cruzamentos não podem depender de
  carregar todo o histórico no frontend.

## 16. Pergunta de desempate para o Claudinho

Quando houver duas implementações tecnicamente possíveis, preferir aquela que preserva melhor a
história temporal, a semântica canônica, a comparabilidade longitudinal e a capacidade futura de
descobrir como aquele atleta funciona como sistema.

Se uma solução deixa a tela mais bonita, mas destrói contexto histórico, mistura conceitos ou
dificulta análises futuras, ela está na direção errada. Se uma solução preserva o dado bruto,
organiza relações temporais, permite drill-down, mantém componentes transparentes e alimenta uma
camada comum de Training Intelligence, ela está alinhada à visão.

## 17. Norte final

O objetivo final do Panzeri Run é aprender longitudinalmente a dinâmica particular de cada atleta e
usar esse conhecimento como contexto para a próxima decisão de treinamento.

O sistema deve conseguir responder, progressivamente: Como este atleta costuma ser? Como está agora?
O que mudou? O que normalmente antecede essa mudança? Como ele responde a diferentes estímulos
quando está em diferentes estados? Quanto demora para se recuperar? Quais padrões são estáveis?
Quais estão mudando? Quais hipóteses individuais estão ganhando ou perdendo suporte? E, diante
disso, qual prescrição faz mais sentido agora?

Essa visão deve funcionar como bússola. Funcionalidades, dashboards, agentes e modelos podem mudar.
A arquitetura deve continuar servindo a esse propósito.

---

## Nota de sequenciamento (Claude, 25/09/2026)

Opinião registrada ao receber este documento: é uma visão tecnicamente sólida e já alinhada com o
que vinha sendo construído (feedback v2, check-in v3, `feedbackVersion`/`checkinVersion`,
`GLOSSARIO_METRICAS.md`). É também um sistema de nível de pesquisa — meses/anos de trabalho, não uma
feature. Sequência recomendada quando isso virar trabalho concreto:

1. Coleta e semântica canônica — em andamento.
2. Camada matemática comum (seção 5): médias móveis, baseline individual, desvio, tendência,
   metadados de confiança. Reutilizável e valioso mesmo com poucos dados, desde que sinalize baixa
   confiança quando `n` for pequeno.
3. Athlete State Snapshot (seção 11) — viável logo após a camada matemática existir.
4. Sistemas complexos de verdade (seções 7-10: rede individual, regimes, hipóteses) — adiar até
   haver volume real de histórico por aluno. Tentar isso cedo demais (poucos alunos, poucas semanas)
   tende a produzir "descobertas" espúrias que parecem inteligentes mas são ruído estatístico.
