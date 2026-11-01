# Erro Persistente #0012 — "A rotina que registrei é diferente do programa que recebi" (recorrente)

**Último caso:** Duane D'Avila (Cod. 0000020), 01/11/2026 (domingo, ~16:45). Rotina no painel e no app: **Ter corrida 60, Qua fortalecimento 45, Qui corrida 45, Dom corrida 120**; Seg/Sex/Sáb sem treino. Programa da semana 02/11–08/11 (Prescrição nº 600): **Seg corrida 50 min/7 km, Qua corrida 41 min/6,5 km (tiros), Qui fortalecimento 45, Sex corrida 43 min, Dom corrida 98 min/14 km; Ter e Sáb sem treino.**
**Aberto em:** 01/11/2026. **Status:** ABERTO. Diagnóstico feito; correção NÃO aplicada, aguarda decisão de Elton (opções abaixo). Conserto só na pasta `GitHub\panzeri-run-api`.

---

## FATO / INFERÊNCIA / DESCONHECIDO

**FATO (lido no código e nas telas):**
1. O programa mostrado tem corrida em Seg e Sex e nada em Ter; a rotina atual tem o contrário. Os dias do programa NÃO são os da rotina atual.
2. A geração lê a rotina vigente (`WeeklyAvailability` via `readRoutineState`) no início e monta as sessões só a partir dos dias dela (`availableDays`; `training-plans.service.ts`, ~linhas 905–1000 e 1307). Com o código atual, um programa recém-gerado NÃO cria sessão em dia fora da rotina vigente naquele instante.
3. Desde **10/10/2026** (commit `3ea5bc8`, `AJUSTE_ROTINA_ENTREVISTA_E_RELATOS.md`): "salvar rotina nunca regenera, arquiva ou altera programa já entregue; a rotina vale na próxima geração". Desde **26/10** (`RoutineService.commit`) a gravação só dispara a PRIMEIRA geração (quem ainda não tem programa) e um Telegram ao treinador: "Os treinos já entregues NÃO mudam. Para aplicar a rotina nova, use Refazer nova semana".
4. A geração é sob demanda (aluna toca "Gerar treino" ou treinador clica "Refazer nova semana"); não há cron (decisões de 28/07 e 06/08).
5. A API calcula `needsUpdate`/`needsUpdateReason` ("A disponibilidade real do aluno mudou desde a última geração", `checkPlanFreshness` + `planMatchesRoutine`, que compara a REVISÃO da rotina gravada no programa). **Mas a tela do painel não mostra isso em lugar nenhum desde 19/10/2026**: o aviso amarelo foi retirado (`page.tsx`, comentário de 19/10, "a informação já existe em outro local") e `needsUpdate` hoje só aparece na definição de tipo, sem uso na interface.
6. Não existe aviso equivalente para a ALUNA; só a frase na confirmação de salvar ("considerada na próxima geração... treinos já recebidos não mudam"). Um aviso anterior de desvio de rotina na tela da aluna também foi removido (`b7071ea`).

> **CORREÇÃO (01/11/2026, mesma tarde):** Elton informou que a Duane NÃO mudou a rotina depois de o programa ser gerado. Isso CONTRARIA a inferência abaixo, que fica como hipótese NÃO sustentada. O que continua valendo: o código atual não deixa uma geração nova criar treino em dia fora da rotina vigente (as sessões nascem só dos dias da rotina; dias fora dela são descartados) e a geração recusa publicar se a rotina muda enquanto gera. Logo, ou a rotina lida no momento da geração era outra (por algum caminho que ainda NÃO identifiquei), ou há um defeito que não encontrei. A causa é DESCONHECIDA. Dado decisivo que falta (existe no banco, não é consultado por mim): histórico de alterações da rotina (`WeeklyRoutineChange`: quando, quem — aluna, treinador, mesclagem ou app antigo —, antes e depois) e, no programa, a hora da geração e a revisão de rotina usada (`inputSnapshot.routineRevision`).

**INFERÊNCIA (agora CONTRARIADA por Elton; manter só como hipótese):** o programa de Duane foi gerado ANTES da última gravação da rotina dela (o padrão Seg/Qua/Sex corrida + Qui fortalecimento + Dom longão parece uma rotina anterior), e como o programa é da semana seguinte e a regra de 10/10 impede a regeneração automática, ele ficou desatualizado em relação à rotina. Isso explica o sintoma sem nenhum defeito na geração.

**DESCONHECIDO (precisa de dado de produção, que não consulto):** a hora em que o programa nº 600 foi gerado e a hora em que Duane gravou a rotina. Como provar em 2 minutos: no Telegram do treinador, a mensagem "alterou a rotina de treinos" da Duane (só dispara quando ela de fato muda a rotina) tem horário; comparar com a hora de criação do programa. Se a rotina foi gravada DEPOIS do programa, a inferência está confirmada.

---

## Histórico: o mesmo sintoma, causas diferentes (por isso "sempre volta")

| Data | Caso | Causa real | Correção |
|---|---|---|---|
| 06/09 | Daniele | programa gerado ANTES de a rotina ser salva (caiu em dias fixos de reserva) | não gerar antes da rotina (`681766c`) |
| 13/09 | Tiago (#0002) | datas de dias fora da rotina enviadas à IA | `weekDates` filtrado + guarda |
| 13/09 | Lucelane (#0003) | deriva entre rotina (WA) e respostas da entrevista | retirada do back-sync; `changesWereMade` |
| 09/09 | ordem canônica | duas fontes de rotina | WA como fonte única (`4252424`) |
| 10/10 | decisão | — | "salvar rotina nunca regenera programa entregue" (`3ea5bc8`) |
| 26/10 | RoutineService | escrita concorrente/obsoleta | comando único com revisão; `planMatchesRoutine` |
| 19/10 | painel | — | aviso "plano desatualizado" retirado a pedido |
| 01/11 | Duane | programa gerado com a rotina anterior + nenhum aviso | ABERTO |

Os casos de setembro eram DEFEITOS (geração lendo fonte errada) e foram corrigidos. O caso de novembro não é defeito de geração: é consequência de uma REGRA DE PRODUTO (não regenerar) somada à REMOÇÃO do aviso. Os dois ficaram sob o mesmo rótulo "rotina diferente da prescrição".

## As pastas

- **GitHub\panzeri-run-api** (espelho, commit `23c494e` em 01/11): é a ÚNICA com `RoutineService`, `routine.rules.ts`, `routine-state.ts` e `planMatchesRoutine`. É a que vai ao ar.
- **Aplicativo Panzeri Run** (pasta antiga): repositório git PRÓPRIO, com histórico paralelo (últimos commits de 16/09: `1236ac51` Fase 0 Data Layer, `c7174dba` Fase 1 BI, `cac62075` landing — NENHUM existe no espelho) e **189 arquivos modificados sem commit**. Não tem nenhum arquivo do modelo de rotina de 26/10 (só os documentos de ordem e inventário da rotina canônica). É código ANTERIOR ao modelo atual.
- **Panzeri Run Atual:** cópia de 02/10, também anterior ao modelo atual.
- **Feedback Panzeri Run:** só imagens e vídeos de alunas; nenhum código.
- Essas pastas não causam o erro de Duane (a produção sai do GitHub), mas são um risco de processo: a sessão do Claude abre na pasta antiga e carrega o `CLAUDE.md` DESATUALIZADO dela (sem as regras de 31/10 e 01/11).

## O que fazia o erro passar despercebido (aprendizado sistêmico)

1. **Um rótulo, duas causas.** Cada "correção" tratou a causa daquele caso e fechou o rótulo; ninguém separou "geração com fonte errada" (defeito) de "programa antigo vs rotina nova" (regra de produto). Quando o segundo reapareceu, parecia o primeiro de novo.
2. **A rede de segurança foi retirada e ninguém a substituiu.** O aviso de desatualização saiu do painel em 19/10 por "já existir em outro local"; esse outro local não existe na interface. Desde então a única sinalização é o Telegram da alteração da rotina, que se perde.
3. **Os testes provam peças, não o fluxo.** Há testes de função pura e de integração do `RoutineService`, mas nenhum cenário completo "programa existe → aluna altera a rotina → o que a aluna e o treinador veem". O fluxo que a aluna vive nunca foi exercitado de ponta a ponta.
4. **Revisão de código não vê regra de produto.** "Mandar revisar o código" confere se a implementação faz o que foi decidido; a decisão de não regenerar passou a valer em 10/10 e ninguém a confrontou com a expectativa da aluna.
5. **Pastas e histórico paralelos** (acima): fonte de confusão sobre "qual é o código vigente".

## Opções de correção (decisão de Elton; nada foi alterado)

- **A (recomendada):** (i) devolver o aviso "o programa não corresponde à rotina atual" ao painel do treinador (e ao card da aluna); (ii) quando a rotina muda e já existe programa de semana que AINDA NÃO COMEÇOU e SEM nenhuma sessão executada, oferecer à aluna um botão "Gerar de novo com a minha nova rotina" (ação explícita, respeitando o limite de 2 tentativas por semana). Respeita "treinos entregues não mudam" e "nada de regeneração silenciosa".
- **B:** regenerar sozinho nesse mesmo caso (semana futura, nada executado). Mais simples para a aluna, mas é regeneração automática e gasta IA a cada edição; contraria a decisão de 10/10 e exige nova decisão explícita.
- **C:** manter como está e só melhorar o texto da confirmação. Não resolve: a aluna não lê e o treinador não é avisado.
- Em qualquer opção: teste de ponta a ponta do fluxo ("programa existe → rotina muda → aviso/oferta aparece") antes de dizer "corrigido".

## Investigação dos dois cenários (01/11/2026, só leitura de código; nada alterado)

**Cenário 1 — "o programa foi feito com a rotina antiga": como seria possível?**
- Geração: lê a rotina fresca no início e recusa publicar se ela mudar durante a geração (`assertRoutineUnchanged`). Os dois botões (aluna e treinador) leem fresco.
- Quem escreve na rotina: só o `RoutineService` (que sobe a revisão), a mesclagem de contas (também sobe a revisão: `mergedRoutineRevision`) e as contas de revisão da loja. Não achei escritor sem revisão.
- **Caminho que NÃO se auto-corrige:** um programa da semana seguinte criado ANTES (por exemplo "Gerar semana seguinte para todos", `generateNextWeekIfMissing`, que não recria se o programa já existe) reflete a rotina daquele dia, e o botão da aluna responde `ja_gerado`: ela não consegue regenerar. É a explicação mais plausível que ainda cabe com a informação "ela não mudou a rotina depois de gerar" (a geração pode ter ocorrido mais cedo do que se pensa). **Falta provar com a hora de criação do programa nº 600.**
- Um treino na SEXTA não pode nascer de uma rotina em que a sexta é descanso (as sessões só nascem dos dias ativos; dia fora da rotina é descartado). A sexta de Duane aparece como descanso no app. Isso reforça "rotina diferente na hora da geração" ou "treino criado/movido à mão".

**Cenário 2 — defeito ao vivo na geração.** Achado um defeito LATENTE real em `generateWeek` (`training-plans.service.ts`, criação das sessões): `const modalities = day.modalities.length ? day.modalities : ['corrida']`. Um dia ATIVO com a lista de modalidades vazia vira CORRIDA por padrão (prescrição inventada). Desde 26/10 a gravação recusa esse dia ("Dia com treino precisa de ao menos uma modalidade"), mas o próprio comentário de `routine.rules.ts` diz que o validador anterior deixava passar "dia com treino sem modalidade": linhas gravadas antes de 26/10 podem existir assim e, nas telas, aparecem como "NÃO" em todas as modalidades (e não como "DESC"). Isso poderia explicar a corrida da SEGUNDA (a segunda não aparece na imagem da aluna, só no painel como "NAO/NAO/NAO"), mas NÃO a da sexta. **Correção proposta (precisa de aprovação, risco médio): dia ativo sem modalidade não gera treino (e vira alerta), em vez de assumir corrida.**

**Resumo:** nenhum dos dois cenários, sozinho, explica Seg e Sex ao mesmo tempo com a rotina atual. Isso pede o dado de produção (hora do programa e histórico da rotina).

## Para Elton agora (sem código)
Para Duane: abrir a ficha dela e clicar **"Refazer nova semana de treinos"**; a geração usará a rotina vigente (Ter 60 corrida, Qua 45 fortalecimento, Qui 45 corrida, Dom 120 corrida). Como a semana ainda não começou e não há execução, nada se perde.
