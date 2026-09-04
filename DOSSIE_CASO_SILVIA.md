# Dossiê — Caso Silvia (testadora, 04/09/2026)

Registro completo do caso da Silvia Mendes Leal (testadora do teste fechado do Android), desde o
primeiro relato até o ponto atual. Inclui as informações que o Elton passou, o comportamento e as
intervenções da IA, os erros cometidos no caminho, e onde as coisas estão agora.

---

## 1. Como começou

O Elton reportou, numa única mensagem, três problemas reais observados no uso do app:

1. Uma mensagem de feedback de treino no Telegram que não deixava claro qual treino era (recebia
   3 avisos idênticos sem saber se eram do mesmo treino ou de treinos diferentes).
2. A Silvia (uma das testadoras cadastradas naquele dia) tinha sido **cobrada de verdade** ao tentar
   assinar — quando deveria ter acesso gratuito como testadora — e o valor cobrado (R$19,90) parecia
   errado em relação ao preço da loja (R$24,90).
3. A Silvia travava numa tela específica ("pergunta 60") sem conseguir concluir a entrevista.
   Adicionalmente, a Jú (outra aluna/testadora) reclamou de sentir falta de um botão "Voltar" na
   entrevista.

O pedido explícito foi: investigar com cuidado, sem piorar nada, e agir como especialista — "não
tenha preguiça de trabalhar".

---

## 2. O que a IA fez, em ordem cronológica

### 2.1 — Mensagem de feedback do Telegram
Corrigida rapidamente: a mensagem passou a incluir a data e a modalidade do treino, não só o
motivo do desvio. Sem complicações nesse item.

### 2.2 — Investigação da cobrança da Silvia
A IA determinou a causa raiz real: o preço diferente (R$19,90 web vs R$24,90 loja) era uma decisão
de negócio deliberada, não um bug. O problema de verdade era que o build Android que a Silvia
instalou tinha sido gerado **antes** da chave do RevenueCat existir no código — sem essa chave, o
app caía no fluxo antigo (Asaas, cobrança real) em vez de reconhecer que deveria ser gratuito.
Recomendação inicial: estorno manual no Asaas (o Elton decidiu tratar isso diretamente com ela,
depois, por conta própria — não foi revertido pela IA).

### 2.3 — Primeira tentativa de solução geral: lista fixa no código (ERRO)
A primeira correção proposta pela IA foi uma lista de 8 e-mails de testadores **fixa no código**
(hardcoded). **O Elton apontou corretamente que isso não escalava** — ele próprio já tinha
adicionado mais e-mails no Play Console que o sistema não saberia reconhecer. Esse foi um erro real
de julgamento da IA: resolveu o sintoma imediato sem pensar em como o Elton continuaria adicionando
testadores no dia a dia.

### 2.4 — Correção de verdade: tabela gerenciável no admin
Corrigido com uma solução estrutural: uma tabela nova no banco (`FreeTesterEmail`) mais uma seção
"Testadores gratuitos" no próprio painel administrativo, onde o Elton adiciona/remove e-mails
sozinho (aceitando colar vários de uma vez). O backend passou a checar essa tabela antes de
qualquer cobrança, sem precisar de deploy por pessoa nova.

### 2.5 — Bug real do CEP (primeira parte da entrevista travada)
Investigação encontrou que a pergunta de CEP na entrevista exigia que a busca automática (ViaCEP)
desse certo pra liberar "Continuar", sem nenhuma saída manual. Corrigido com um link "Não encontrei
meu CEP, digitar endereço manualmente" no app, e a validação do backend ajustada para aceitar CEP
OU cidade/estado preenchidos à mão.

### 2.6 — Falha real de deploy/dados descoberta em tempo real
Depois da correção acima, testadores reais (Vander, Luiz Felipe) continuaram sendo direcionados
pro fluxo de pagamento. A IA testou a rota nova sem usar senha nenhuma (`HTTP 401` confirmando que
a rota existia = deploy estava no ar) e concluiu corretamente que a causa real era a tabela de
testadores ainda estar **vazia** — ninguém tinha colado os e-mails na tela nova do admin ainda.
Resolvido de forma mais robusta ainda: uma migração de banco que já popula a lista sozinha no
próximo deploy, sem depender de ninguém copiar e colar e-mail nenhum.

### 2.7 — Link de convite errado
A IA tinha fornecido o link "Participar na Web" do Play Console pro grupo de testadores — o Elton
identificou que o link certo, pra quem instala direto no Android, era o de "Participar no Android"
(`https://play.google.com/store/apps/details?id=com.panzerirun.app`). Corrigido.

### 2.8 — Segunda parte do bug de CEP, incompleta na primeira correção (ERRO)
A correção do item 2.5 resolveu o CEP, mas deixou **"número da casa" (`personal_address_number`)
ainda obrigatório no servidor**, mesmo essa pergunta só aparecendo na tela quando o CEP resolve uma
cidade. Isso manteve a Silvia (e potencialmente outros) travados na mesma classe de bug, com a
mesma mensagem genérica de erro. Só foi descoberto porque a Silvia reportou, através do Elton, que
**continuava travada mesmo depois do primeiro deploy** — a IA reconheceu o erro, investigou de novo
e corrigiu (removendo esse campo da lista de obrigatórios, já que não é usado pra nada essencial).

### 2.9 — Pedido de dado real em vez de suposição
Depois de duas correções incompletas seguidas na mesma área, a IA pediu explicitamente prints do
painel admin da Silvia em vez de continuar teorizando só pelo que aparecia no celular dela. O Elton
resistiu inicialmente ("se vire"), o que levou a IA a tentar (sem sucesso, extensão não conectada)
usar acesso direto ao navegador antes de receber os prints de qualquer forma.

### 2.10 — Causa raiz real, com dado real
Com os prints do admin em mãos, a IA identificou a causa exata: o campo obrigatório
**`running_experience`** ("Qual opção melhor descreve sua experiência com corrida?") simplesmente
não existia nas respostas salvas da Silvia — nenhum outro campo obrigatório estava faltando. A
hipótese mais provável é uma falha pontual de salvamento (rede) numa resposta específica, não um
bug estrutural novo. Confirmado no código que essa pergunta não tem nenhuma condição que a esconda
— deveria sempre aparecer.

### 2.11 — Correção estrutural final: mensagem de erro específica
Em vez de só resolver o campo dela, a IA alterou a mensagem de erro do servidor pra sempre listar
**exatamente quais campos estão faltando**, ao invés do genérico "Conclua todas as perguntas
obrigatórias" que exigiu três rodadas de investigação nesse caso. Isso deve eliminar a necessidade
de repetir esse processo de diagnóstico demorado em casos futuros parecidos.

---

## 3. Autoavaliação honesta do comportamento da IA neste caso

**O que funcionou bem:**
- Identificação correta e rápida da causa raiz financeira (preço não era bug, RevenueCat sim).
- Correção de um erro próprio (lista fixa) assim que apontado, sem resistência, com solução melhor.
- Uso de testes seguros sem credenciais (checagem de rota HTTP) pra confirmar fatos em vez de
  assumir, mais de uma vez.
- Ao final, mudança estrutural (mensagem de erro específica) que previne repetição do mesmo tipo de
  investigação demorada no futuro — não só resolveu o caso, resolveu a classe de problema.

**O que não funcionou bem, sem maquiar:**
- **Duas correções seguidas incompletas na mesma área** (CEP, depois número da casa) — a segunda só
  foi encontrada porque a Silvia continuou travada e o Elton cobrou. Uma revisão mais completa de
  todos os campos do formulário na primeira tentativa teria evitado a segunda rodada.
- A primeira solução pra testadores gratuitos (lista fixa no código) não pensou em escala/uso real
  desde o início — precisou do Elton apontar o problema óbvio.
- Nos momentos de maior pressão (testadores reais sendo cobrados ao vivo), a IA pediu confirmação
  de passos pequenos com mais frequência do que deveria — parte disso é apropriado (dinheiro real
  em jogo), mas parte poderia ter sido verificado sozinho antes de perguntar.

---

## 4. Continuação — depois da mensagem de erro específica

A mensagem de erro melhorada (item 2.11) já apareceu certa em produção pra Silvia: **"Faltam
respostas obrigatorias: running_experience."** — confirmação real, não suposição. Mas isso sozinho
não bastou: ela ainda precisava clicar em "Voltar" repetidamente pra achar a pergunta certa em
meio a 60, e nesse processo reportou travar também na "pergunta 4" (uma roda de números).

O Elton questionou, corretamente, um ponto mais fundo: **se uma pergunta é obrigatória, o app nunca
deveria deixar avançar sem ela ter sido respondida de verdade** — travamentos de campo obrigatório
não deveriam nem ser possíveis, muito menos exigir descoberta via mensagem de erro. Essa pergunta
levou a uma investigação mais profunda (não superficial) que encontrou a causa estrutural mais
provável:

- **`choose()` marcava a pergunta como respondida no app ANTES de confirmar que o salvamento no
  servidor teve sucesso** — uma falha de rede silenciosa podia deixar a pessoa avançar com a
  resposta nunca realmente salva. Corrigido: só marca como respondido depois da confirmação real.
- Adicionado também um **pulo automático pra pergunta exata que falta** quando a conclusão falha,
  em vez de exigir "Voltar" manual repetido.
- Sobre a "pergunta 4": o Elton apontou que atribuir a confusão à pessoa "não entender a interface"
  é falha de design nossa, não da usuária — corrigido com um aviso proativo nas perguntas de roda
  de números, explicando que é preciso deslizar de verdade pra contar como resposta.

**Este caso, por ter passado de 3 rodadas de correção sem resolução confirmada, virou o primeiro
registro do novo processo de "Erros Persistentes"** — ver
`erros persistentes/0001_Silvia_Mendes_Leal.md` para a linha do tempo completa e o aprendizado
sistêmico extraído.

## 5. Situação atual (no momento deste dossiê)

- Todas as correções de código relacionadas a este caso foram commitadas e enviadas ao repositório.
- A causa raiz original do travamento foi identificada com certeza (`running_experience` sem
  resposta salva) e uma causa estrutural provável foi corrigida (confirmação de salvamento antes de
  avançar).
- **Ainda não confirmado como totalmente resolvido** — as correções mais recentes (Rodada 4) são de
  app mobile, só chegam num build novo publicado na loja; no build atual, a Silvia ainda depende do
  processo manual pra terminar.
- **Pendência separada, ainda não resolvida**: o estorno do valor cobrado indevidamente dela
  (R$19,90 via Asaas) — o Elton optou por tratar isso diretamente com ela, fora do escopo técnico.
