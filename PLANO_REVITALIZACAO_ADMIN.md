# Plano de revitalização do painel admin — Panzeri Run

**Status:** proposed (nenhuma fase aprovada ou iniciada)
**Data:** 14/10/2026
**Autor:** Claude, a partir das decisões de Elton nesta data
**Gatilho de revisão:** ao fim de cada fase, ou se Elton mudar a direção.

Este plano é só proposta. Nada aqui foi implementado. Cada fase e cada lote exigem aprovação de Elton antes de qualquer edição. Deploy é sempre manual de Elton.

---

## 1. Objetivo

Trocar o admin atual, que cresceu por acúmulo e não por desenho, por um painel que mostre **cada dado de forma interativa e legível**, para Elton tirar as próprias conclusões. O painel não responde perguntas nem decide nada. Quem analisa é Elton, e quando quiser pode **levar os dados para fora** (outra IA, outro profissional, planilha).

**Premissa (Elton, 15/10/2026):** existe **uma única pessoa** usando o painel, Elton. Treinador, Coordenador técnico, Empresário, Financeiro e Marketing não são usuários nem permissões: são **formas diferentes de ver os mesmos dados**, conforme o "chapéu" que ele está usando. Não há controle de acesso por papel nem vários logins.

## 2. Decisões já tomadas por Elton

| Decisão | Detalhe |
|---|---|
| Painel por papéis | Não há um centro único. Cada papel tem o seu centro: Treinador, Coordenador técnico (IA), Empresário/CEO, Financeiro, Marketing. Um seletor no topo troca a visão. |
| Tema | Botão para trocar entre claro e escuro (e sistema). |
| Foco | Estética e organização, não matemática nova. Os dados já existem; falta extraí-los e mostrá-los. |
| O painel é para ver | Gráficos e dashboards interativos. Sem "Perguntar à IA" dentro do painel. |
| Exportação | Todo gráfico exporta o que está selecionado. **Sempre anônima**: identificador = código sequencial da aluna (`studentCode`), mais **idade em anos**. Sem nome, e-mail, CPF, telefone, endereço, data de nascimento exata nem texto livre identificável. Sem opção de incluir o nome. |
| Visão completa, não só alertas | Cada visão mostra quem/o que está mal, quem/o que está bem, o que está melhorando e o que pode piorar. Previsão aparece como **sinal para o julgamento dele**, com os fatos que a geraram. Sem "índice de risco" em caixa-preta. |
| Menu | Enxugar (hoje 11 itens). "Semanas" sai do menu, com cuidado para não afetar a aba Semanas anteriores dentro de cada aluna. |
| Evolução e Training Intelligence | Juntar em uma coisa só, dentro da Evolução de cada aluna. |
| Carga semanal | Informação importante: mostrar a variação semanal do volume sempre à vista, não só no mouse. A semana em andamento não pode contar como queda. |
| Acesso pelo celular | Painel online, sem precisar do terminal aberto. **É a ÚLTIMA etapa**, depois de todo o resto (decisão de Elton em 14/10/2026; substitui o desejo anterior de resolver até 18/10). |
| Exportação: campos | Entram **idade, sexo e altura**. Peso entra por decisão minha (Elton delegou o resto), arredondado ao kg. Reversível. |
| Delegação | Elton delegou ao Claude as pendências de menu, conteúdo da visão do Coordenador e limites iniciais. Ver seção 9. |

### O que fica, o que sai (a executar só na Fase 4)

**Fica:** calendário de treinos, timeline, comentários, "Dor ao longo do tempo", gráfico de volume do Intelligence, painel lateral de um dia, cartões de resumo da Evolução.
**Entra na Evolução:** conteúdo das abas Timeline e Contexto soltas.
**Sai:** "Explorar relações" (dispersão), seções antigas "Experiência com o treino" e "Estado antes dos treinos" da Evolução, Training Intelligence como ferramenta separada.
**Sai da Visão geral:** botões operacionais (gerar semana, sincronizar Asaas, backup, avisos), que vão para uma área "Ferramentas".

## 3. Diagnóstico (fatos vistos nas telas, 14/10/2026)

- **Layout:** a 100% de zoom as telas ficam grandes ou estreitas conforme a página; larguras diferentes em cada tela (Visão geral em coluna estreita, Evolução em coluna de ~390px, Alunos em tela cheia). O `styles.css` tem pelo menos um `max-width: 1120px`. Causa exata ainda não confirmada.
- **Números divergentes entre telas:** cortesia 9 contra 10, atrasadas 10 contra 12, prospectos 24 contra 26 (Visão geral contra Financeiro).
- **Funil:** "Completou entrevista 5" maior que "Iniciou entrevista 0"; "Pagou 0" com 25 pagantes; "180 abriram o app" contra "170 pessoas". Tabela de erros com nomes técnicos (`waist_circumference`).
- **Intelligence:** nomes técnicos e valores crus (`workout.painFlag`, `none`), datas como `10/14T00:00:00.000Z`.
- **Avaliação da aluna:** grade plana de rótulo e valor, sem unidades, rótulos misturando idiomas, texto cortado, 16 notas em 16 linhas, dados sensíveis (CPF, endereço) abertos.
- **Visão geral:** 9 cartões iguais sem variação; funil escondido; atalhos operacionais misturados com análise.
- **Operação:** o painel só abre com o `.bat` (`abrir-painel-admin-static.bat`) rodando um servidor local; depende do terminal aberto.

## 4. Invariantes

1. Nenhum dado de aluna é alterado, só a apresentação.
2. Rotas novas são **somente leitura**.
3. O admin atual segue funcionando até Elton aprovar o novo; voltar atrás é desligar o novo.
4. Sem fórmulas que escolham treino ou carga. O painel mostra, não decide.
5. Cada número tem definição e fonte visíveis e é o **mesmo em qualquer tela**.
6. Sinais de tendência são comparações com a **própria linha de base** da aluna, mostradas com os fatos que as geraram. Limites numéricos (por exemplo, "dias sem treinar") são definidos por Elton.
7. Dados de ciclo menstrual só aparecem para quem consentiu.
8. Funciona no celular.
9. Nenhum segredo em código, tela ou exportação.

## 5. Arquitetura da informação

**Seletor de visão (topo):** Treinador · Coordenador técnico · Empresário · Financeiro · Marketing.
**Tema (topo):** sistema · claro · escuro.
**Menu proposto (a confirmar):** Início (muda por visão) · Alunas · Dinheiro · Crescimento · IA e sistema · Ferramentas.
"Provas" deixa de ser item de menu e vira lente dentro de Alunas e do Início. "Semanas" sai do menu.

**Mapa mental de referência:** 44 lentes em 7 grupos (Aluna e saúde; Base e coortes; Dinheiro; Crescimento; Produto e tecnologia; IA e metodologia; Equipe, operação e conformidade), publicado como página em https://claude.ai/artifact/V1QYkuUs7cA42Ud6VgBJfh. Serve para decidir quais lentes viram cômodos. Não é obrigatório implementar todas.

**Padrão de cada gráfico:** filtros no topo, comparação com período anterior ou com a própria linha de base, clique para ver quem ou o que está por trás, definição da métrica ao lado e botão de exportar.

## 6. Trilha e fases

Cada fase se divide em **lotes pequenos**, cada um com aprovação própria.

**Ordem de execução:** Fase 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → **Trilha A (por último)**. Enquanto a Trilha A não for feita, o painel continua abrindo pelo `.bat` como hoje.

### Fase 0 — Fundação visual · risco MÉDIO
Largura única e densidade corrigidas, tokens de design, tema claro/escuro, seletor de visão, menu enxuto, responsivo. O painel novo convive com o atual (rota ou flag).
- **Aceitação:** a 100% de zoom todas as telas usam a mesma largura; sem rolagem horizontal no celular; tema alterna sem texto ilegível.
- **Rollback:** desativar a rota ou a flag.

### Fase 1 — Confiança nos números · só leitura (gate das fases 2, 3 e 5)
Reconciliar o que diverge entre telas, comparar eventos do funil com o banco, e produzir um **dicionário de métricas** (definição, fonte, desde quando é confiável). Resultado: documento com a lista de métricas confiáveis e não confiáveis.
- **Aceitação:** cada número exibido em qualquer tela nova aponta para uma entrada do dicionário.

### Fase 2 — Cômodos Financeiro e Empresário · risco MÉDIO
Rotas de leitura novas: vencimentos por dia (calendário dos próximos 30 dias e escolha de data), histórico diário de pagantes, receita recebida contra projetada. Listas de quem está em dia, atrasada e com cortesia, com dias de atraso. Evolução da receita e das alunas. Quem paga pela loja fica marcado à parte, sem data de vencimento inventada. Exportação anônima.
- **Aceitação:** os totais batem com o Asaas e com o banco, e a data escolhida mostra a lista de quem vence.

### Fase 3 — Cômodo Treinador I: lista de alunas e Avaliação · risco MÉDIO (dados de saúde)
Lista de alunas legível numa linha por aluna. Aba Avaliação refeita: cartão de resumo, unidades, notas em barras, histórico de provas e maiores distâncias, dados pessoais mascarados por padrão, ações delicadas ("Liberar revisão da entrevista", "Mesclar conta") em lugar próprio.

### Fase 4 — Cômodo Treinador II: Evolução única · risco ALTO (dados de saúde)
Página única com eixo de tempo compartilhado: volume prescrito e realizado em cima; sono, estresse, motivação, RPE, fadiga e dor alinhados embaixo, com cursor que atravessa tudo. Clicar num dia abre treino, feedback, comentários e dor. Variação semanal do volume à vista, com a semana em andamento tratada à parte. Incorpora Timeline e Contexto; executa a lista de remoções da seção 2. Exportação anônima de qualquer seleção. Sinais de tendência contra a própria linha de base, com os fatos à vista.
- **Processo:** Gauntlet Loop e revisão independente (saúde e dados pessoais).
- **Rollback:** a Evolução antiga e o Intelligence permanecem até a aprovação final.

> Decisão de Elton (15/10/2026): o funil serve para observar o comportamento de **quem está interessado** (abriu o app até pagar) e pertence às visões Marketing e Empresário. O acompanhamento de ativação pós-pagamento **não é importante na visão Treinador** (é uma questão de foco da visão, não de quem acessa).

### Fase 5 — Cômodo Marketing · depende da Fase 1
Funil confiável com etapas em português e lista de quem parou onde, origem e conversão, cupons e cortesias, ativação.

### Fase 6 — Cômodo Coordenador técnico (IA) · exige conversa com Elton
Geração de programas (sucesso, falha, tentativas), decisões da IA contra o executado, intervenção do treinador, reavaliações pendentes. O conteúdo exato depende de Elton.

### Fase 7 — Visão consolidada de Empresário/CEO
Resumo entre os cômodos, metas e cenários. Só depois das demais.

### Trilha A (ÚLTIMA) — Painel acessível pelo celular · risco ALTO (autenticação, dados de saúde e financeiros)
Só começa depois das fases anteriores aprovadas. Quando chegar:
- **A1 (só leitura):** como o login do admin funciona; com qual API o painel conversa; como o PWA do aluno é publicado no EasyPanel; qual endereço de produção existe, se houver.
- **A2:** plano de publicação seguindo o modelo do PWA (app separado, nginx), login só de Elton, sessão que expira, sem credencial no código.
- **A3 (aprovação explícita):** implementar e testar em ambiente local.
- **A4:** teste no celular; Elton faz o deploy no EasyPanel.
- **Aceitação:** abre no celular por HTTPS, só com login de Elton, sem terminal.
- **Rollback:** desligar o app no EasyPanel; o `.bat` continua funcionando como hoje.

## 7. Exportação anônima (regra fixa)

- Formatos: CSV/Excel do que está selecionado, imagem do gráfico, resumo em texto descrevendo dados, período e unidades.
- Identificação: `studentCode` + idade em anos + sexo + altura (cm) + peso (kg, arredondado).
- Fora do arquivo: nome, e-mail, CPF, telefone, endereço, data de nascimento exata, qualquer texto livre com risco de identificar, localização detalhada.
- Aviso na primeira exportação: o arquivo contém dado de saúde e, depois que sai do app, o controle é de Elton.
- Texto livre (comentários) só entra tratado; se não puder ser tratado, fica de fora.

## 8. Riscos

- Maior mudança do painel desde que ele existe. Sem lotes pequenos, o prazo de domingo estoura.
- Fase 4 mexe em dados de saúde e junta duas ferramentas.
- Nomes técnicos e dados crus vazam para a tela hoje; cada tela nova precisa de revisão de texto.
- Sinal de risco em cima de dado não confiável é pior que nenhum sinal; por isso a Fase 1 vem antes.
- Publicar o admin online amplia a superfície de ataque.
- A coluna "dados existem" do mapa de lentes vem do schema e não de auditoria.

## 9. Decisões delegadas por Elton e pendências (14/10/2026)

Elton delegou ao Claude o que restava. Decidi assim, tudo ajustável quando ele quiser:

1. **Menu final (6 itens):** Início (muda por visão) · Alunas · Dinheiro · Crescimento · IA e sistema · Ferramentas. Visões, com os nomes que ele usou: Treinador, Coordenador técnico, Empresário, Financeiro, Marketing.
2. **Visão do Coordenador técnico (conteúdo inicial):** geração de programas (sucesso, falha, tentativas, semanas sem programa), decisões da IA contra o executado, intervenções do treinador, reavaliações pendentes, relatos e avisos pendentes, saúde do sistema (backups, rotinas, fila), integrações. Será mostrado como protótipo no início da Fase 6 para Elton corrigir.
3. **Limites iniciais de "bem" e "mal" (provisórios, sempre visíveis e editáveis numa tela de configuração, a calibrar com casos reais):** sem treinar a partir de 10 dias = atenção, 14 dias ou mais = forte; aderência dos últimos 30 dias abaixo de 60% = atenção; atraso de pagamento de 1 dia ou mais = atenção, 7 dias ou mais = forte; tendência = fora da faixa habitual da própria aluna. A definição de cada limite aparece junto do número.
4. **Exportação:** peso entra, arredondado ao kg (Elton listou só sexo e altura; peso é decisão minha, reversível).
5. **Ordem:** a Trilha A (acesso pelo celular) é a última, por decisão dele. A Fase 0 é a primeira.
6. **Em aberto, fora da decisão dele:** revisão jurídica dos termos (pendência já registrada) antes de qualquer uso novo de dado sensível, e a confirmação exata da causa das larguras diferentes entre telas (Fase 0).

## 10. Fora de escopo

IA dentro do painel; mudanças em prescrição ou metodologia; alterações em dados de alunas; builds Android/iOS; qualquer ação em produção sem autorização explícita.
