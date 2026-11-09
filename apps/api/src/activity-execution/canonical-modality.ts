// Representacao CANONICA de modalidade para COMPARAR observacoes de providers diferentes (identidade fisica).
// O vocabulario canonico e' o mesmo de TrainingSession.modality / adapters ('corrida' | 'esteira' | 'forca' | 'fortalecimento_corredores' |
// 'bike' | 'outra'; 'esteira' NAO existe mais — ver abaixo). Os adapters atuais ja gravam esse vocabulario, mas ActivityLog legado (ex.: Polar de 01/10/2026, gravado ANTES do
// normalizador) guarda o enum bruto do provider ('RUNNING'). Esta funcao serve SO' para interpretacao/comparacao: o valor original
// continua intacto em ActivityLog.sport e e' exibido junto no diagnostico (proveniencia).
//
// Conservadora: so' mapeia aliases comprovadamente equivalentes. Valor desconhecido -> null (modalidade nao interpretavel = "desconhecida",
// nunca "incompativel"). Idempotente: valor ja canonico volta igual.

// 'funcional', 'natacao' e 'caminhada' (10/2026) so' registram o que foi feito (atividade extra); ver activity-modality-map.ts.
const CANONICAL = new Set(['corrida', 'forca', 'fortalecimento_corredores', 'bike', 'outra', 'funcional', 'natacao', 'caminhada']);

const ALIASES: Record<string, string> = {
  running: 'corrida',
  run: 'corrida',
  // REGRA DE ELTON (09/11/2026): so' existe CORRIDA. Tudo que chega como esteira (texto, codigo de relogio, registro antigo) vira corrida.
  esteira: 'corrida',
  treadmill: 'corrida',
  treadmill_running: 'corrida',
  other: 'outra',
};

// REGRA DE ELTON (09/11/2026): so' existe CORRIDA (esteira nao e' modalidade; entra como corrida em qualquer porta). Use isto sempre que a pergunta for "e' corrida?".
export function isRunModality(raw: unknown): boolean {
  return canonicalModality(raw) === 'corrida';
}

export function canonicalModality(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  if (CANONICAL.has(key)) return key;
  return ALIASES[key] ?? null;
}
