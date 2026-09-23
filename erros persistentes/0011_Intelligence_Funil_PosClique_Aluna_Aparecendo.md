# 0011 — Panzeri Intelligence: funil "Após o clique" mostrando aluna existente como prospecto

**Projeto:** Panzeri Intelligence (`Aplicativo Panzeri Intelligence`), não o Panzeri Run — mas registrado
aqui porque é o local central de dossiês de erro persistente do Elton.

**Aluna de teste:** Mariana Charles Santos Castro — pagou em 22/09/2026, e seguiu aparecendo no funil
"Após o clique" da tela `/pos-clique` como se ainda estivesse em jornada de aquisição.

## Rodada 1 — 23/09, manhã
**Sintoma relatado:** "Hoje" (período) mostrava dados de ontem.
**Diagnóstico:** `from = subDays(new Date(), days)` com days=1 dava a data de ontem, não hoje.
**Correção:** `from = format(startOfDay(subDays(new Date(), days - 1)), 'yyyy-MM-dd')`.
**Resultado:** Não resolveu o problema seguinte (rodada 2), mas a lógica do período em si era outro bug real, coexistindo.

## Rodada 2 — mesma manhã
**Sintoma relatado:** Mariana (que já pagou) aparecia como "Abriu o app" em vez de "Pagou".
**Diagnóstico:** `getCommercialEvents` usava o mesmo `from`/`to` do período selecionado — pagamento de
ontem não entrava na janela de "hoje".
**Correção:** Janela de 365 dias só para os eventos comerciais.
**Resultado:** Criou uma nova inconsistência (rodada 3) — o funil ficou logicamente impossível.

## Rodada 3 — mesma manhã
**Sintoma relatado:** Funil mostrava "Pagou" = 1 (100%) mas "Fez o cadastro" = 0 — sequência impossível.
**Diagnóstico:** Só o passo de pagamento usava janela larga; os demais passos (cadastro, payment_started)
continuavam restritos ao período selecionado.
**Correção:** Buscar TODO o histórico de eventos por jornada em janela larga (365 dias); o período
selecionado (`from`/`to`) passou a filtrar só QUEM entra no coorte (que clicou no período), e todos os
passos seguintes usam o histórico completo da jornada.
**Resultado:** Resolveu a inconsistência sequencial, mas não resolveu o problema de fundo relatado a seguir.

## Rodada 4 — mesma manhã, tarde
**Sintoma relatado:** "vc claramente não sabe o que está fazendo... ela continua aparecendo."
**Diagnóstico real:** As três rodadas anteriores trataram o sintoma técnico (datas, janelas, consistência
sequencial) mas nunca o requisito de negócio que o Elton tinha declarado desde a primeira mensagem desta
conversa: **uma vez que a pessoa vira aluna (pagou), ela deixa de pertencer a este funil de aquisição —
mesmo que ela clique em algo da landing de novo depois disso** (curiosidade, retargeting, o que for).
O funil "Após o clique" só deveria contar cliques de quem AINDA NÃO era aluna no momento do clique.
**Correção:** Para cada jornada candidata ao coorte, comparar o timestamp do primeiro pagamento
confirmado (`payment_confirmed`/`subscription_activated`) com o timestamp do clique que a colocaria no
coorte. Se o pagamento é anterior ao clique, a jornada é excluída do coorte inteiro (não conta em nenhum
passo do funil, não aparece na lista de pessoas). Aplicado em `pos-clique/route.ts` e `pre-clique/route.ts`.

## Rodada 5 — mesma tarde
**Sintoma relatado:** funil inteiro zerou — "0 clicaram no botão", ninguém aparece. Elton fez stories
naquele dia e esperava ver pelo menos um clique novo de alguém que não a Mariana.
**Diagnóstico real:** a correção da rodada 4 trocou a janela de eventos para 365 dias, mas a API do Leo
ordena por `createdAt ASC` e cada chamada tinha um `limit` fixo (1000 para eventos de jornada, 500 para
comerciais) sem paginação. Se o total de eventos nos últimos 365 dias passasse do limite, a resposta
trazia os primeiros (mais ANTIGOS) — cortando justamente os eventos de HOJE, os mais recentes. Isso
zerou o coorte inteiro, não só a Mariana.
**Correção:** `getAllJourneyEvents`/`getAllCommercialEvents` no connector (`panzeri-run.ts`), que paginam
de verdade via cursor (`after`/`nextCursor`) até o fim ou até 10 páginas de 2000 (20 mil eventos) — em
vez de confiar num único limit. Janela reduzida de 365 para 90 dias (reduz volume, ciclo de conversão
realista de um funil de aquisição não deveria levar mais que isso). Aplicado em `pos-clique/route.ts` e
`pre-clique/route.ts`.
**Aprendizado desta rodada:** ao ampliar uma janela de busca para resolver um bug de dado faltando,
verificar SEMPRE a ordenação e paginação do endpoint de origem antes de assumir que "só aumentar o limit"
basta — um limit sem paginação com ordenação ASC tem o efeito oposto ao pretendido quando o volume real
excede o limit: descarta o dado mais recente, que é geralmente o mais relevante.

## Aprendizado sistêmico
Nas primeiras 3 rodadas, cada correção resolveu exatamente o defeito técnico apontado no sintoma da vez,
mas nenhuma delas voltou ao requisito original do Elton (declarado explicitamente na primeira mensagem
sobre este funil: "depois disso, não importa nesse menu... lá que importa saber sobre quem é aluna").
Corrigir o sintoma reportado sem reler o requisito de negócio original gera uma sequência de patches que
nunca convergem — cada correção "tampa" um buraco e abre outro, porque a causa raiz real (falta de
filtro por "já era aluna quando clicou") nunca foi endereçada. Da próxima vez que o Elton disser
"continua errado" numa tela onde já houve 2+ correções, a pergunta certa não é "qual detalhe técnico
ainda falta" — é "reli o pedido original completo, ou só o último sintoma reportado?".

**Gatilho de revisão:** se esta tela (ou qualquer funil de aquisição no Intelligence) voltar a mostrar
aluna paga como se fosse prospecto, reabrir este dossiê antes de propor nova correção.
