# Fila do próximo build e ideias — documento vivo

Criado em 01/11/2026 por ordem de Elton: não gerar build a cada pequena mudança. Aqui ficam (A) o que já foi feito no código e só chega ao aplicativo das lojas (Android/iPhone) no próximo build, e (B) ideias e decisões que ainda não foram implementadas.

**Regra (também no CLAUDE.md e no PRONTUARIO.md):** ao final de toda mudança no código que exige build nativo (qualquer coisa em `apps/mobile`, permissões do `app.json`, módulos nativos), registrar aqui NO MESMO DIA. Ideia discutida e não feita entra na parte B. Quando um build for gerado e enviado, mover os itens da parte A para a parte C com o número do build.

Como saber se precisa de build: o PWA (iPhone pelo Safari e navegador) recebe a mudança no deploy; o app instalado pela loja só recebe com um build novo. Mudança só na API ou no painel NÃO entra aqui.

---

## A. Já feito no código, esperando o próximo build

| Data | O que mudou | Onde (arquivo) | PWA |
|---|---|---|---|
| 01/11/2026 | **Dicas para montar a rotina** na tela de rotina: item 1 (maior parte da disponibilidade para corrida, rotina que consiga cumprir) para todos; item 2 (um dia com cerca de 240 min) só para quem tem prova alvo ativa de 21 km ou mais | `apps/mobile/App.tsx` (`RoutineEditScreen`) | Vale no deploy; aluna precisa reinstalar o ícone para ver |

## B. Ideias e decisões ainda NÃO implementadas

| Data | Ideia / decisão | Estado | Observações |
|---|---|---|---|
| 31/10/2026 | Pedir as autorizações de envio de treinos ao relógio e de uso pela IA (Atlas) **na mesma tela da conexão**, em todas as integrações | Decidido por Elton, adiado ("vamos deixar para depois") | Cuidados: caixas desmarcadas, texto/versão/hash por finalidade, revogação independente, o servidor hoje recusa marcar na conexão da Zepp, Zepp exige reconfirmação, levar ao advogado. Ver PRONTUARIO |
| 01/11/2026 | Verificar os 180 min fixos que o sistema "empresta" ao dia da prova alvo fora da rotina (`injectTargetRaceDays`) — uma ultra de 56 km passa disso | Investigação interna, sem mudança na tela da aluna | Ver se a IA ou algum validador trata o dia como limitado; diagnóstico e aprovação antes de alterar (prescrição = risco alto) |
| 31/10/2026 | Passo a passo, dentro do app, para ligar o Health Connect no Samsung Health | Pendente | Entra no próximo build |
| 31/10/2026 | Exigir 18+ no cadastro | Aguarda decisão de Elton | Ligado à revisão do advogado |

## C. Já foi em build (histórico)

- Android 1.0.2 (versionCode 15) e iOS 1.0.2 (compilação 16), gerados em 31/10/2026 e enviados às revisões. Lista completa: `ATUALIZACOES_DESDE_ULTIMO_BUILD.md`.
