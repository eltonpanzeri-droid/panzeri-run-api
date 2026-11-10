import { createHash } from 'crypto';

// Aceite da aluna para o ciclo menstrual alimentar a IA (10/11/2026, decisao de Elton de 01/11). O texto e' o mesmo que a aba "Ciclo" ja mostrava como aviso; agora precisa de aceite registrado
// (versao + hash do texto + data). Mudou o texto = nova versao = a aluna aceita de novo; enquanto isso o ciclo dela NAO vai a IA.
export const CYCLE_AI_CONSENT_VERSION = '2026-11-10.1';

export const CYCLE_AI_CONSENT_TEXT =
  'Os dados de ciclo menstrual podem ajudar a entender melhor sobre você, inclusive aspectos relacionados a dores e performance. Ao aceitar, você consente que os dados de ciclo menstrual que você registrar no Panzeri Run serão usados por nossa inteligência artificial para criar prescrições melhores para você. Você pode retirar esta autorização quando quiser, nesta mesma tela; depois disso, seus dados de ciclo deixam de ser enviados à inteligência artificial.';

export const cycleAiConsentHash = (text: string = CYCLE_AI_CONSENT_TEXT): string => createHash('sha256').update(text).digest('hex');

export interface CycleAiConsentRow { version: string; textHash: string; acceptedAt: Date; revokedAt: Date | null }

// Vigente = existe, nao foi retirado e foi dado sobre o texto de hoje (versao e hash iguais).
export function isCycleAiConsentCurrent(row: CycleAiConsentRow | null | undefined): boolean {
  return !!row && row.revokedAt === null && row.version === CYCLE_AI_CONSENT_VERSION && row.textHash === cycleAiConsentHash();
}
