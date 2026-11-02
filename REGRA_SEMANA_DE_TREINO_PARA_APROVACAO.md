# Regra do treino da semana — APROVADA por Elton em 01/11/2026 (status: `active`)

> Montada a partir das respostas de Elton, uma pergunta por vez, e aprovada por ele em 01/11/2026 ("acho que está pronta. registre nos devidos lugares"). **A regra está aprovada; a implementação NÃO foi autorizada** (nada foi alterado no código). Antes de editar, é preciso a ordem de Elton para cada passo. Dossiê relacionado: `erros persistentes/0013_Datas_E_Fusos_Horarios.md`.

## Princípios
1. **Todos os horários são de Brasília**, sempre (mesmo que a aluna esteja viajando ou com o relógio do celular diferente).
2. A tela principal mostra **o último treino gerado** para a semana do calendário. O calendário não troca a semana sozinho enquanto a aluna não gerar a seguinte.
3. O botão **"Gerar treino da semana"** só é liberado **a partir de domingo 12h**.
4. O botão **"Próxima"** fica **apagado**, com a frase "A próxima semana é liberada no domingo ao meio-dia". Nunca leva a lugar nenhum e nunca pula uma semana.

## Linha do tempo (exemplo: treino da semana 26/10 a 01/11 já gerado)

| Quando | O que aparece na tela principal | Se ela tocar em gerar |
|---|---|---|
| Segunda 26/10 até domingo 01/11, **11h59** | Treino de 26/10 a 01/11. **Sem botão de gerar.** | (não há botão) |
| **Domingo 01/11, 12h** até 23h59 | Treino de 26/10 a 01/11 **e** o botão de gerar, juntos | Gera **02/11 a 08/11** pela rotina dela. **Não pergunta** "incluir hoje?" |
| **Domingo 01/11, 12h–23h59, depois que ela gerou** | **Já aparece a semana 02/11 a 08/11**, mesmo ainda sendo domingo. **Sem botão** (volta só no domingo 12h seguinte). O treino de 26/10 a 01/11, inclusive o do domingo, fica em **"Anterior"**. | (não há botão) |
| **Segunda 02/11 00h** em diante (sem ter gerado) | **Só o botão.** O treino de 26/10 sai da tela principal (fica em "Anterior"). | Gera **02/11 a 08/11**. **Pergunta** "incluir hoje?" (vale de segunda a sábado) |
| Domingo 08/11, **até 11h59** (ainda sem ter gerado) | Só o botão | Gera **02/11 a 08/11**. **Pergunta** "incluir hoje?" (inclui o domingo) |
| **Domingo 08/11, 12h** em diante (ainda sem ter gerado) | Só o botão. A semana 02/11 a 08/11 ficou **sem treino** ("Treino não gerado nessa semana", em "Anterior"). | Gera **09/11 a 15/11**. **Não pergunta** "incluir hoje?" |

Depois que ela gera, o treino novo aparece na tela principal e o ciclo recomeça (o botão volta no domingo 12h seguinte).

## "Anterior" e "Próxima"
- **Anterior:** mostra as semanas passadas (com treino, ou "Treino não gerado nessa semana").
- **Próxima:** apagada, com a frase acima.

## Onde o sistema de hoje é diferente desta regra (fatos do código)
1. **Domingo depois das 12h:** hoje a tela principal mostra **só o botão** e o treino velho vai para "Anterior" (pedido de 07/08). Pela regra nova: treino velho **e** botão juntos até segunda 00h.
2. **Pergunta "incluir hoje?":** hoje **nunca é feita no domingo** e usa o **relógio do celular** (App.tsx, linhas 4641, 4838 e 4878). Pela regra nova: feita de segunda a domingo 11h59 e sempre em Brasília.
3. **"Próxima":** hoje pode estar ativa e, depois do corte de domingo, **pula para a semana 09/11** (o servidor desloca a conta). Pela regra nova: apagada.
4. **Quem decide o estado da semana:** hoje o app refaz a conta do corte de domingo por conta própria (duas funções) e o servidor tem outras (pelo menos três). A regra nova exige uma resposta única, e o caso do dossiê 0013 mostra que a conta no celular falhou no app nativo.

## Próximo passo (ainda NÃO autorizado)
Propor o que mudar (arquivos, leitores e escritores da fonte compartilhada, riscos, testes de borda nos horários 11h59, 12h01, 21h08, 23h59 e 00h01, e rollback) e **esperar a ordem de Elton** antes de editar. Elton não autorizou nenhuma das opções A/B/C do dossiê 0013.
