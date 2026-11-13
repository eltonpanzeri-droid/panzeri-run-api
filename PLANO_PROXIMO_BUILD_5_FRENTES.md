# Planejamento do próximo build — 5 frentes (ordem de Elton, 11/11/2026)

> **Estado: PLANEJADO. NENHUM CÓDIGO ESCRITO. Sem ordem de implementar.** Documento vivo; o resumo está na FILA_PROXIMO_BUILD_E_IDEIAS.md.
> **Objetivo central:** Panzeri Run mais intuitivo, educativo e personalizado: a aluna entende a própria evolução, recebe orientação relevante e percebe acompanhamento contínuo.
> **Princípio de todo o build:** cada interação com o Panzeri Run precisa ajudar a aluna a entender melhor o treino, decidir melhor ou executar uma ação relevante.

## Diretriz de Elton para mim (antes de qualquer código)
1. AUDITAR componentes, indicadores, regras de negócio e mecanismos de notificação que já existem.
2. REAPROVEITAR a infraestrutura atual sempre que possível.
3. APRESENTAR plano com dependências e riscos e esperar aprovação (várias frentes são risco alto: IA, saúde, schema, fonte compartilhada).
4. PRESERVAR integralmente os dados que a IA usa, mesmo quando um gráfico deixar de aparecer para a aluna.

## Ordem recomendada por Elton
(1) revisar o fluxo das 5 perguntas + criar o canal de problemas (mais delimitados); (2) em paralelo, estruturar a nova Evolução; (3) depois, a infraestrutura ÚNICA de notificações, que serve às educativas e às comportamentais.

## Critérios de conclusão (por frente)
| Frente | Pronto quando |
|---|---|
| 1. Relatar problema | Aluna envia o relato e a administração consegue consultá-lo |
| 2. Evolução | Gráficos reorganizados, interpretação individual e síntese por grupo funcionando |
| 3. Educação | Notificações contextualizadas por sistema, dispositivo e etapa de uso |
| 4. Acompanhamento | Gatilhos, biblioteca de mensagens e controle de frequência operacionais |
| 5. Onboarding | Fluxo inicial simplificado sem perda de dados essenciais à prescrição |

## Frente 1 — Relatar problema (prioridade ALTA)
Opção "Relatar problema" no menu principal da aluna.
- Tipo: erro, dificuldade de uso, dados incorretos ou sugestão.
- Descrição livre; anexar imagens/capturas de tela.
- Enviar automaticamente dados técnicos (versão do app, sistema operacional, modelo do aparelho), respeitando a privacidade.
- Registrar a solicitação para acompanhamento pela administração (consulta no painel).
- Ideia anterior de Elton (11/11): ao enviar, chega mensagem automática no TELEGRAM dele. Mantém-se junto com o registro no painel.
- Pontos a decidir/auditar: reaproveitar o circuito Relator (`StudentReportEntry`); armazenamento e limite de imagens (privacidade, texto/imagem pode conter dado de saúde); anti-spam; incluir nome + código da aluna na mensagem.

## Frente 2 — Reformular a Evolução (prioridade MÁXIMA)
A tela deixa de ser só indicadores e vira RELATÓRIO INTERPRETATIVO de treino, recuperação e comportamento.
**2.1 Visual:** agrupar por grandes áreas (recuperação, resposta à carga, desempenho, consistência, comportamento); eliminar gráficos redundantes NA TELA DA ALUNA (dados seguem para a IA); destacar os mais relevantes com expansão para detalhe; comparar padrão habitual de longo prazo × tendência recente; linguagem acessível com rigor científico.
**2.2 Cada indicador mostra 4 coisas:** o que mede; como interpretar; comportamento habitual da aluna; o que a tendência atual sugere. Exemplo dado por Elton: interrupções do sono (escala em que perto de 1 = mais interrupções; média habitual 2; tendência próxima; se associar a menos sono/pior qualidade, recuperação pode piorar; acompanhar com fadiga, esforço percebido e resposta ao treino). Respeitar a ESCALA REAL de cada indicador; sem conclusão clínica nem causalidade que os dados não sustentem.
**2.3 Síntese por grupo:** texto personalizado do conjunto (ex.: "12 indicadores de resposta à carga; no longo prazo 10 de 12 compatíveis com boa resposta; na tendência recente 4 melhoraram, 5 estáveis, 3 pioraram; conjunto sugere evolução favorável com oscilações; seguiremos acompanhando os que pioraram"). **Números do exemplo são ILUSTRATIVOS.** Contar somente indicadores disponíveis, válidos e interpretáveis; NÃO dar o mesmo peso clínico/esportivo a todos.
- Guardrails do projeto: regra "uma matemática só" (faixa vem do servidor, ver memória evolução em seis áreas); sem fórmula prescritiva de treino; texto interpretativo é saída de IA ou texto fixo? DECIDIR e, se for IA, tratar como proposta não confiável (schema/guardrails); dado de saúde = risco alto. Lotes 1-2 da Evolução já existem (faixa do servidor, seletor de modalidade, esqueleto) — partir deles. Faltam dor etc. (ver memória).

**Ideia visual de Elton (11/11/2026, referência: print de outro app de bem-estar, "Para este momento"):** apresentar a Evolução em CARDS ROLÁVEIS PARA OS LADOS (carrossel horizontal), um card por indicador ou por grupo, para dar movimento e interatividade ao app. Só ideia, sem decisão de layout. Pontos a pensar quando for a hora: um carrossel por grande área (recuperação, resposta à carga, desempenho, consistência, comportamento); card mostra o resumo (4 informações do indicador, expansão para detalhe); dica visual de que há mais cards ao lado (card seguinte aparecendo cortado, como no print); acessibilidade (não depender só do gesto, ter indicador de posição); funcionar no PWA, Android e iPhone (verificar o que a tela atual de Evolução usa para rolagem horizontal antes de escolher a biblioteca).

## Frente 3 — Notificações educativas sobre o app (prioridade ALTA)
Ensinar a usar os recursos. Personalizar por: sistema (Android/iOS); dispositivo conectado (Garmin, COROS, Amazfit, Polar, Apple Watch, outros); etapa de uso; funcionalidades ainda não usadas; dúvidas/dificuldades recorrentes.
Exemplos de Elton: primeiro acesso ("onde encontrar treinos e evolução"); relógio conectado ("veja como acompanhar as atividades importadas"); primeiro treino registrado ("agora informe sua percepção de esforço"); evolução disponível ("acompanhe tendências de desempenho e recuperação").
Só citar funcionalidades REALMENTE disponíveis para aquele sistema/fabricante.

## Frente 4 — Notificações comportamentais e de treino (prioridade MÁXIMA)
Banco estruturado de notificações: eventos do app + indicadores individuais + orientações com base na literatura. Fluxo: dados e eventos da aluna (treinos, feedbacks, sono, fadiga, testes, evolução) → regras de gatilho e personalização (identifica a situação e escolhe a orientação) → notificação contextualizada, no momento certo, sem repetição excessiva.
(Redação: usar "regras de gatilho", NUNCA "motor" — ver CLAUDE.md.)
**4.1 Operacionais:** treino concluído sem feedback → pedir esforço percebido e comentários; feedback sem atividade vinculada → orientar a registrar/vincular; teste de 3 km pendente → lembrar conforme planejamento (OBS: o teste de 3 km está ESCONDIDO da interface desde 28/07/2026 por pedido do treinador — conferir se volta); dados do relógio desatualizados → verificar sincronização; semana disponível → avisar da nova programação.
**4.2 Personalizadas:** esforço percebido elevado (priorizar sono); sono ruim relatado (reduzir celular antes de dormir); fadiga crescente (observar e registrar); melhora consistente (reforço positivo); queda de frequência (perguntar se houve dificuldade).
**4.3 Regras obrigatórias:** biblioteca ampla por categoria, gatilho, contexto e objetivo; evitar genérica quando há dado individual; limites de frequência e horários; não repetir parecidas em curto intervalo; respeitar consentimento e preferências; NÃO alertar com dado antigo/incompleto como se fosse atual; tom educativo, acolhedor, objetivo, sem alarmismo; REGISTRAR as enviadas para medir relevância e engajamento.
- Auditar primeiro (já existem: push Expo para avisos à aluna, sino do app, `ContextEvent`/gap de 14 dias com questionário de retorno, avisos de feedback pendente, Relator). Frentes 3 e 4 = UMA infraestrutura só. Cuidado com sobreposição com o item "tela agrupada de feedback pendente" (EM AVALIAÇÃO, FILA) e com a política de push de cada plataforma; mensagens com dado de saúde não podem vazar na tela bloqueada sem cuidado.

## Frente 5 — Onboarding simplificado
Retirar as 5 perguntas rápidas (objetivo, nível, maior dificuldade, expectativa, frequência) ANTES da assinatura. Regra de Elton: se a entrevista inicial NÃO tiver pergunta semelhante, realocar para lá; se JÁ tiver parecida, excluir de tudo. Sem perder dado essencial à prescrição. Fonte compartilhada (`interview.answers`; decide o que a aluna vê antes/depois do pagamento; histórico de bug de tela de pagamento falso-positivo): listar consumidores e escritas, tratar dados de alunas antigas, diagnóstico e aprovação ANTES de editar (risco alto).

## Registro
- 11/11/2026: recebido de Elton (texto do planejamento) e registrado aqui. Nenhuma ordem de implementar até agora.

## Registro 13/11/2026 — andamento
- Frente 1 (Relatar problema) e Frente 5 (cadastro curto + endereço completo): IMPLEMENTADAS. Frente 2: `PLANO_FRENTE2_EVOLUCAO_CARDS.md` (4 decisões pendentes). Frentes 3 e 4: `PLANO_FRENTES_3_4_NOTIFICACOES.md` (5 decisões pendentes).

## Status em 14/11/2026
- Frente 1 (Relatar problema): código pronto. Frente 2 (Evolução): Lotes 1–3 + regras de esforço/volume/ritmo/relógio prontos (rascunho de texto a revisar). Frentes 3 e 4 (notificações): decididas, NÃO implementadas (próximo item). Frente 5 (onboarding curto): código pronto. Detalhes no PANORAMA do PRONTUARIO.md (14/11/2026) e na FILA_PROXIMO_BUILD_E_IDEIAS.md.
