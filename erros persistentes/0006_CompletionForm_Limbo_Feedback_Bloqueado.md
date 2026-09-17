# 0006 — CompletionForm: treino em limbo por feedback obrigatório

**Status:** RESOLVIDO (17/09/2026)

---

## Padrão de falha

Aluna preenche distância, duração, status do treino — mas não rola a tela até o fim para responder as 9 perguntas de feedback. Aperta "Confirmar treino e enviar feedback" mas o botão está desabilitado. A aluna acha que salvou. O treinador não vê nada no painel. O treino fica em limbo: registrado no celular (estado local), inexistente no servidor.

---

## Histórico de rodadas

### Rodada 1 — 07/09/2026
**Diagnóstico:** `allSectionsComplete` exige 9 campos para habilitar o botão em QUALQUER situação.  
**Correção:** Adicionado `isSavedOnServer ||` para liberar edições de registros antigos sem campos v1.  
**Resultado:** Fix parcial — atualizações liberadas, mas primeira vez ainda bloqueada.

### Rodada 2 — 16-17/09/2026
**Diagnóstico:** Luiza reporta "Deu não / Sai e entrei de novo" (18:32 do dia 17/09). Ela estava fazendo PRIMEIRA vez (isSavedOnServer=false), que ainda exigia todos os 9 campos.  
**Correção:** Removido `allSectionsComplete` completamente como gate do botão. Botão desabilitado APENAS durante `isSubmitting`. Hint text mantido como incentivo visual (não mais bloqueio).  
**Resultado:** RESOLVIDO — API já aceitava campos opcionais (todos `@IsOptional()` no DTO); o bloqueio era 100% client-side.

---

## Causa raiz

Decisão de design de 12/09: "formulário único — validação conjunta de todos os campos para habilitar o botão". Premissa incorreta: a API não requer todos os campos, mas o app os exigia. Resultado: janela de falha silenciosa onde aluna pensa ter salvo mas o servidor nunca recebeu nada.

---

## Aprendizado sistêmico

**Regra permanente:** Nunca bloquear o salvamento client-side com validação que vai além do que o servidor exige. Se o servidor aceita o campo como opcional, o app também deve aceitar. Validação client-side de campos opcionais = UI gate que nunca deveria existir.

**Sinal de alerta:** Sempre que um botão de "Salvar" estiver disabled, perguntar: "O servidor rejeitaria esta requisição?" Se não, o botão não deveria estar disabled.

---

## Arquivos alterados

- `apps/mobile/App.tsx` — removido `(draft.status !== 'missed' && !allSectionsComplete)` da condição `disabled` do botão; hint text atualizado para "opcional para salvar"
