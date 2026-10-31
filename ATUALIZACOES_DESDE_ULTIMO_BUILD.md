# Atualizações desde o último build das lojas (29/10/2026 → 31/10/2026)

Montado em 31/10/2026 a partir do histórico do Git (cada linha tem o commit para conferir), não de memória.
Marcos: **Android 13 = commit `382e8e4` (29/10 11:19)**, **iOS 1.0.1 compilação 15 = commit `87cdc4d` (29/10 12:42)**.

Legenda do que chega ao aluno:
- **PWA/servidor** = vale no deploy (o aluno do PWA só vê depois de reinstalar o ícone).
- **BUILD** = só chega ao aplicativo nativo (Android/iPhone) com o próximo build.
- **Painel** = só o treinador vê (deploy do painel).

**Estado das lojas:** Apple ACEITOU a 1.0.1 (compilação 15). O Google REJEITOU o Android 13 (Health Connect, "acesso mínimo").

---

## 1. Para a aluna (tela do app / PWA)

| Novidade | Commit | Onde chega |
|---|---|---|
| **Testes físicos completos**: 3 km com Daniels, avaliações, ergoespirometria, seis zonas (ritmo e km/h), card de uso, explicação em dropdown, evolução, lembrete de reavaliação (lembretes seguem DESLIGADOS) | 8819060, c18790b, ddb26be, 9596713, 467300c, 28d3a57, fa0279a, 1a0a028, f1f4242, 92276ff, 99dfe92 | PWA/servidor já; **BUILD** para o nativo (liberado em todas as plataformas em 31/10) |
| **Conciliação de atividades**: vínculo livre com aviso, feedback preservado, partes, relatório | 63955b3 | PWA/servidor; **BUILD** |
| **Minha recuperação**: sem composição corporal; cartão "Gasto energético total do dia"; seção "Dados que não chegaram" (qualquer marca, por evidência) | 539382e, 3930b32, 61ee165 | PWA/servidor; **BUILD** |
| **Detalhe do treino**: calorias do treino do Health Connect; aviso quando a FC chegou mas cadência/potência/elevação não | 3930b32, 61ee165 | PWA/servidor; **BUILD** |
| **Zepp**: convite na tela de Treinos para autorizar o envio de treinos ao relógio | 9042c3b | PWA/servidor; **BUILD** |
| **Dispositivos e integrações**: roteiro padrão de integração (Samsung e COROS primeiro) | 4f33a58 | PWA/servidor; **BUILD** |
| **COROS**: tela de conexão, importação de atividades, envio de treinos ao relógio, e importação de sono/HRV/FC de repouso/saúde diária | aed99f9, 7b9de12, 5582bc6 | PWA/servidor (só quem estiver liberado; sem aluna para validar); **BUILD** |
| **Strava fechado a novos alunos**; Apple sem selo de validação; campo de senha sem autocorreção | c866da8 | PWA/servidor; **BUILD** |
| **Login**: limite de tentativas não compartilhado entre alunos (confirmado em produção) | 2e62124 | servidor (já no ar) |
| **Recuperação de senha por código de 6 dígitos no e-mail** (confirmado por Elton: funcionou) | ae8f323 | servidor + PWA (já no ar); **BUILD** para a tela do código no nativo |
| **Privacidade**: texto geral reorganizado, idade mínima 18+ nas declarações, declarações das lojas | e0eba63 | servidor (política) — ⚠ ver pendência 18+ abaixo |
| **Acentuação correta** na exibição de textos | 80bb6c9 | PWA/servidor; **BUILD** |
| **Apple Saúde**: lê a FC do intervalo do treino quando o treino não traz estatística própria (altera o módulo Swift) | 99c0736 | **BUILD iOS obrigatório** |

## 2. Para o treinador (painel)

| Novidade | Commit |
|---|---|
| Apple Saúde por grupo e no painel de Saúde e recuperação | 80bb6c9, 7c667d6 |
| COROS no painel e IA liberada para COROS | aed99f9 |
| Funil de links: cliques em links que vão direto para as lojas e correção de contagem | cbeeb19, e5a873a |
| Validação do desconto de cupom no sandbox do Asaas | b09e38c |
| Testes físicos na IA, no Gerente Técnico, na Evolução e no resumo do atleta | ddb26be, 9596713, 467300c |

## 3. Decisões e registros de 30–31/10 (sem código novo, mas valem)

- Toda integração envia o treino ao relógio quando o fabricante permite (impossível na Samsung, limite deles) — d54906d
- Zepp: tela de consentimento mantida como está; não mudar texto (nova versão obriga reconfirmar) — 0950d4f
- COROS e Samsung: **sem aluna para validar**; Elton usa Polar Pacer Pro + iPhone 12
- Calorias totais **de volta** (REDs) e nutrição/hidratação **ficam**; composição corporal continua fora
- Declaração de saúde e justificativas do Health Connect já preenchidas no Play Console (a68245e, `PLAY_CONSOLE_HEALTH_CONNECT_JUSTIFICATIVAS.md`); **só enviar depois do build Android novo**
- Versão do app: **1.0.2** (Android e iOS); números de build o EAS soma sozinho

## 4. O que o build novo precisa para ser aceito

- **Android:** permissões do `app.json` coerentes com a declaração do Play Console (sem composição corporal, com calorias totais). Enviar o `.aab` manualmente (falta a chave de conta de serviço no EAS).
- **iPhone:** versão **1.0.2** (a 1.0.1 está fechada) + módulo Swift atualizado (99c0736).

## 5. Pendências que continuam abertas

- Revisão do advogado nos Termos e na Política (lembrete ativo). Decisão **18+ no cadastro** ainda sem resolver (o texto de privacidade já cita 18+).
- COROS e Samsung sem validação real; leitura em segundo plano do Health Connect nunca testada em aparelho.
- Texto do catálogo da Samsung ainda promete mais do que ela envia (HRV/FC de repouso) — aguardando "vai".
- Zepp: envio de dado Zepp real à Anthropic segue BLOQUEADO até revisão jurídica e autorização expressa.
- **Decidido em 31/10, ainda sem código (Elton: "deixar para depois"):** pedir, na MESMA tela da conexão e em todas as integrações, as autorizações de envio de treinos ao relógio e de uso pela IA. Hoje ficam em telas separadas depois de conectar. Detalhes e cuidados no Prontuário (seção do backlog).
