# RASCUNHO — atualização dos textos legais para a rastreabilidade das prescrições

> **Status: rascunho para revisão. NÃO publicado.** Nada foi alterado em `apps/api/src/legal/legal-content.ts` (a fonte única que alimenta Termos, Política e tela do app).
> Data do rascunho: 10/10/2026. Condição para o deploy da Etapa 1.2a: estes textos aprovados por Elton e, idealmente, por advogado (ver pendência jurídica em `PRONTUARIO.md`).
> Linguagem do produto: "programa de treino" (nunca "plano de treino") e "a IA" (nunca "motor").

## 1. O que o sistema passa a guardar (fatos verificados no código e nos testes)

| Registro | Conteúdo | Quando é apagado |
|---|---|---|
| **Texto integral enviado à IA** (por geração de programa ou de treino do dia) | Exatamente o que foi enviado ao fornecedor: perfil e entrevista, rotina, relatos e observações, prontuário, diretrizes do treinador, histórico recente, estado longitudinal (inclui resumos de dispositivo) e dados de saúde que o aluno informou. | **Até 12 meses** após a geração (prazo padrão, configurável pelo Panzeri Run; rotina diária de expurgo). Antes disso, com a exclusão da conta ou, na parte derivada de dispositivo, com a exclusão dos dados do serviço (item 3). |
| **Índice do que foi considerado** | Lista de fontes entregues, entregues sem processar, ausentes ou guardadas só em parte (com trecho curto), lacunas de contexto. | Com a exclusão da conta. |
| **Decisões do programa** | Resumo de cada treino prescrito, a justificativa em texto livre devolvida pela IA, a comparação com a semana anterior e **cada versão** de um treino regenerado (estrutura completa, vigência). | Com a exclusão da conta. |
| **Marcador de remoção** | Quando o aluno exclui dados de um serviço conectado: serviço, data e quais indicadores foram retirados (sem os valores). | Com a exclusão da conta. |

Quem acessa: somente treinador/administrador do Panzeri Run, pelo painel. O fornecedor de IA recebe o texto no momento da solicitação (já descrito na seção 6 da Política); o que o fornecedor faz com ele segue os termos dele.
Dados do Strava não entram na IA nem nessa trilha (regra já vigente).

## 2. Textos propostos

### 2.1 Política de Privacidade — seção 6 "Inteligência artificial" (acrescentar parágrafo ao final)

> Para que cada programa e cada treino possam ser explicados e revisados depois, o Panzeri Run guarda um registro de cada geração: o texto exato enviado à inteligência artificial naquele momento (que pode incluir dados do seu perfil, da entrevista, de saúde que você informou, relatos, feedbacks e resumos de atividades de dispositivos conectados), uma lista do que foi considerado e do que estava ausente, a justificativa devolvida pela IA e cada versão do treino prescrito, com o resultado registrado em cada uma. Esse registro é acessado apenas pelo treinador e pela administração do Panzeri Run.

### 2.2 Política de Privacidade — seção 11 "Retenção" (substituir/ampliar)

> Os dados são mantidos enquanto a conta estiver ativa e pelo prazo necessário para cumprimento de obrigações legais após o encerramento. **O texto integral enviado à inteligência artificial em cada geração é guardado por até 12 meses e depois apagado automaticamente; a lista do que foi considerado, as decisões e as versões dos treinos permanecem enquanto a conta existir.** As cópias de segurança seguem o descrito na seção 10.

### 2.3 Política de Privacidade — seção 8 "Desconectar um serviço" (acrescentar frase)

> Desconectar não altera os registros de geração de programas já feitos, mesmo que tenham usado resumos de atividades daquele serviço.

### 2.4 Política de Privacidade — seção 9 "Excluir os dados de um serviço conectado" (acrescentar parágrafo)

> Ao excluir os dados de um serviço, também retiramos, dos registros de geração de programas, os indicadores calculados a partir das atividades desse serviço (tanto da lista do que foi considerado quanto do texto enviado à IA guardado), preservando as demais informações — como seus relatos, diretrizes e feedbacks — e deixando um marcador que registra apenas que a remoção ocorreu, quando e quais indicadores foram retirados, sem os valores. Como esses indicadores são médias calculadas sobre o conjunto das atividades do serviço, não é possível separar apenas parte deles: eles são retirados por inteiro.

### 2.5 Política de Privacidade — seção 13 "Exclusão da conta" (acrescentar à lista do que é excluído)

> …os registros de geração de programas (texto enviado à IA, lista do que foi considerado, decisões e versões dos treinos)…

(Inserir na enumeração "São excluídos, no banco em operação, …". Eles **não** estão entre os registros que permanecem.)

### 2.6 Política de Privacidade — seção 10 "Cópias de segurança" (nenhuma mudança de texto; conferir)

O texto atual já cobre: as cópias contêm os dados existentes no momento e a remoção delas não é imediata. Os registros de geração entram nas cópias como qualquer outro dado da conta. **Ponto para o jurídico:** um texto integral expurgado aos 12 meses pode continuar existindo em cópias antigas até elas serem descartadas (mesma regra da seção 10).

### 2.7 Termos de Uso — seção 2 "Natureza do serviço" (acrescentar)

> O programa e os treinos são montados com apoio de inteligência artificial e revisados pelo treinador. Guardamos um registro de como cada programa foi montado, para que o treinador possa conferi-lo e para melhorar o acompanhamento.

### 2.8 Resumo exibido no aplicativo (`LEGAL_SUMMARY`, bloco "Inteligência Artificial")

Reutilizar o parágrafo 2.1 (a tela do app usa as mesmas frases da Política). Incrementar `LEGAL_VERSION`/`LEGAL_UPDATED_LABEL` na publicação, para que o app peça nova ciência quando aplicável.

## 3. Pontos para decisão de Elton / advogado

1. **Base legal dos dados de saúde no texto guardado** (consentimento específico vs. execução de contrato): o registro replica dados de saúde que já eram enviados à IA; a seção 5 da Política precisa cobrir a guarda, não só o envio.
2. **Prazo de 12 meses**: justificar a finalidade (auditoria e melhoria do programa) e confirmar que 12 meses é proporcional; o valor é configurável (`PRESCRIPTION_TRACE_INPUT_RETENTION_MONTHS`).
3. **Marcadores e índice sem prazo (até a exclusão da conta)**: confirmar que não contêm dado pessoal além do já tratado (contêm trechos curtos de relatos/diretrizes — ver tabela do item 1).
4. **Pedido de exclusão de dados do serviço**: a remoção dos indicadores de dispositivo é "por inteiro" (não há recorte parcial possível). Confirmar que a explicação do item 2.4 é suficiente.
5. **Cópias de segurança** (item 2.6).
6. **Aviso aos alunos já existentes** (nova versão dos textos) e momento da publicação: só junto com o deploy da 1.2a.

## 4. O que NÃO muda
Nenhum texto foi publicado; nenhum arquivo de `apps/api/src/legal/` foi alterado; nenhuma tela do app foi modificada.
