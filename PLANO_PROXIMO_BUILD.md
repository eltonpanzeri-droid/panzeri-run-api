# Plano do próximo build (Android + iPhone) — consolidado em 03/11/2026

Juntado a partir do `PRONTUARIO.md` (Diário e "Backlog do próximo build"), de `FILA_PROXIMO_BUILD_E_IDEIAS.md` (partes A e B), de `ATUALIZACOES_DESDE_ULTIMO_BUILD.md` e das decisões de Elton em conversa. **Este é um NOVO build (versão 1.0.3). Não é reenvio da versão 15.** Nenhum build é gerado sem Elton mandar; antes de gerar, conferir esta lista e avisar o que ficaria de fora.

## 0. Estado das lojas (03/11/2026)
- **Google Play:** a versão 15 (1.0.2) foi **RECUSADA em 2/11**. Motivos: (1) "Acesso excessivo a dados (escopo mínimo) do Health Connect" e (2) login da declaração inválido, o revisor não conseguiu avaliar o app.
- **Apple:** 1.0.2 (compilação 16) foi enviada à revisão em 31/10; resultado não registrado aqui.
- **Versão:** `app.json` está em 1.0.2. O novo build sobe para **1.0.3**. Números de build: o EAS soma sozinho.

## 1. LOTE 1 — Resolver o Google (decidido por Elton em 03/11/2026)
Decisões: **não** pedir o ciclo menstrual no Android. **Tirar** saturação de oxigênio, frequência respiratória, hidratação (sai junto com nutrição: mesmo grupo) e calorias totais. **Manter** VO₂ máx.

| Item | Onde | Estado |
|---|---|---|
| Tirar 5 permissões do manifesto: `READ_OXYGEN_SATURATION`, `READ_RESPIRATORY_RATE`, `READ_NUTRITION`, `READ_HYDRATION`, `READ_TOTAL_CALORIES_BURNED` | `apps/mobile/app.json` | ver Diário de 03/11 |
| App deixa de pedir esses tipos ao Android | `apps/mobile/src/healthConnect/categories.ts` | idem |
| Texto de consentimento do Health Connect v1.4 (grupos "Saturação, temperatura da pele e respiração" e "Nutrição e hidratação" saem) e Política | `health-connect-consent.ts`, `legal-content.ts` | idem. **Efeito:** quem já autorizou o Health Connect precisa reconfirmar (o texto mudou) |
| Teste-guarda: toda permissão do manifesto tem tipo pedido pelo app e vice-versa | `apps/api/test/` | idem |
| Declaração do Play Console atualizada | Play Console (Elton) | **depois do build**, tirando as mesmas linhas; ver `HEALTH_CONNECT_PLAY_CONSOLE.md` |
| **Login válido na declaração** | Play Console (Elton) | Conta `revisao-google-...` criada por comando novo (`seed-google`), com acesso ativo e 35 dias de dados sintéticos de recuperação (código pronto em 03/11; falta deploy e Elton rodar o comando). **Elton** testa o login no app Android da loja e só então cola e-mail e senha na declaração. Credencial nunca vai ao chat nem ao código |

## 2. LOTE 2 — Já no código, só chega ao app instalado com este build (FILA, parte A)
Evolução da aluna em seis áreas (lotes 1 a 8), Dor, resposta à carga, sono do relógio, desacoplamento da FC, aguda × crônica, "O que isso representa", janela de rotina × programa, cartão "Sua rotina mudou", excluir ou ignorar atividade, botão "Adicionar como parte deste treino", dicas de rotina, aviso do ciclo na aba Ciclo, versão do app no menu, cartão único da Polar. Mais o que já estava pendente de 29–31/10: módulo Swift do Apple Saúde (FC por treino), Testes físicos no nativo, conciliação de atividades, tela COROS, tela do código de recuperação de senha.

## 2b. LOTE 2b — Apple Watch / Apple Saúde (06/11/2026): JÁ NO CÓDIGO, exige build iOS
- Cartão "Envio de treinos ao Apple Watch" em Dispositivos > Apple Watch: caixa "Autorizo o envio de treinos ao Apple Watch" + botão "Sincronizar envio de treinos ao relógio"; o botão "Enviar ao Apple Watch" saiu do card de cada treino.
- Envio automático dos treinos dos próximos 7 dias ao abrir o Panzeri Run (só com a autorização marcada).
- (API, sem build) Esteira = corrida no envio ao relógio; push de feedback pendente quando o treino sincronizado chega.

## 3. LOTE 3 — Decidido para o build, AINDA SEM código (implementar em lotes pequenos)
1. **Juntar a autorização do relógio e a da IA (Atlas) na tela de conexão** (Zepp, COROS, Health Connect, Polar, Wahoo). Caixas desmarcadas, texto/versão/hash por finalidade; Zepp exige reconfirmação; advogado.
2. **Aceite do ciclo menstrual do próprio app** (caixa + registro com versão/hash e data); sem aceite, o ciclo NÃO vai à IA (filtro no servidor em `getAgentContext`). Substitui o aviso só de texto. Advogado.
3. **Apple Saúde: pressão arterial, glicemia e ciclo também alimentam a IA**, só com consentimento específico (texto novo, nova versão, reconfirmação). O app do iPhone já pede o grupo "Ciclo menstrual". Advogado.
4. **Passo a passo, dentro do app, para ligar o Health Connect no Samsung Health.**
5. **A verificar antes de implementar:** (a) cartão simples do Apple Saúde (Autorizar, Sincronizar, confirmação) e desligar `appleHealthProof`, decisão de 27/10, não sei se já foi feito; (b) regra "toda integração envia o treino ao relógio" (Zepp tem o cartão "Treinos no relógio"; conferir as demais).
6. **Teste em aparelho:** leitura em segundo plano do Health Connect nunca foi testada com dado real; avisar Elton quando o 1º dado chegar.
7. **Apple Saúde: ler a série de FC e distância ao longo do treino** (gráfico de ritmo, FC e cadência, inclusive esteira; ritmo vem da diferença de distância). Antes: conferir no app Saúde se a distância tem vários pontos. Revisar texto de consentimento (advogado).
8. **⚠ Texto legal do envio ao Apple Watch (OBRIGATÓRIO antes do build iOS):** o texto atual diz que o envio só acontece quando a aluna toca; com envio automático ao abrir isso fica falso. Ajustar, nova versão legal, reconfirmação, advogado.
9. **Depois do build:** atualizar o texto do cartão "Apple Watch" do catálogo (servidor).

## 4. NÃO entra neste build
- **Ciclo menstrual no Health Connect (Android)**: só depois de o Google aprovar, com função visível na tela Ciclo e nova declaração.
- **GPS (percurso)**: adiado por Elton. Se ele pedir, avisar antes com a frase do lembrete.
- **Exigir 18+ no cadastro**, **Garmin**: aguardam decisão. Garmin segue "Indisponível".
- **Só API/painel (deploy, sem build):** alerta gentil de volume extra, relatório do ciclo por fase, cortes de custo, pesquisa sobre o raciocínio da IA.

## 5. Antes de gerar o build (checklist)
1. API em produção com o texto novo do Health Connect (deploy primeiro).
2. `tsc`, lint e testes verdes; revisão independente do que mexe em permissão e saúde.
3. Login do revisor do Google testado por Elton.
4. `app.json` para 1.0.3.
5. **Enviar a Elton a LISTA COMPLETA registrada para este build (regra do CLAUDE.md, "Regra de build")**, item por item; avisar o que ficaria de fora; só então gerar. Depois do build: atualizar a declaração do Google e reenviar.

## 6. Pontos para o advogado (acumulados)
Texto do Health Connect v1.4; aceite do ciclo; Apple Saúde (pressão, glicemia e ciclo) para a IA; junção das autorizações; dado do Health Connect com origem Strava; Termos e Política em geral; texto do envio de treinos ao Apple Watch (envio automático) e leitura da série do Apple Saúde.
