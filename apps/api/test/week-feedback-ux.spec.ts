import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { targetScrollY } from '../../mobile/src/appScroll';
import { FEEDBACK_BADGE_TEXT, feedbackBadge } from '../../mobile/src/feedbackStatus';
import { availableSheetHeight, coveredByKeyboard } from '../../mobile/src/keyboardLayout';

// 09/11/2026 (Elton): (1) "Completar antes" leva ao treino sem feedback; (2) cartoes mostram feedback pendente/enviado; (3) o teclado nao cobre mais o campo do check-in.
describe('aviso de feedback no cartao do treino', () => {
  it('realizado sem esforco percebido = pendente; com esforco = enviado', () => {
    expect(feedbackBadge({ hasRealized: true, isAlternative: false, completion: null })).toBe('pending');
    expect(feedbackBadge({ hasRealized: true, isAlternative: false, completion: { status: 'done', perceivedEffort: null } })).toBe('pending');
    expect(feedbackBadge({ hasRealized: true, isAlternative: false, completion: { status: 'done', perceivedEffort: 6 } })).toBe('done');
    expect(feedbackBadge({ hasRealized: false, isAlternative: false, completion: { status: 'adjusted', perceivedEffort: 4 } })).toBe('done');
  });
  it('nao cobra feedback de treino nao feito, nao realizado nem de atividade alternativa (tem texto proprio)', () => {
    expect(feedbackBadge({ hasRealized: false, isAlternative: false, completion: null })).toBeNull();
    expect(feedbackBadge({ hasRealized: false, isAlternative: false, completion: { status: 'missed', perceivedEffort: null } })).toBeNull();
    expect(feedbackBadge({ hasRealized: true, isAlternative: true, completion: null })).toBeNull();
  });
  it('textos claros, sem termos proibidos', () => {
    expect(FEEDBACK_BADGE_TEXT.pending).toContain('Feedback pendente');
    expect(FEEDBACK_BADGE_TEXT.done).toContain('Feedback enviado');
    expect(`${FEEDBACK_BADGE_TEXT.pending} ${FEEDBACK_BADGE_TEXT.done}`).not.toMatch(/motor|plano de treino/i);
  });
});

describe('teclado e folha do check-in', () => {
  it('a folha encolhe para caber acima do teclado, com minimo para o campo continuar visivel', () => {
    expect(availableSheetHeight(800, 330, 100)).toBe(358); // 800 - 330 - 100 - 12
    expect(availableSheetHeight(500, 400, 100)).toBe(200); // minimo
  });
  it('na web, o teclado e a diferenca entre a janela e o visualViewport (ignora variacoes pequenas)', () => {
    expect(coveredByKeyboard(800, 470, 0)).toBe(330);
    expect(coveredByKeyboard(800, 780, 0)).toBe(0); // barra do navegador, nao teclado
    expect(coveredByKeyboard(800, 470, 40)).toBe(290);
  });
});

describe('rolagem ate o cartao', () => {
  it('posicao = rolagem atual + (topo do cartao - topo da area rolavel) - folga, nunca negativa', () => {
    expect(targetScrollY(300, 100, 700)).toBe(888); // 300 + 600 - 12
    expect(targetScrollY(0, 100, 105)).toBe(0);
  });
});

describe('ligacao no App', () => {
  const app = readFileSync(join(__dirname, '..', '..', 'mobile', 'App.tsx'), 'utf8');
  it('"Completar antes" leva ao treino pendente (nativo e web) e a lista vem do status do check-in', () => {
    expect(app).toContain("{ text: 'Completar antes', style: 'cancel', onPress: () => goToPendingFeedback() }");
    expect(app).toContain('else goToPendingFeedback();');
    expect(app).toContain('pendingFeedbackItemsRef.current = data.pendingFeedbacks ?? [];');
    expect(app).toContain('scrollAppToWindowY(y)');
  });
  it('os cartoes mostram o aviso e a tela principal registra a rolagem', () => {
    expect(app).toContain('<FeedbackBadgeView state={feedbackBadge({ hasRealized,');
    expect(app).toContain('ref={registerAppScroll}');
    expect(app).toContain('sessionCardRefs.current[session.id] = node;');
  });
  it('o modal do check-in acompanha o teclado e rola ate o campo ao focar', () => {
    expect(app).toContain('availableSheetHeight(windowHeight, keyboardHeight');
    expect(app).toContain('keyboardShouldPersistTaps="handled"');
    expect(app).toContain('checkInScrollRef.current?.scrollToEnd');
  });
});
