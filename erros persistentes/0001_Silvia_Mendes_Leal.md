# Erro Persistente #0001 — Silvia Mendes Leal

**Aluna/testadora:** Silvia Mendes Leal (silvia.mendesleal@gmail.com)
**Problema original relatado:** travava na entrevista guiada, "pergunta 60", sem conseguir concluir.
**Aberto em:** 04/09/2026
**Status no momento deste registro:** ainda não confirmado como resolvido — em acompanhamento.

Este é o primeiro registro do processo de "erros persistentes": quando o mesmo problema relatado
sobrevive a 3 tentativas de correção sem resolução confirmada, a 4ª correção passa a gerar (ou
atualizar) um dossiê como este, pra aprendermos com o padrão em vez de só remendar sem registrar.

---

## Linha do tempo de correções (rodadas)

### Rodada 1 — CEP sem saída manual
- **Diagnóstico:** a pergunta de CEP exigia que a busca automática (ViaCEP) resolvesse uma cidade
  pra liberar "Continuar", sem nenhuma alternativa manual.
- **Correção:** adicionado link "Não encontrei meu CEP, digitar endereço manualmente" no app +
  backend passou a aceitar CEP ou cidade/estado manuais.
- **Resultado:** não resolveu — ela continuou travada no mesmo lugar.

### Rodada 2 — número da casa obrigatório sem estar sempre visível
- **Diagnóstico:** `personal_address_number` continuava obrigatório no backend, mas só aparece na
  tela quando o CEP resolve uma cidade — mesma classe de bug da Rodada 1, só que num campo
  diferente, não pego na primeira revisão.
- **Correção:** campo removido da lista de obrigatórios (não é usado pra nada essencial).
- **Resultado:** não resolveu — ela continuou travada.

### Rodada 3 — causa raiz real encontrada (dado real, não suposição)
- **Diagnóstico:** com prints do painel admin dela, identificado que o campo realmente faltante era
  `running_experience` — não tinha nenhuma relação com CEP nem endereço. As duas rodadas anteriores
  corrigiram bugs reais, mas nenhuma delas era a causa do travamento dela especificamente.
- **Correção:** mensagem de erro do backend passou a listar exatamente qual campo falta, em vez de
  um texto genérico.
- **Resultado:** confirmado em produção que a mensagem aparece certa ("Faltam respostas
  obrigatorias: running_experience."), mas ela continuava sem conseguir avançar sozinha — precisava
  clicar em "Voltar" repetidas vezes pra achar a pergunta certa em meio a 60.

### Rodada 4 — hipótese estrutural + prevenção (esta rodada)
- **Diagnóstico mais profundo, a pedido do Elton** ("se depende de responder, não deveria ter
  seguido pra frente"): encontrado que `choose()` no app marcava a pergunta como respondida
  (`setAnswers`) **antes** de confirmar que o salvamento no servidor (`persist`) teve sucesso — ou
  seja, uma falha de rede silenciosa podia deixar a pessoa avançar sem a resposta ter sido
  realmente salva. Provável causa raiz de como `running_experience` ficou sem resposta em primeiro
  lugar.
- **Correções aplicadas:**
  1. `choose()` só marca como respondido depois que o servidor confirma o salvamento.
  2. Pulo automático para a pergunta exata que falta, quando a conclusão falha (em vez de exigir
     "Voltar" manual).
  3. Aviso proativo nas perguntas de "roda" (wheel picker) explicando que é preciso deslizar de
     verdade — achado adicional depois que ela reportou travar na "pergunta 4" e o Elton apontou,
     corretamente, que atribuir isso à pessoa não entender a interface é falha de design, não dela.
- **Resultado:** ainda não confirmado — todas essas correções são de **app mobile**, só chegam num
  build novo publicado na loja. A Silvia, no build atual, ainda depende do processo manual
  (clicar Voltar) pra terminar agora.

---

## Aprendizado sistêmico deste caso (o que fica pra frente)

1. **Mensagens de erro genéricas escondem a causa raiz e custam tempo real de investigação** — a
   correção mais valiosa desta série (mensagem específica de campo faltante) só veio na 3ª rodada,
   quando já devia ter sido a 1ª coisa a corrigir diante do primeiro relato de travamento.
2. **Uma correção pontual não substitui revisar a classe inteira do problema** — a Rodada 2 só
   aconteceu porque a Rodada 1 corrigiu um sintoma sem verificar se o MESMO padrão existia em outro
   campo próximo (isso já é uma regra existente — ver `panzeri_bug_pattern_review_discipline` — mas
   esse caso mostra que ela precisa ser seguida com mais rigor ainda, checando TODOS os campos
   relacionados de uma vez, não um por vez conforme reclamam).
3. **"Marcar como respondido" só deveria acontecer depois de confirmação real do servidor** — esse
   princípio (Rodada 4) provavelmente deveria ter sido auditado desde o início como suspeito
   número 1, já que é o único jeito de uma pergunta *obrigatória* ficar sem resposta salva.
4. **Correções de app mobile não têm efeito imediato** — isso alongou a percepção de "nada
   resolve", quando na real cada rodada resolveu um problema de verdade, só que scoped a um
   possível build futuro, não ao momento do relato. Vale deixar isso mais claro, mais cedo, em
   cada correção futura de app mobile.
