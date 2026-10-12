import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildBody, canSubmit, chargesAckText, CONFIRM_PHRASE, pendingChargesLines, SUPPORT_EMAIL, DeletionInfo, describeFailure, EXTERNAL_CHARGES_WARNING, needsChargesChoice, PLAY_STORE_CANCEL_STEPS, subscriptionNotice,
  WILL_BE_DELETED, WILL_BE_KEPT,
} from '../../mobile/src/accountDeletion/logic';
import { SELF_DELETE_PHRASE } from '../src/account-deletion/self-account-deletion.service';
import { LEGAL_CONTACT, LEGAL_SUMMARY } from '../src/legal/legal-content';

const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');
const info = (channel: DeletionInfo['subscription']['channel'], live: DeletionInfo['subscription']['live'], pendingCharges: DeletionInfo['subscription']['pendingCharges'] = 'no'): DeletionInfo => ({
  phrase: CONFIRM_PHRASE, subscription: { channel, live, pendingCharges }, requiresChargesChoice: channel !== 'none' && (live !== 'no' || pendingCharges !== 'no'),
});
const state = (over: Partial<Parameters<typeof canSubmit>[0]> = {}) => ({ info: info('none', 'no'), choice: null, acknowledged: false, password: 'senha', phrase: CONFIRM_PHRASE, busy: false, ...over });

describe('tela "Excluir minha conta" (logica)', () => {
  it('a frase do app e a do servidor sao a mesma', () => {
    expect(CONFIRM_PHRASE).toBe(SELF_DELETE_PHRASE);
  });

  it('botao final so habilita com tudo: info carregada, senha, frase EXATA e, havendo cobranca possivel, a escolha', () => {
    expect(canSubmit(state())).toBe(true);
    expect(canSubmit(state({ info: null }))).toBe(false);
    expect(canSubmit(state({ password: '' }))).toBe(false);
    expect(canSubmit(state({ phrase: 'excluir conta' }))).toBe(false);
    expect(canSubmit(state({ phrase: 'EXCLUIR' }))).toBe(false);
    expect(canSubmit(state({ busy: true }))).toBe(false);
    expect(canSubmit(state({ info: info('asaas', 'yes'), choice: null }))).toBe(false);
    expect(canSubmit(state({ info: info('asaas', 'yes'), choice: 'cancel' }))).toBe(true);
    expect(canSubmit(state({ info: info('asaas', 'unknown'), choice: null }))).toBe(false);
  });

  it('"excluir sem cancelar" so habilita com o ACEITE especifico; "cancelar" nao precisa dele', () => {
    for (const channel of ['asaas', 'store'] as const) {
      expect(canSubmit(state({ info: info(channel, 'yes'), choice: 'keep', acknowledged: false }))).toBe(false);
      expect(canSubmit(state({ info: info(channel, 'yes'), choice: 'keep', acknowledged: true }))).toBe(true);
    }
    expect(canSubmit(state({ info: info('asaas', 'unknown'), choice: 'keep', acknowledged: false }))).toBe(false);
    expect(canSubmit(state({ info: info('asaas', 'yes'), choice: 'cancel', acknowledged: false }))).toBe(true);
  });

  it('o texto do aceite diz que a cobranca pode continuar sem acesso ao app e indica como falar com o responsavel', () => {
    expect(chargesAckText(info('asaas', 'yes').subscription)).toContain('as cobranças poderão continuar');
    expect(chargesAckText(info('asaas', 'yes').subscription)).toContain('sem acesso ao aplicativo');
    expect(chargesAckText(info('asaas', 'yes').subscription)).toContain(SUPPORT_EMAIL);
    expect(chargesAckText(info('asaas', 'yes').subscription)).not.toContain('já emitidas');
    expect(chargesAckText(info('asaas', 'no', 'yes').subscription)).toContain('inclusive as já emitidas e ainda em aberto');
    expect(chargesAckText(info('store', 'yes').subscription)).toContain('Google Play');
    expect(SUPPORT_EMAIL).toBe(LEGAL_CONTACT);
  });

  it('assinatura NUNCA bloqueia: com a escolha feita, o aluno sempre pode prosseguir', () => {
    for (const [channel, live] of [['asaas', 'yes'], ['asaas', 'unknown'], ['store', 'yes'], ['store', 'no'], ['asaas', 'no'], ['none', 'no']] as const) {
      expect(canSubmit(state({ info: info(channel, live), choice: 'keep', acknowledged: true }))).toBe(true);
    }
  });

  it('corpo enviado: escolha so quando ha cobranca possivel; nunca envia id de usuario', () => {
    expect(buildBody({ info: info('none', 'no'), choice: 'keep', acknowledged: true, password: 'p', phrase: CONFIRM_PHRASE })).toEqual({ password: 'p', confirmText: CONFIRM_PHRASE });
    expect(buildBody({ info: info('asaas', 'yes'), choice: 'cancel', acknowledged: true, password: 'p', phrase: CONFIRM_PHRASE })).toEqual({ password: 'p', confirmText: CONFIRM_PHRASE, externalCharges: 'cancel' });
    expect(buildBody({ info: info('asaas', 'yes'), choice: 'keep', acknowledged: true, password: 'p', phrase: CONFIRM_PHRASE })).toEqual({ password: 'p', confirmText: CONFIRM_PHRASE, externalCharges: 'keep', chargesAcknowledged: true });
    expect(buildBody({ info: info('asaas', 'yes'), choice: 'keep', acknowledged: false, password: 'p', phrase: CONFIRM_PHRASE })).not.toHaveProperty('chargesAcknowledged');
  });

  it('avisos: Asaas ativo, Asaas incerto, loja (Google Play) e sem assinatura', () => {
    expect(subscriptionNotice(info('asaas', 'yes'))).toContain('assinatura ativa no Asaas');
    expect(subscriptionNotice(info('asaas', 'unknown'))).toContain('Não conseguimos confirmar');
    expect(subscriptionNotice(info('store', 'yes'))).toContain('Google Play');
    expect(subscriptionNotice(info('asaas', 'no'))).toBeNull();
    expect(subscriptionNotice(info('none', 'no'))).toBeNull();
    expect(needsChargesChoice(info('asaas', 'yes'))).toBe(true);
    expect(EXTERNAL_CHARGES_WARNING).toContain('NÃO cancela automaticamente');
    expect(PLAY_STORE_CANCEL_STEPS.join(' ')).toContain('Cancelar assinatura');
  });

  it('COBRANCAS JA EMITIDAS: a tela diz, antes da confirmacao, que podem continuar validas; nunca afirma o que nao foi verificado', () => {
    const yes = pendingChargesLines(info('asaas', 'no', 'yes')).join(' ');
    expect(yes).toContain('pendentes ou vencidas');
    expect(yes).toContain('Segundo o Asaas');
    expect(yes).toContain('continuam válidas');
    expect(yes).toContain('já pagas não são devolvidas');
    expect(pendingChargesLines(info('asaas', 'yes', 'unknown')).join(' ')).toContain('Não conseguimos verificar');
    expect(pendingChargesLines(info('asaas', 'yes', 'no')).join(' ')).toContain('continua gerando as próximas');
    expect(pendingChargesLines(info('store', 'yes'))).toEqual([]);
    expect(pendingChargesLines(info('none', 'no'))).toEqual([]);
    // suspensa mas com cobranca emitida: a tela AVISA (nao e' "sem cobranca")
    expect(subscriptionNotice(info('asaas', 'no', 'yes'))).toContain('cobranças já emitidas em aberto');
    expect(subscriptionNotice(info('asaas', 'no', 'no'))).toBeNull();
    expect(needsChargesChoice(info('asaas', 'no', 'yes'))).toBe(true);
  });

  it('mensagens de erro claras e sem detalhe tecnico', () => {
    expect(describeFailure(403, {}).message).toContain('Senha incorreta');
    expect(describeFailure(409, { code: 'charges_acknowledgement_required' }).message).toContain('cobranças podem continuar');
    expect(describeFailure(409, { code: 'external_charges_choice_required' })).toMatchObject({ refetchInfo: true });
    expect(describeFailure(502, { code: 'asaas_cancel_failed' }).message).toContain('NÃO foi excluída');
    expect(describeFailure(500, {}).message).toContain('Nada foi apagado pela metade');
    expect(describeFailure(500, { stack: 'x' }).message).not.toContain('stack');
  });

  it('textos: dizem o que e excluido e o que permanece, sem as palavras proibidas', () => {
    const all = [...WILL_BE_DELETED, ...WILL_BE_KEPT].join(' ');
    expect(all).toContain('Apple Saúde');
    expect(all).toContain('Health Connect');
    expect(all).toContain('inteligência artificial');
    expect(all).toContain('pagamento');
    expect(all).not.toMatch(/motor|plano de treino/i);
  });

  it('texto da tela Privacidade e dados: NAO diz mais que a exclusao e manual; descreve o fluxo no app e a assinatura', () => {
    const section = LEGAL_SUMMARY.sections.find((s) => s.id === 'solicitacoes');
    const text = (section?.paragraphs ?? []).join(' ');
    expect(text).toContain('excluir a sua conta e os seus dados');
    expect(text).toContain('Excluir minha conta');
    expect(text).toContain('não cancela automaticamente uma assinatura nem as cobranças já emitidas');
    expect(text).not.toMatch(/correção, exclusão da conta, revogação[^.]*são tratados manualmente/);
    expect(text).toContain(LEGAL_CONTACT);
  });

  it('esta ligada ao app: secao em Privacidade e dados, logout apos excluir, senha mascarada e trava de duplo toque', () => {
    const app = read('mobile/App.tsx');
    expect(app).toContain('<DeleteAccountSection');
    expect(app).toContain('onAccountDeleted={logout}');
    const section = read('mobile/src/accountDeletion/DeleteAccountSection.tsx');
    expect(section).toContain('secureTextEntry');
    expect(section).toContain('submitting.current');
    expect(section).toContain('/me/account/delete');
    expect(section).toContain('Excluir definitivamente');
    expect(section).toContain('accessibilityRole="checkbox"');
  });
});
