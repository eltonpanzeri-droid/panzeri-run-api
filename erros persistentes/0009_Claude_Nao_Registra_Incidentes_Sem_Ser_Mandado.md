# 0009 — Claude não registra incidentes sem ser explicitamente mandado

**Status:** ABERTO (padrão recorrente, não resolvido)

---

## Padrão de falha

A regra existe no CLAUDE.md: "Erros persistentes — dossiê obrigatório na 4ª tentativa." Além disso, Elton repetiu verbalmente que os incidentes devem ser registrados na pasta `erros persistentes` como parte do trabalho normal, não como tarefa extra pedida no final.

O que acontece na prática: Claude corrige bugs, faz tudo funcionar, entrega o resultado — e não registra o incidente. Ponto. Elton não deveria precisar lembrar de nada. O registro é obrigação do Claude, parte do fluxo de trabalho, não uma tarefa que depende de solicitação.

---

## Histórico de rodadas

### Ocorrência 1 — data anterior
Elton pediu explicitamente para registrar incidentes. Claude registrou alguns, mas não de forma sistemática.

### Ocorrência 2 — 17/09/2026
Bugs de treino extra corrigidos (formulário incompleto + card com prescrição vazia). Claude criou 0007 e 0008 somente no final da sessão, depois do Elton lembrar: "não se esqueça de registrar os incidentes como é uma regra que vc deveria já estar cumprindo." Mesmo assim, nesta mesma sessão errou de novo — registrou os dossiês mas não registrou o incidente sobre o próprio padrão de não registrar.

### Ocorrência 3 — 17/09/2026 (mesma sessão)
Elton apontou que o erro voltou. Claude corrigiu o bat (xcopy) sem entender que o pedido era criar o dossiê do incidente recorrente, não automatizar a cópia.

---

## Causa raiz

Claude trata `erros persistentes` como tarefa separada, não como parte obrigatória do fluxo de correção. O registro do incidente deveria acontecer junto com a correção — é parte da definição de "corrigido", não um passo extra.

---

## Aprendizado sistêmico

**Regra permanente — duas situações distintas:**

1. **Erro grave** (impacto real em aluna, dado perdido, treino em limbo, funcionalidade quebrada): registrar dossiê imediatamente na primeira ocorrência, junto com a correção.

2. **Erro recorrente** (mesma falha aparecendo em tentativas diferentes): registrar dossiê na quarta tentativa, documentando o histórico das três rodadas anteriores.

Em nenhum dos dois casos o Elton precisa pedir. O registro é parte da definição de "concluído".

---

## Arquivos relacionados

- `erros persistentes/0007_Treino_Extra_Formulario_Incompleto.md`
- `erros persistentes/0008_Treino_Extra_Card_Prescricao_Vazia.md`
- CLAUDE.md — seção "Erros persistentes — dossiê obrigatório"
