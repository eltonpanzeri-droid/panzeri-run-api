// Representacao CANONICA de modalidade para COMPARAR observacoes de providers diferentes (identidade fisica).
// O vocabulario canonico e' o mesmo de TrainingSession.modality / adapters ('corrida' | 'esteira' | 'forca' | 'fortalecimento_corredores' |
// 'bike' | 'outra'). Os adapters atuais ja gravam esse vocabulario, mas ActivityLog legado (ex.: Polar de 01/10/2026, gravado ANTES do
// normalizador) guarda o enum bruto do provider ('RUNNING'). Esta funcao serve SO' para interpretacao/comparacao: o valor original
// continua intacto em ActivityLog.sport e e' exibido junto no diagnostico (proveniencia).
//
// Conservadora: so' mapeia aliases comprovadamente equivalentes. Valor desconhecido -> null (modalidade nao interpretavel = "desconhecida",
// nunca "incompativel"). Idempotente: valor ja canonico volta igual.

const CANONICAL = new Set(['corrida', 'esteira', 'forca', 'fortalecimento_corredores', 'bike', 'outra']);

const ALIASES: Record<string, string> = {
  running: 'corrida',
  run: 'corrida',
  treadmill: 'esteira',
  treadmill_running: 'esteira',
  other: 'outra',
};

export function canonicalModality(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  if (CANONICAL.has(key)) return key;
  return ALIASES[key] ?? null;
}
