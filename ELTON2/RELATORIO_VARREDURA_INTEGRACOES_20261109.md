# Varredura das integrações (Astra) — resumo guardado em 09/11/2026

Origem: relatório do Astra (ELTON²) entregue por Elton em 09/11/2026, sobre a referência `3920d53`. Documentação oficial consultada em 09/11/2026. Este arquivo é um RESUMO do que o Claude Code leu; o texto integral foi colado na conversa e não está aqui. Nada foi implementado. Cada afirmação abaixo é do Astra (CONFIRMADO / PROVÁVEL / NÃO VERIFICADO conforme ele marcou); o Claude Code NÃO conferiu no código nem na documentação.

## Conclusão do Astra
A maior oportunidade é completar os caminhos que já existem (séries de treino, voltas, recuperação), não criar sistemas novos.

## Lacunas apontadas por integração (ordem de valor)
- **Garmin:** voltas e temperatura são descartadas; `activityFiles` (FIT) não é usado; mapeamento diário não preserva toda a FC oferecida. PROVÁVEL: dinâmica de corrida via FIT.
- **Health Connect:** várias séries são resumidas antes do envio; voltas/segmentos/planejamento sem aproveitamento. Composição corporal e temperatura estão desabilitadas.
- **Apple Saúde:** medidas de treino majoritariamente resumos; séries completas e eventos/voltas não passam por fluxo equivalente.
- **Polar:** não consulta FC contínua, cardio load, SleepWise, Elixir; Nightly Recharge reduzido à HRV.
- **Wahoo:** sem FIT/séries e sem envio de planos.
- **Zepp:** parser FIT limitado (sem voltas); backfill só de atividades; recursos "Upcoming" não verificados.
- **COROS:** faltam estresse, recuperação, avaliação física/VO₂/limiar, carga, wellness check.
- **Strava:** não ampliar (restrito ao próprio aluno, sem IA).
- **Suunto, Google Health (Fitbit), WHOOP, Oura, Withings:** sem conector direto; chegam só por Apple Saúde/Health Connect.

## Bloqueado ou condicionado (mantém as decisões do Elton)
GPS adiado; Health Connect sem calorias totais/SpO₂/respiração/nutrição/hidratação/ciclo (decisão da loja); Apple pressão/glicemia/ciclo na IA dependem de consentimento específico e advogado; Strava nunca na IA; textos de consentimento da Zepp só com versionamento e reconfirmação; "Upcoming/Coming soon" não conta como disponível; não reconstruir scores proprietários.
Regra Android: cada permissão do Health Connect precisa de função visível ao usuário; catalogar tudo, mas só pedir o acesso quando a função existir.

## Riscos de política a conferir (contratos)
- **Garmin (Rev H):** exige transparência sobre IA e restringe treinamento/teste/avaliação/modelos derivados. Conferir o uso do Atlas e a retenção de prompts/resumos contra o contrato.
- **Oura:** dado da API não pode ser entrada de IA; LLM só pelo caminho MCP; exclusão em 72 h. **WHOOP:** restrições a cache e a IA. **Withings:** treinamento de IA só em plano pago específico. **Google Health:** uso limitado às funções informadas.
- **Strava:** restringe combinação/análise e armazenamento persistente; exclusão com confirmação.
- **Fitbit API antiga:** desligamento anunciado para 30/10/2026 (usar Google Health API).

## Armadilhas de qualidade (a preservar em qualquer lote)
HRV não é uma variável só (SDNN Apple × RMSSD Health Connect); cadência com semânticas diferentes; tempo total × em movimento; sono (cama × dormindo × fases, cochilos); fuso e dia atribuído; zero × ausência; duplicidade entre caminhos (Garmin direto, HealthKit, Health Connect); resumos que mudam depois; sensor no relógio ≠ dado na API; manter marca e origem.

## Lotes sugeridos pelo Astra (menor risco → maior)
1 Garmin JSON (voltas, temperatura, FC diária) · 2 Apple/Health Connect (séries/detalhes já autorizados) · 3 Polar (FC contínua, cardio load, Nightly Recharge, SleepWise) · 4 Wahoo FIT · 5 COROS (recuperação, carga, avaliação, estresse) · 6 Zepp (FIT completo, backfill de saúde) · 7 Novos conectores, um por vez (Suunto, Google Health, Withings) · 8 Oura/WHOOP só após fechar contrato · Separado: envio de treinos ao relógio.

## Perguntas abertas (Elton / advogado)
Nível Garmin e suplementos contratuais aprovados; Atlas e retenção de prompts frente à Garmin; só inferência ou também treinamento/avaliação de modelos; quais marcas novas têm alunas suficientes; condições comerciais aceitáveis (Suunto, WHOOP, Oura, Withings); fluxo autorizado dos dados Apple sensíveis.

## Estado
Nenhum lote autorizado. Implementar só com ordem do Elton, um lote por vez.
