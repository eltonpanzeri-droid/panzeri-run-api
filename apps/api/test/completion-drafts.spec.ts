import { readFileSync } from 'fs';
import { join } from 'path';
import { COMPLETION_DRAFT_MAX_AGE_MS, completionDraftKey, packCompletionDraft, unpackCompletionDraft } from '../../mobile/src/completionDrafts';

// 04/11/2026 — bug real de uma aluna: ao tocar em "Relatar dor em detalhes" no feedback do treino, o app trocava de aba, o formulario era desmontado, nao havia como voltar e o feedback longo se perdia.
const app = readFileSync(join(__dirname, '..', '..', 'mobile', 'App.tsx'), 'utf8');

describe('rascunho do feedback do treino (parte pura)', () => {
  const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);
  const draft = { status: 'done', perceivedEffort: '7', painFlag: 'leve', notes: 'dor no joelho depois de 3 km' };

  it('guarda e devolve o mesmo rascunho', () => {
    expect(unpackCompletionDraft(packCompletionDraft(draft, NOW), NOW + 60_000)).toEqual(draft);
  });

  it('chave por sessao e versionada', () => {
    expect(completionDraftKey('abc')).toBe('panzeri:completionDraft:v1:abc');
    expect(completionDraftKey('abc')).not.toBe(completionDraftKey('abd'));
  });

  it('descarta rascunho com mais de 14 dias, de data futura, corrompido ou vazio (nunca lanca erro)', () => {
    expect(unpackCompletionDraft(packCompletionDraft(draft, NOW), NOW + COMPLETION_DRAFT_MAX_AGE_MS + 1)).toBeNull();
    expect(unpackCompletionDraft(packCompletionDraft(draft, NOW), NOW + COMPLETION_DRAFT_MAX_AGE_MS)).toEqual(draft);
    expect(unpackCompletionDraft(packCompletionDraft(draft, NOW + 10_000), NOW)).toBeNull();
    expect(unpackCompletionDraft('isto nao e json', NOW)).toBeNull();
    expect(unpackCompletionDraft('{"savedAt":"x","draft":{}}', NOW)).toBeNull();
    expect(unpackCompletionDraft('{"savedAt":1,"draft":[1,2]}', NOW)).toBeNull();
    expect(unpackCompletionDraft(null, NOW)).toBeNull();
    expect(unpackCompletionDraft('', NOW)).toBeNull();
  });
});

describe('ligacao no app (feedback do treino e relato de dor)', () => {
  it('o feedback ainda nao enviado e restaurado e persistido, so para sessoes sem feedback enviado', () => {
    expect(app).toContain("import { clearCompletionDraft, persistCompletionDraft, restoreCompletionDrafts } from './src/completionDraftsStorage'");
    expect(app).toContain('filter((item) => !item.completion).map((item) => item.id)');
    expect(app).toContain('setCompletionDrafts((current) => ({ ...restored, ...current }))'); // o que a aluna ja digitou nesta tela nunca e sobrescrito pelo restaurado
    expect(app).toContain('dirtyDraftIds.current.add(session.id)');
    expect(app).toContain('void persistCompletionDraft(id, draft)');
  });

  it('o rascunho e apagado quando o feedback e enviado com sucesso', () => {
    expect(app).toContain('void clearCompletionDraft(session.id)');
    expect(app).toContain('dirtyDraftIds.current.delete(session.id)');
  });

  it('"Relatar dor em detalhes" volta ao feedback: botao "Voltar ao feedback do treino" e retorno automatico ao enviar', () => {
    expect(app).toContain("onOpenPainReport={() => { setPainReportFromFeedback(true); setActiveTab('painReport'); }}");
    expect(app).toContain("onBack={painReportFromFeedback ? () => { setPainReportFromFeedback(false); setActiveTab('week'); } : undefined}");
    expect(app).toContain('← Voltar ao feedback do treino');
    expect(app).toContain('if (onBack) setTimeout(onBack, 1500)');
  });

  it('o menu continua abrindo o relato de dor sem botao de voltar (so aparece quando veio do feedback)', () => {
    expect(app).toContain("{ id: 'painReport', label: 'Relatar dor', icon: 'medkit' }");
    expect(app).toContain('onBack?: () => void');
  });
});
