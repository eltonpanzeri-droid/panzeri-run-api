# Panzeri Run — Lista de iniciativas

> Documento vivo. Atualizado em 2026-09-10.  
> Sem ordem de prioridade — apenas o inventário completo do que foi pensado e ainda não foi feito.

---

## Produto mobile (aluno)

- Cards instagramáveis — aluno gera um card com seus dados (km, sequência, prova concluída) para compartilhar no Instagram/WhatsApp; começar com 1 card de semana concluída bem feito antes de criar vários
- Treino extra visível no calendário de treinos (já aparece na evolução, falta aparecer nas bolinhas do calendário)
- Prontuário emocional / mapa mental — ~10 perguntas rápidas diárias sobre estado do aluno (energia, humor, sono, estresse); linha do tempo psicológica correlacionada com desempenho
- Dados do ciclo menstrual — campo de fase do ciclo, IA usa no contexto para adaptar tom e volume; base para correlações futuras
- Pergunta de "postura de risco" na entrevista — quanto o aluno quer ser desafiado vs. protegido (Elton pediu para entender melhor antes de finalizar)
- Corrigir entrevista: `important_injury` não pergunta há quanto tempo a lesão foi (3 semanas ≠ 5 anos)
- Corrigir entrevista: piso de 1km nas rodas de `longest_distance`/`weekly_running_km` mascara quem não consegue nem 1km
- Corrigir entrevista: `training_consistency` classificada no módulo "Treinamento de força" sendo que é uma pergunta genérica

---

## Produto admin (treinador)

- Dashboard de evolução agregado no painel — aderência, notas de check-in, satisfação por sessão (dados já existem, falta a visualização)
- Novos campos de coleta no painel vinculados à revisão jurídica — streaks, ciclo menstrual, dados de saúde adicionais

---

## Agentes de IA / arquitetura

- Revisor independente de treinos ("Hipótese de Trabalho") — segundo agente que avalia o raciocínio do agente de prescrição sem ser fiscal de checklist; detalhes em `PROPOSTA_HARNESS_AGENTES.md`
- Elicitação de metodologia Elton Panzeri — ainda em andamento; próximas rodadas: fortalecimento, saúde/dor/lesão, uso concreto de dados do Strava, como satisfação do aluno deve influenciar prescrição
- `MAX_CONCURRENT_AI_CALLS` — pode ser baixo demais com 1000+ assinantes; checar limite real da conta Anthropic antes de ajustar
- Push de notificação em lote (Expo aceita 100 por vez) e N+1 no cron diário — identificados, não corrigidos; baixo impacto hoje, alto impacto em escala

---

## Integrações externas

- Strava — solicitar aumento de limite (>10 atletas); reprovado uma vez; próxima tentativa requer: URL pública da política de privacidade com revisão jurídica, consentimento granular, fluxo de revogação/deleção documentado, e rever se o uso de dados em IA está em conformidade com os termos deles
- Garmin — API aberta; documentação criada em `integracoes/garmin/`; sem implementação
- Polar — API aberta; documentação criada em `integracoes/polar/`; sem implementação
- Apple Watch / HealthKit — documentação criada em `integracoes/apple-watch/`; sem implementação
- COROS / Amazfit — documentação criada em `integracoes/`; sem implementação
- Panz Fit — deep link já existe; integração real de dados (treino gerado aqui → executado lá → dados voltam) ainda não feita

---

## Lojas de aplicativo

- Play Store — completar lista de 12 testadores (faltam ~7 externos), aguardar 14 dias corridos, depois publicar em Produção
- Play Store — novo build de produção Android com a chave do RevenueCat (a versão publicada foi gerada antes da chave existir)
- App Store (iOS) — retomar; produto de assinatura mensal (`panzeri_run_mensal`) ainda não importado no RevenueCat para iOS; primeira submissão exige build de produção junto
- RevenueCat iOS — importar produto real, anexar ao entitlement `panzeri_run_pro`, adicionar ao pacote "Monthly"

---

## Segurança e dados

- Revisão de segurança de dados pessoais — criptografia em trânsito e em repouso, controle de acesso, auditoria de endpoints que expõem dados de saúde e respostas de entrevista
- Revisão jurídica por advogado — Termos de Uso e Política de Privacidade com foco em LGPD, coleta de dados de saúde e dados de ciclo menstrual (sensível, exige atenção especial)

---

## Infraestrutura e operações

- Script de diff determinístico antes de sincronizar — 3 arquivos que só existiam num lado causaram 3 quebras de build reais; proposta em `PROPOSTA_HARNESS_AGENTES.md`, ainda não implementada
- GitHub Desktop apontando direto para o diretório real de edição — elimina a necessidade de copiar arquivos manualmente a cada sessão
- Inventário de rotina (script SQL v3) — produzido e aprovado pelo Dr. Vanzão, mas nunca executado em produção; requer ambiente isolado (réplica ou backup) e aprovação explícita

---

## Crescimento e marketing

- Site institucional — landing page com proposta de valor, depoimentos reais, CTA de cadastro
- Página de vendas — apresentação dos planos, FAQ, prova social
- Estratégia de Instagram — conteúdo recorrente; os cards instagramáveis alimentam esse canal organicamente
- Rede social interna estilo Strava — feed de atividades entre alunos, rankings semanais, desafios; requer massa crítica (pelo menos 50 alunos ativos para ser interessante)

---

## Financeiro

- Melhoria da gestão financeira — histórico de cobranças mais claro para o treinador, fluxo de cancelamento/reativação com menos atrito, alertas proativos com ação sugerida

---

## Plataforma (longo prazo)

- Multi-treinador — outros coaches usando o Panzeri Run como plataforma; requer isolamento de dados, painel por treinador, modelo de precificação B2B
- Marketplace de metodologias — treinadores parceiros publicam seus próprios protocolos dentro da plataforma
