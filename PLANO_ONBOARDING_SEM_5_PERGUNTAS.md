# Frente 5 — Onboarding sem as 5 perguntas rápidas: auditoria e plano (13/11/2026)

> **Estado: AUDITORIA FEITA. NENHUM CÓDIGO ALTERADO. Aguarda decisões de Elton (seção "Decisões").** Risco ALTO (fonte compartilhada `interview.answers`, funil, regra de pagamento).

## 1. O que são as "5 perguntas" hoje (`quickIntakeQuestions`, `apps/mobile/App.tsx`)
Obrigatórias para concluir (`MeService.completeQuickIntake`): `objective`, `quick_current_stage`, `quick_has_target_race`, `quick_main_barrier`, `quick_expectations` (+ condicionais `ultra_distance_km`, `quick_target_race_name`, `quick_target_race_date`).

| # | Pergunta (chave) | Existe parecida na entrevista completa? | Proposta (regra de Elton) |
|---|---|---|---|
| 1 | Principal objetivo (`objective`, + `ultra_distance_km`) | **SIM, é a MESMA chave**: a entrevista completa já tem e só pula por já estar respondida | Nada a realocar: ao sair do pré-pagamento, a entrevista completa passa a perguntar. Sem perda, sem duplicata |
| 2 | Relação atual com a corrida (`quick_current_stage`, 5 opções de "não consigo correr contínuo" a "treino para provas") | **PARECIDA**: `running_experience` ("qual opção melhor descreve sua experiência com corrida") e `fitness_self_rating` | **Excluir** (confirmar com Elton que as duas bastam) |
| 3 | Tem prova alvo? nome? data? (`quick_has_target_race`, `quick_target_race_name`, `quick_target_race_date`) | A entrevista completa NÃO pergunta prova; existe a funcionalidade **Provas alvo** (TargetRace, com cidade/UF/horário). Nenhum código lê essas 3 chaves além do resumo pré-pagamento | **Excluir** e usar só "Provas alvo" (decisão de Elton: ou perguntar na entrevista) |
| 4 | O que pode dificultar a evolução (`quick_main_barrier`, múltipla) | **NÃO** | **Realocar** para a entrevista completa (módulo "Dificuldades") |
| 5 | O que espera de nós (`quick_expectations`, múltipla) | **NÃO** | **Realocar** para a entrevista completa |

## 2. Consumidores (quem lê) e escritas (quem grava)
- **Escrita:** `saveOnboardingAnswer` grava no JSON `OnboardingInterview.answers`; `completeQuickIntake` grava `quickIntakeCompletedAt` e avisa o Telegram ("Aluno respondeu as 5 perguntas iniciais").
- **`quickIntakeCompletedAt` é o MARCADOR DO FUNIL**, lido em: roteamento do app (`App.tsx` ~1802: sem marco → abre as 5 perguntas; com marco → cobrança), `coach.service.ts` (etapa do prospecto signup/interview/checkout; gráfico "Responderam as perguntas iniciais" do painel; série do funil), `prospect-nurture.service.ts` e `prospect-level.ts` (e-mails de recuperação e "temperatura"), conta de revisão da Apple (`review-accounts.ts`).
- **Respostas na IA:** a IA recebe o bloco `interview:answers` inteiro (`prescription-trace.ts`); nenhuma chave `quick_*` é lida por nome no servidor além da validação acima.
- **Tela de resumo pré-pagamento** (`buildQuickIntakeSummary`) monta a mensagem personalizada com objetivo, prova, dificuldades e expectativas: perde o conteúdo se as perguntas saírem.
- **Compatibilidade:** os aplicativos nativos já publicados (1.0.3/1.0.4) continuam mostrando as 5 perguntas e chamando `completeQuickIntake`. O servidor DEVE continuar aceitando os dois fluxos até as lojas atualizarem. PWA muda no Deploy do app; nativos só no build.

## 3. Decisões que dependem de Elton
1. **Nova ordem:** (A) cadastro → pagamento → entrevista completa (objetivo passa a ser a 1ª pergunta da entrevista) ou (B) manter um passo mínimo antes do pagamento? Recomendo A.
2. **Marcador do funil:** o que substitui "respondeu as perguntas iniciais" no painel, nos e-mails de recuperação e na "temperatura" (ex.: "cobrança gerada" ou "entrevista iniciada")?
3. **Resumo pré-pagamento:** remover, ou trocar por uma mensagem fixa sem as respostas?
4. **Telegram "respondeu as 5 perguntas":** remover ou trocar por aviso de "cadastro novo" / "entrevista concluída"?
5. **Quem está no meio do fluxo:** tratar `quickIntakeCompletedAt` pendente como concluído (as respostas já dadas ficam preservadas, nunca apagadas).
6. Confirmar as exclusões 2 e 3 e as realocações 4 e 5.

## 4. Plano de implementação (depois das decisões), em lotes pequenos e reversíveis
- **Lote 1 (API, sem build):** aceitar entrevista/pagamento sem `quickIntakeCompletedAt`; novo marcador do funil; manter `completeQuickIntake` e a regra antiga (compatibilidade com os nativos).
- **Lote 2 (app):** retirar a tela das 5 perguntas do roteamento; mover barreira e expectativa para a entrevista completa; ajustar resumo e Telegram. PWA no Deploy; nativos no próximo build.
- **Lote 3 (painel/relatórios):** ajustar gráfico do funil, nutrição de prospectos e "temperatura".
- **Rollback:** reativar o roteamento antigo (código das 5 perguntas fica no arquivo, desligado); dados nunca apagados.
- **Testes:** fluxo completo executado (cadastro → pagamento → entrevista) com banco falso; regressão do funil; compatibilidade do nativo antigo (`completeQuickIntake` ainda funciona). Histórico de bug de "tela de pagamento falso-positivo": checar a regra de pagamento em cada lote.
