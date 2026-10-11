# Health Connect (Android) — contrato técnico

Data: 11/10/2026. Status: implementado e testado em ambiente sintético; **validação em aparelho físico pendente** (seção 7).

## 1. O que é
Canal de entrada de atividades no Android. O Health Connect **não é fabricante nem dispositivo**: é por onde o dado chega. O app que escreveu o registro (Polar Flow, Samsung Health etc.) e o aparelho gravador são camadas **separadas**, preservadas como vieram, nunca presumidas.

## 2. Biblioteca e configuração nativa
- `react-native-health-connect@3.5.3` (compatível com RN 0.81 / React 19.1 / Expo SDK 54) + `expo-health-connect@0.1.1` (config plugin) + `expo-build-properties ~1.0.10`.
- `app.json`: plugins `expo-health-connect` e `expo-build-properties` (minSdk **26**, compile/target 36).
- Permissões Android (somente leitura): `READ_EXERCISE`, `READ_DISTANCE`, `READ_HEART_RATE`. O plugin gera o intent-filter de justificativa (`androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE`) e o alias `ViewPermissionUsageActivity`; a biblioteca declara o `queries` do pacote `com.google.android.apps.healthdata`.
- **Não** pedimos: rota GPS, histórico anterior a 30 dias, acesso em segundo plano, escrita, sono, passos, calorias, peso, nutrição.
- Mudança mínima de Android: minSdk 24 → 26 (exclui só aparelhos Android 7.x; Health Connect exige Android 8+ de qualquer forma). **Exige novo build nativo** (versionCode 11+). Nenhuma mudança de schema/banco.

## 3. Fluxo no app
1. Aluno abre *Dispositivos e integrações → Health Connect* (só aparece no app Android).
2. **Conectar** → Android pede a autorização. Conectado só se a permissão de sessões de exercício foi concedida (distância e FC são opcionais).
3. **Sincronizar agora** (manual, sempre disponível) e automática ao abrir/voltar ao app, com intervalo mínimo de 15 min, **somente se já autorizado**. Nunca pede permissão sozinho. Sem sincronização permanente em segundo plano.
4. **Desconectar** para novas leituras e tenta revogar no Android; **não apaga** histórico já importado. (No Android 14+ a revogação só vale ao reiniciar o app; por isso a leitura também para pela marca local.)
- Estados: Não conectado · Conectado · Sincronizando · Sincronização concluída · Permissões insuficientes · Health Connect indisponível · Erro de sincronização; mostra data/hora da última sincronização bem-sucedida.

## 4. Sincronização
- Primeira vez: janela de 29 dias (limite de 30 do Health Connect sem a permissão de histórico). Depois: relê desde o cursor − 24 h (sobreposição) e envia só o novo/modificado.
- Distância e FC são lidas **apenas da mesma origem (`dataOrigin`) da sessão** e **somente dentro do intervalo da sessão**; registros que atravessam a sessão (ex.: distância diária) nunca entram. Sem dado → `null` (nunca zero inventado).
- O cursor só avança depois que **todos** os lotes (≤ 50) foram aceitos → interrupção reprocessa na vez seguinte.
- Uma execução por aluno por vez (toques repetidos compartilham a mesma execução).

## 5. Backend — `POST /health-connect/exercises` (JWT)
Corpo: `{ exercises: ExercisePayload[] }` (1–50). Usuário **sempre** do token. Resposta: `{ created, updated, alreadyImported, rejected, items[] }`.
- `RawExternalActivity` (payload bruto, `health-connect-exercise-v1`) + `ActivityLog` (`provider='health_connect'`, `externalId` = id do registro). Chave única `(provider, userId, externalId)`.
- Idempotente: igual → `already_imported`; modificado na origem → atualiza o **mesmo** registro e reavalia; versão mais antiga que a gravada (fora de ordem) → ignorada; corrida entre envios → P2002 tratado.
- Depois da gravação, **só os mecanismos existentes**: `PhysicalActivityIdentityService` → `SessionExecutionLinkService` (classificação/reconciliação) → confirmação humana (aluno/treinador) já existente. Nenhuma lógica nova de dedup/classificação; nenhuma notificação; prescrições entregues e feedback nunca alterados; vínculos manuais preservados.

## 6. Origem e deduplicação
`providerMetrics`: `channel`, `source.packageName` (app que escreveu), `device` (só se informado), `recordingMethod` (ativo/automático/manual/null), `hcRecordId`, `clientRecordId`, `lastModifiedTime`, `exerciseType.raw`, `endedAt`, fuso. Polar direto + mesma atividade via Health Connect → duas observações preservadas, **uma execução contada** (ambígua até confirmação existente). Atividades distintas contam as duas.

## 7. Implementação × validação física
| Item | Verificado | Como |
|---|---|---|
| Normalização, ingestão, idempotência, fora de ordem, isolamento, auth | ✅ | testes unitários + PostgreSQL real |
| Dedup com Polar, ambíguo, distintas, links manuais, prescrições/feedback intactos | ✅ | integração PostgreSQL real |
| Orquestrador (permissões, revogação, incremental, interrupção, concorrência) | ✅ | testes com Health Connect **falso** |
| Config nativa (manifest, permissões, minSdk) | ✅ | `expo prebuild` |
| Compila e roda no Android; diálogo real de permissões; leitura real | ⏳ | **precisa de novo build + aparelho** |
| Polar Flow → Health Connect → Panzeri Run (dados e dedup reais) | ⏳ | aparelho real |
| Samsung Health / Galaxy Watch → Health Connect | ⏳ | aparelho real; **não afirmar suporte antes** |
| Revogação no Android 14+, Health Connect desatualizado | ⏳ | aparelho real |

## 8. Google Play (passo manual do Elton)
Antes de publicar: preencher na Play Console o formulário de declaração de **Health Connect** (permissões de leitura de exercício, distância e frequência cardíaca) e conferir a Política de Privacidade (texto jurídico segue pendente de revisão de advogado — não alterado aqui). Texto sugerido para a declaração: "O app lê sessões de exercício, distância e frequência cardíaca do Health Connect, somente com autorização explícita do aluno, para exibir e analisar seus treinos realizados. Não lê nem grava outros dados de saúde, não usa para publicidade e não vende dados. O aluno pode desconectar a qualquer momento."
