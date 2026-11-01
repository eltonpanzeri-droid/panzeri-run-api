# Fila do próximo build e ideias — documento vivo

Criado em 01/11/2026 por ordem de Elton: não gerar build a cada pequena mudança. Aqui ficam (A) o que já foi feito no código e só chega ao aplicativo das lojas (Android/iPhone) no próximo build, e (B) ideias e decisões que ainda não foram implementadas.

**Regra (também no CLAUDE.md e no PRONTUARIO.md):** ao final de toda mudança no código que exige build nativo (qualquer coisa em `apps/mobile`, permissões do `app.json`, módulos nativos), registrar aqui NO MESMO DIA. Ideia discutida e não feita entra na parte B. Quando um build for gerado e enviado, mover os itens da parte A para a parte C com o número do build.

Como saber se precisa de build: o PWA (iPhone pelo Safari e navegador) recebe a mudança no deploy; o app instalado pela loja só recebe com um build novo. Mudança só na API ou no painel NÃO entra aqui.

---

## A. Já feito no código, esperando o próximo build

| Data | O que mudou | Onde (arquivo) | PWA |
|---|---|---|---|
| 01/11/2026 | **Dicas para montar a rotina** na tela de rotina: item 1 (maior parte da disponibilidade para corrida, rotina que consiga cumprir) para todos; item 2 (um dia com cerca de 240 min) só para quem tem prova alvo ativa de 21 km ou mais | `apps/mobile/App.tsx` (`RoutineEditScreen`) | Vale no deploy; aluna precisa reinstalar o ícone para ver |

| 01/11/2026 | **Aviso de uso do ciclo menstrual pela IA** no topo da aba "Ciclo", com o texto de Elton (sem caixa de marcar; "ao registrar, você consente"). Substitui a frase antiga "não altera sua prescrição", que contradizia o servidor | `apps/mobile/App.tsx` (`MenstrualCycleScreen`) | Vale no deploy; aluna reinstala o ícone |

## B. Ideias e decisões ainda NÃO implementadas

| Data | Ideia / decisão | Estado | Observações |
|---|---|---|---|
| 31/10/2026 | Pedir as autorizações de envio de treinos ao relógio e de uso pela IA (Atlas) **na mesma tela da conexão**, em todas as integrações | Decidido por Elton, adiado ("vamos deixar para depois") | Cuidados: caixas desmarcadas, texto/versão/hash por finalidade, revogação independente, o servidor hoje recusa marcar na conexão da Zepp, Zepp exige reconfirmação, levar ao advogado. Ver PRONTUARIO |
| 01/11/2026 | **Polar: sono, HRV/recuperação noturna e atividade diária também devem alimentar a IA** (hoje bloqueados de propósito em `ai-data-eligibility.service.ts`, linha "Polar/Wahoo (23/10/2026)", e o texto de consentimento `polar-health-consent.ts` diz que NÃO vão à IA). Ordem de Elton: "não é para bloquear nada" — regra permanente de receber tudo e usar na prescrição | Decidido por Elton; implementação aguarda o "vai" do plano | Mantém a autorização da aluna (dado de saúde enviado à Anthropic exige consentimento específico, LGPD): a mudança é PEDIR o uso pela IA, não ignorar. Texto novo ⇒ nova versão ⇒ alunas Polar reconfirmam. Wahoo (só atividades) a conferir. Vale no deploy (servidor + PWA); nativo no build |
| 01/11/2026 | Verificar os 180 min fixos que o sistema "empresta" ao dia da prova alvo fora da rotina (`injectTargetRaceDays`) — uma ultra de 56 km passa disso | Investigação interna, sem mudança na tela da aluna | Ver se a IA ou algum validador trata o dia como limitado; diagnóstico e aprovação antes de alterar (prescrição = risco alto) |
| 31/10/2026 | Passo a passo, dentro do app, para ligar o Health Connect no Samsung Health | Pendente | Entra no próximo build |
| 01/11/2026 | **Apple Saúde: pressão arterial, glicemia e ciclo menstrual também alimentam a IA** (hoje fora de `HEALTH_AI_CATEGORIES`; o texto de consentimento v2.x diz que nunca vão à IA). Elton: "vamos fazer isso no nosso próximo build" | **DECIDIDO para o próximo build** (decisão de Elton, 01/11/2026) | Sempre com o consentimento específico da aluna (dado de saúde sensível, LGPD): texto novo ⇒ nova versão ⇒ alunas do Apple Saúde reconfirmam. Parte servidor (texto/regra) vale no deploy; tela do app exige build iOS. Fazer junto com a Polar (linha acima) e a junção das autorizações. Levar ao advogado |
| 01/11/2026 | **Polar: trajeto GPS descartado** (`polar-location-filter.ts`). Motivo original: 1ª versão nas lojas sem declaração de localização. A justificativa provavelmente envelheceu (Health Connect/Apple já têm "percurso" com consentimento) | **ADIADO por Elton (01/11/2026): implementar só quando for muito necessário** (risco de autorização das lojas). Se ele pedir GPS, avisar com o lembrete do CLAUDE.md antes de agir | Conferir antes, se for retomado: se a Polar realmente entrega GPS pelo AccessLink e se a declaração de privacidade da App Store já cobre localização. Contraria a premissa de "coletar tudo" — desvio a corrigir se as lojas permitirem |
| 31/10/2026 | Exigir 18+ no cadastro | Aguarda decisão de Elton | Ligado à revisão do advogado |

## C. Já foi em build (histórico)

- Android 1.0.2 (versionCode 15) e iOS 1.0.2 (compilação 16), gerados em 31/10/2026 e enviados às revisões. Lista completa: `ATUALIZACOES_DESDE_ULTIMO_BUILD.md`.
