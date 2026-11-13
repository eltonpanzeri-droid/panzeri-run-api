# Frentes 3 e 4 — Notificações educativas e comportamentais: auditoria e plano (13/11/2026)

> **Estado: AUDITORIA FEITA, plano em lotes. NENHUM código alterado.** As duas frentes são UMA infraestrutura (decisão de Elton). Regra: a aluna recebe orientação relevante, sem excesso, sem alarmismo.

## 1. O que já existe (reaproveitar)
- **Sino do app** (`UserNotification`: título, mensagem, tipo, ação interna ao tocar, `externalRef` para não duplicar, lida/não lida) e **push** (`PushNotificationService` via Expo; `User.expoPushToken`). `NotificationsService.notifyUserIfNotRecent(userId, {…}, janelaHoras)` já evita duplicata por evento (`externalRef`) ou por janela de tempo.
- **Disparos hoje:** cron diário às 9h (`NotificationTriggersService`: atraso de pagamento etc.), avisos de treino sincronizado/feedback pendente, boas-vindas, pagamento. E-mails (`MessageLog`), relatório mensal com opção de parar (`monthlyReportOptOut`).
- **Eventos e dados prontos para gatilho:** `WorkoutCompletion` (esforço, sono, dor), check-in semanal, `ContextEvent` (inclui gap de 14 dias e questionário de retorno), indicadores do servidor (aguda × crônica, sono, aderência), integrações conectadas (`ProviderConnection`), plataforma/dispositivo (`UserDevice`, `X-Client-Platform`).

## 2. O que falta
- **Biblioteca de mensagens** (categoria, gatilho, contexto, objetivo) e **regras de gatilho** em UM lugar.
- **Registro do que foi enviado** com relevância/engajamento (hoje o sino registra, mas não há "enviada/aberta/ignorada" por regra) e **limite de frequência global** por aluna (hoje só por tipo/janela).
- **Preferências e consentimento de notificação** da aluna (só existe a opção do relatório mensal); **horários** adequados (hoje o cron é às 9h para todas).
- **Segmentação** por sistema (Android/iOS), relógio conectado e etapa de uso.
- **Frescor dos dados:** não alertar com dado antigo/incompleto como atual.

## 3. Decisões que dependem de Elton
1. **Mensagens educativas (Frente 3): texto fixo** escrito por nós, uma por situação e por plataforma/relógio. Proposta: eu escrevo ~30 mensagens-base no tom dele e ele revisa (como fez com `indicatorMeanings`).
2. **Mensagens personalizadas (Frente 4): texto por regra + modelo de frase com os números da aluna**, sem IA no envio (previsível, sem custo, sem alarme). Confirmar.
3. **Preferências:** a aluna pode desligar por categoria (educativas / treino / comportamento)? Recomendo SIM, padrão ligado (a permissão de push do sistema continua valendo).
4. **Limites:** no máximo 1 mensagem proativa por dia e 4 por semana por aluna? Horário entre 8h e 20h no fuso dela? Confirmar os números.
5. **Mensagens de saúde** (sono ruim, fadiga crescente) no push podem aparecer na tela bloqueada: texto genérico no push e o detalhe só dentro do app? Recomendo SIM.

## 4. Lotes
- **Lote 1 (API, sem build):** biblioteca em código versionado + registro de envio (aluna, regra, canal, enviada/aberta, motivo de não enviar) + preferências por categoria + serviço único (orquestrador) com limite diário/semanal, horário, janela de repetição por regra, frescor do dado e consentimento; reaproveita `notifyUserIfNotRecent` e o push atual. Testes com relógio e banco falsos.
- **Lote 2 (API):** gatilhos operacionais (feedback pendente, atividade sem vínculo, dados do relógio desatualizados, semana disponível, teste de 3 km pendente — escondido hoje por pedido de Elton: só se voltar).
- **Lote 3 (API):** gatilhos personalizados (esforço alto, sono ruim, fadiga crescente, melhora consistente, queda de frequência) lendo os indicadores que o servidor já calcula.
- **Lote 4 (API + app):** mensagens educativas por etapa/plataforma/relógio; tela de preferências no app (PWA no Deploy, nativo no build).
- **Lote 5 (painel):** ver o que foi enviado por aluna, taxa de abertura por regra, desligar uma regra.
- **Riscos:** excesso de mensagens (por isso o orquestrador vem antes de qualquer gatilho), dado de saúde em tela bloqueada, push do iPhone no PWA depende de instalação, texto com tom alarmista. **Ordem:** orquestrador → gatilhos → biblioteca educativa.

## 5. DECISÕES DE ELTON (13/11/2026)
- **Texto por regra** (sem IA no envio) para as mensagens personalizadas.
- **Limite:** por NECESSIDADE, não por cota fixa; mas até **5 por dia** é aceitável (teto).
- **Horário padrão:** 06:00 às 20:00 (fuso da aluna).
- **IDEIA NOVA de Elton (inovadora): seção de PREFERÊNCIAS para a aluna personalizar** — o sistema cria um padrão (teto diário de mensagens, janela de horário, categorias) e a aluna pode GERENCIAR o número e o horário. Entra no Lote 1 como parte do orquestrador (padrão: teto 5/dia, 06:00–20:00; a aluna pode reduzir, mudar o horário e desligar categorias).
- Estado: AINDA NÃO implementado (próximo da fila depois da Evolução).
