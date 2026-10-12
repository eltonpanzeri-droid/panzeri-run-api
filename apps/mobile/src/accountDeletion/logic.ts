// Logica PURA da tela "Excluir minha conta" (sem React Native): textos, regras de habilitacao e leitura das respostas da API. Testavel no jest da API.
// O servidor e' quem decide e valida tudo (senha, frase, situacao real da assinatura); aqui so' se evita enviar pedido incompleto.

export const CONFIRM_PHRASE = 'EXCLUIR CONTA';

export type SubscriptionChannel = 'asaas' | 'store' | 'none';
export type SubscriptionLive = 'yes' | 'no' | 'unknown';
export type PendingCharges = 'yes' | 'no' | 'unknown';
export type ChargesChoice = 'cancel' | 'keep';

export interface DeletionInfo {
  phrase: string;
  subscription: { channel: SubscriptionChannel; live: SubscriptionLive; pendingCharges: PendingCharges };
  requiresChargesChoice: boolean;
}

export const WILL_BE_DELETED = [
  'Seus dados pessoais (nome, e-mail, CPF, telefone, endereço e demais dados de perfil).',
  'Seus programas de treino, treinos realizados, histórico, feedbacks e relatos.',
  'Seus dados de saúde e condicionamento, incluindo o que foi importado do Apple Saúde, do Health Connect, da Polar, da Wahoo e do Strava.',
  'As mensagens e as informações usadas pela inteligência artificial para montar seus treinos.',
  'O acesso ao aplicativo: você não conseguirá mais entrar com esta conta.',
];

export const WILL_BE_KEPT = [
  'Registros de pagamento e de assinatura (valores, datas e identificadores), sem nome, e-mail, CPF ou outros dados que identifiquem você.',
  'Registros técnicos de auditoria, também sem identificação direta.',
  'Cópias de segurança do banco de dados podem demorar um tempo para deixar de conter seus dados, conforme a Política de Privacidade.',
];

export const IRREVERSIBLE_WARNING = 'Esta ação é definitiva. Não é possível recuperar a conta nem os dados depois de excluir.';

export const EXTERNAL_CHARGES_WARNING =
  'Atenção: excluir a conta NÃO cancela automaticamente cobranças feitas fora do Panzeri Run. Se você tem uma assinatura, ela pode continuar sendo cobrada até que seja cancelada.';

export const SUPPORT_EMAIL = 'eltonpanzeri@gmail.com';

// Aceite ESPECIFICO ao excluir sem cancelar (separado da escolha): deixa explicito que a cobranca pode continuar sem acesso ao app.
export function chargesAckText(subscription: DeletionInfo['subscription']): string {
  const { channel, pendingCharges } = subscription;
  if (channel === 'store') {
    return 'Entendo que excluir a conta NÃO cancela a assinatura da loja e que a cobrança continuará até eu cancelá-la na loja (App Store ou Google Play), mesmo sem acesso ao aplicativo.';
  }
  const issued = pendingCharges === 'no' ? '' : ' (inclusive as já emitidas e ainda em aberto)';
  return `Entendo que, se eu não cancelar a assinatura, as cobranças poderão continuar${issued} mesmo depois da exclusão e sem acesso ao aplicativo. Para cancelar depois, preciso falar com o responsável pelo Panzeri Run (${SUPPORT_EMAIL}).`;
}

export const PLAY_STORE_CANCEL_STEPS = [
  'Abra o aplicativo Google Play.',
  'Toque na sua foto de perfil, no canto superior direito.',
  'Toque em "Pagamentos e assinaturas" e depois em "Assinaturas".',
  'Escolha "Panzeri Run" e toque em "Cancelar assinatura".',
];
export const PLAY_SUBSCRIPTIONS_URL = 'https://play.google.com/store/account/subscriptions';
export const APPLE_CANCEL_STEPS = [
  'Abra o app Ajustes do iPhone.',
  'Toque no seu nome (Apple ID) e depois em "Assinaturas".',
  'Escolha "Panzeri Run" e toque em "Cancelar assinatura".',
];
export const APPLE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';

// Orientacao da loja certa conforme o aparelho: iPhone => Apple; Android => Google Play; web => as duas.
export function storeCancelGuides(os: string): Array<{ store: string; steps: string[]; url: string; linkLabel: string }> {
  const apple = { store: 'App Store', steps: APPLE_CANCEL_STEPS, url: APPLE_SUBSCRIPTIONS_URL, linkLabel: 'Abrir minhas assinaturas da App Store' };
  const google = { store: 'Google Play', steps: PLAY_STORE_CANCEL_STEPS, url: PLAY_SUBSCRIPTIONS_URL, linkLabel: 'Abrir minhas assinaturas no Google Play' };
  return os === 'ios' ? [apple] : os === 'android' ? [google] : [apple, google];
}

export function needsChargesChoice(info: DeletionInfo | null): boolean {
  return !!info && info.requiresChargesChoice;
}

export function subscriptionNotice(info: DeletionInfo): string | null {
  const { channel, live, pendingCharges } = info.subscription;
  if (channel === 'none' || (live === 'no' && pendingCharges === 'no' && channel !== 'store')) return null;
  if (channel === 'store') return 'Sua assinatura é feita pela loja de aplicativos (App Store ou Google Play). Só você pode cancelá-la, na própria loja.';
  if (live === 'unknown') return 'Não conseguimos confirmar agora se sua assinatura no Asaas está ativa. Por segurança, tratamos como possivelmente ativa.';
  if (live === 'no') return 'Sua assinatura no Asaas não está ativa, mas ainda há cobranças já emitidas em aberto.';
  return 'Você tem uma assinatura ativa no Asaas.';
}

// COBRANCAS JA' EMITIDAS (Asaas). Base: documentacao oficial do Asaas (11/10/2026) — remover a assinatura tambem exclui as cobrancas pendentes/vencidas
// dela e as ja' pagas permanecem; suspender (inativa) NAO remove as existentes. O texto nunca promete o que nao foi verificado.
export function pendingChargesLines(info: DeletionInfo): string[] {
  const { channel, pendingCharges } = info.subscription;
  if (channel !== 'asaas') return [];
  if (pendingCharges === 'yes') {
    return [
      'Já existem cobranças emitidas (boleto, Pix ou cartão) pendentes ou vencidas ligadas à sua assinatura.',
      'Segundo o Asaas, cancelar a assinatura remove as cobranças pendentes e vencidas dela; cobranças já pagas não são devolvidas.',
      'Se você NÃO cancelar, essas cobranças continuam válidas e o Asaas continua gerando as próximas.',
    ];
  }
  if (pendingCharges === 'unknown') {
    return ['Não conseguimos verificar agora se há cobranças já emitidas. Se houver, elas continuam válidas enquanto a assinatura não for cancelada.'];
  }
  return ['Se você não cancelar, o Asaas continua gerando as próximas cobranças da assinatura.'];
}

export interface FormState {
  info: DeletionInfo | null;
  choice: ChargesChoice | null;
  acknowledged: boolean;
  password: string;
  phrase: string;
  busy: boolean;
}

// So' habilita o botao final com TUDO: informacoes carregadas, senha, frase exata e (quando ha cobranca possivel) a escolha explicita.
export function canSubmit(state: FormState): boolean {
  if (state.busy || !state.info) return false;
  if (state.password.length === 0) return false;
  if (state.phrase !== CONFIRM_PHRASE) return false;
  if (needsChargesChoice(state.info) && state.choice === null) return false;
  if (needsChargesChoice(state.info) && state.choice === 'keep' && !state.acknowledged) return false;
  return true;
}

export function buildBody(state: Pick<FormState, 'info' | 'choice' | 'acknowledged' | 'password' | 'phrase'>): { password: string; confirmText: string; externalCharges?: ChargesChoice; chargesAcknowledged?: boolean } {
  return {
    password: state.password,
    confirmText: state.phrase,
    ...(needsChargesChoice(state.info) && state.choice ? { externalCharges: state.choice } : {}),
    ...(needsChargesChoice(state.info) && state.choice === 'keep' && state.acknowledged ? { chargesAcknowledged: true } : {}),
  };
}

// Traduz a resposta do servidor em mensagem clara (nunca expoe detalhe tecnico).
export function describeFailure(status: number, body: unknown): { message: string; refetchInfo: boolean } {
  const code = (body as { code?: string; response?: { code?: string } } | null)?.code ?? (body as { response?: { code?: string } } | null)?.response?.code;
  if (status === 403) return { message: 'Senha incorreta. Confira e tente novamente.', refetchInfo: false };
  if (status === 409 && code === 'charges_acknowledgement_required') return { message: 'Marque a confirmação de que as cobranças podem continuar para excluir sem cancelar.', refetchInfo: false };
  if (status === 409 && code === 'external_charges_choice_required') return { message: 'Escolha o que fazer com a sua assinatura antes de excluir a conta.', refetchInfo: true };
  if (status === 502 && code === 'asaas_cancel_failed') return { message: 'Não foi possível cancelar a assinatura agora. Sua conta NÃO foi excluída. Tente novamente ou escolha excluir sem cancelar.', refetchInfo: false };
  if (status === 400) return { message: 'Digite exatamente EXCLUIR CONTA para confirmar.', refetchInfo: false };
  if (status === 429) return { message: 'Muitas tentativas. Aguarde um minuto e tente novamente.', refetchInfo: false };
  return { message: 'Não foi possível excluir a conta agora. Nada foi apagado pela metade; tente novamente em instantes.', refetchInfo: false };
}
