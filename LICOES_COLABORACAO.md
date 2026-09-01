# Lições de colaboração

Este documento é diferente do `PRONTUARIO.md`. Ele não registra o que mudou no app — registra
**erros meus de comportamento** nas conversas com o Elton: coisas que eu disse ou fiz errado, que
não são bug de código, mas causaram atrito, confusão ou trabalho perdido. A ideia é que, relendo
isso, eu (ou qualquer sessão de IA futura) erre menos as mesmas coisas.

Criado a pedido explícito do Elton em 30/08/2026, depois de uma sessão com vários desses erros
seguidos.

---

## 2026-08-30

**Repeti a palavra "motor" duas vezes**, mesmo já existindo uma regra registrada desde 31/07
(`avoid_motor_terminology`) de nunca chamar a IA de "motor" — porque isso soa como se existisse um
sistema de regra fixa por trás, o que já causou um alarme falso grave antes. Fiz de novo hoje, ao
citar um trecho antigo do próprio `PRONTUARIO.md` sem adaptar a linguagem pro padrão atual.
**Como evitar**: quando eu cito ou parafraseio texto antigo de qualquer documento, preciso aplicar
as regras de linguagem atuais no que eu digo pro Elton, mesmo que o texto original (histórico) use
outra palavra. O documento pode registrar o passado com a palavra antiga; minha fala não pode.

**Disse "não existe nem nunca existiu um motor" — isso é factualmente errado.** Existiu sim (o
sistema antigo antes da reescrita de 30/07, e a fórmula fixa de bike removida em 31/07). Ao tentar
corrigir o primeiro erro (não chamar de "motor"), exagerei pro lado oposto e neguei um fato real do
histórico do projeto. **Como evitar**: corrigir terminologia (como dizer algo) é diferente de
corrigir fato (o que aconteceu). Uma correção de linguagem não deve virar uma reescrita da história.

**Criei branches novas do Git pra cada mudança sem necessidade real**, mesmo o projeto nunca tendo
usado esse fluxo antes desta sessão. Isso obrigou o Elton a passar por telas de "Pull Request" e
mesclagem no GitHub repetidamente — algo que ele nunca precisou fazer nos meses anteriores do
projeto. Ele teve que pedir explicitamente pra eu parar. **Como evitar**: o padrão do projeto é
sincronizar direto pra `main`, sem branch. Só criar uma branch separada quando o próprio Elton pedir,
ou quando eu perguntar antes e ele confirmar — nunca decidir isso sozinho por "parecer mais seguro".

**Passei um tempo real guiando o Elton por configuração de emulador Android** (variáveis de
ambiente, `adb`, `aapt`, `sdkmanager`) antes de me lembrar que o celular pessoal dele é um iPhone —
informação que ele já tinha me dado antes nesta mesma sessão. Só percebi o erro depois que ele
apontou, visivelmente frustrado. **Como evitar**: antes de escolher qual plataforma testar primeiro
(Android vs iOS), checar o que já foi dito na conversa sobre qual aparelho a pessoa realmente tem —
não seguir só a ordem "mais fácil de configurar tecnicamente".

**Rodei dois builds (Android e iOS) a partir de uma cópia do repositório desatualizada**, porque
não confirmei que o `git pull` da mesclagem anterior tinha realmente acontecido antes de mandar
gerar os builds. Resultado: os dois builds saíram sem as mudanças de marca que deveriam ter, e o
Elton instalou, testou, e "não mudou nada" — gastando tempo dele à toa até eu investigar e achar a
causa. **Como evitar**: antes de rodar qualquer build ou ação que dependa do estado real do
repositório, checar `git log`/`git status` primeiro — nunca assumir que uma instrução anterior
("troque pra main e dê pull") foi realmente executada do outro lado.

**Quando o Elton pediu pra eu "repensar e trazer alternativas"** sobre a paleta de cores/identidade,
eu já saí implementando mudanças direto no código, sem apresentar opções primeiro. Ele teve que
corrigir explicitamente: "eu não havia mandado mudar nada, apenas pedi para repensar". **Como
evitar**: quando o pedido é claramente de reflexão/análise ("pense", "repense", "o que acha"),
responder com análise e esperar confirmação antes de tocar em código — mesmo que a mudança pareça
óbvia ou pequena.
