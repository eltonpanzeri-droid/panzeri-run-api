// Funcoes puras do "Relatar problema" (13/11/2026), sem React Native, para serem testadas.
export type ProblemType = 'error' | 'usability' | 'wrong_data' | 'suggestion';

export const PROBLEM_TYPE_OPTIONS: Array<{ id: ProblemType; label: string; hint: string }> = [
  { id: 'error', label: 'Erro', hint: 'Algo travou, não abriu ou deu mensagem de erro.' },
  { id: 'usability', label: 'Dificuldade de utilização', hint: 'Não entendi como usar ou não achei uma função.' },
  { id: 'wrong_data', label: 'Dados incorretos', hint: 'Um número, treino ou informação apareceu errado.' },
  { id: 'suggestion', label: 'Sugestão', hint: 'Uma ideia para o Panzeri Run melhorar.' },
];

export const PROBLEM_MESSAGE_MAX = 2000;
export const PROBLEM_MESSAGE_MIN = 5;
export const PROBLEM_MAX_IMAGES = 3;
// O servidor aceita ate 70 KB por imagem (limite do corpo JSON); margem de seguranca.
export const PROBLEM_IMAGE_MAX_BYTES = 68 * 1024;
// Tentativas de reducao, da melhor para a menor qualidade: largura maxima e compressao JPEG.
export const PROBLEM_IMAGE_ATTEMPTS: Array<{ width: number; compress: number }> = [
  { width: 1000, compress: 0.55 }, { width: 900, compress: 0.45 }, { width: 800, compress: 0.4 }, { width: 700, compress: 0.35 }, { width: 600, compress: 0.3 }, { width: 500, compress: 0.25 },
];

export function base64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function canSubmitReport(type: ProblemType | null, message: string, busy: boolean): boolean {
  return !busy && type !== null && message.trim().length >= PROBLEM_MESSAGE_MIN && message.trim().length <= PROBLEM_MESSAGE_MAX;
}

export interface DeviceInfoInput { platform: string; osVersion?: string | number | null; deviceModel?: string | null; appVersion?: string | null }

// Somente o necessario para reproduzir o problema: sistema, versao do sistema, modelo e versao do app. Nada de identificadores do aparelho, localizacao ou lista de aplicativos.
export function buildDeviceInfo(input: DeviceInfoInput) {
  return {
    platform: String(input.platform || 'desconhecido').slice(0, 16),
    osVersion: input.osVersion == null ? undefined : String(input.osVersion).slice(0, 32),
    deviceModel: input.deviceModel ? String(input.deviceModel).slice(0, 64) : undefined,
    appVersion: input.appVersion ? String(input.appVersion).slice(0, 32) : undefined,
  };
}

export function submitFeedbackText(imagesSent: number, imagesTotal: number): string {
  if (imagesTotal === 0 || imagesSent === imagesTotal) return 'Seu relato foi enviado. Obrigado por nos ajudar a melhorar o Panzeri Run.';
  if (imagesSent === 0) return 'Seu relato foi enviado, mas não consegui anexar as imagens. Se precisar, descreva o que aparecia na tela.';
  return `Seu relato foi enviado, mas só ${imagesSent} de ${imagesTotal} imagens foram anexadas.`;
}

export const STATUS_LABELS: Record<string, string> = { open: 'Recebido', in_progress: 'Em andamento', resolved: 'Resolvido' };
