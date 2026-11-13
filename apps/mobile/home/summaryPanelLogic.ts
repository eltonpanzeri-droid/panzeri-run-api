// Painel de resumo da tela inicial (14/11/2026): funções PURAS de período. Nenhuma conta de treino aqui (isso é do servidor, GET /me/evolution/panel): só datas e textos.
export type PanelPreset = 'all' | '30d' | '90d' | 'custom';

export interface PanelRange { from: string | null; to: string | null }

const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Faixa dos botões prontos; "Desde o início" = sem datas (padrão). */
export function presetRange(preset: Exclude<PanelPreset, 'custom'>, todayIso: string): PanelRange {
  if (preset === '30d') return { from: addDays(todayIso, -29), to: todayIso };
  if (preset === '90d') return { from: addDays(todayIso, -89), to: todayIso };
  return { from: null, to: null };
}

/** Máscara DD/MM/AAAA enquanto a aluna digita (só números). */
export function maskBrDate(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** 'DD/MM/AAAA' -> 'AAAA-MM-DD'; null se não for uma data real. */
export function parseBrDate(text: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  const iso = `${yyyy}-${mm}-${dd}`;
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) return null;
  if (Number(yyyy) < 2020) return null;
  return iso;
}

export function isoToBr(iso: string): string {
  const [yyyy, mm, dd] = iso.split('-');
  return `${dd}/${mm}/${yyyy}`;
}

export type CustomRangeResult = { ok: true; range: PanelRange } | { ok: false; error: string };

/** Período livre: as duas datas são obrigatórias, reais, na ordem certa e não no futuro. */
export function validateCustomRange(fromText: string, toText: string, todayIso: string): CustomRangeResult {
  const from = parseBrDate(fromText);
  const to = parseBrDate(toText);
  if (!from || !to) return { ok: false, error: 'Preencha as duas datas no formato dia/mês/ano.' };
  if (from > to) return { ok: false, error: 'A data inicial não pode ser depois da final.' };
  if (from > todayIso) return { ok: false, error: 'A data inicial não pode estar no futuro.' };
  return { ok: true, range: { from, to: to > todayIso ? todayIso : to } };
}

export function periodLabel(range: PanelRange): string {
  if (!range.from && !range.to) return 'desde o início';
  return `${range.from ? isoToBr(range.from) : 'início'} a ${range.to ? isoToBr(range.to) : 'hoje'}`;
}

export function queryFor(range: PanelRange): string {
  const parts: string[] = [];
  if (range.from) parts.push(`from=${range.from}`);
  if (range.to) parts.push(`to=${range.to}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

// Semana em curso (14/11/2026): números vêm do servidor (semanaAtual); aqui só o texto de incentivo, por regra.
export interface CurrentWeekDto {
  weekStart: string; weekEnd: string; diasRestantes: number;
  treinosFeitos: number; porModalidade: Array<{ modality: string; count: number }>;
  treinosPrescritos: number; prescritosFeitos: number; treinosFaltam: number; extrasFeitos: number;
  kmRealizados: number; kmPrescritos: number | null; kmFaltam: number | null; kmAlemDoPrescrito: number;
}

const kmText = (value: number) => `${String(value).replace('.', ',')} km`;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function weekCoachText(week: CurrentWeekDto, firstName: string): string {
  const name = firstName ? `${firstName}, ` : '';
  const days = `${week.diasRestantes} ${plural(week.diasRestantes, 'dia', 'dias')}`;
  const extras = week.extrasFeitos > 0 ? ` Você ainda fez ${week.extrasFeitos} ${plural(week.extrasFeitos, 'treino extra', 'treinos extras')}.` : '';
  if (week.treinosPrescritos === 0) {
    return week.treinosFeitos > 0
      ? `${name}esta semana não há treinos do programa, e você já fez ${week.treinosFeitos} ${plural(week.treinosFeitos, 'treino', 'treinos')} por conta própria.`
      : `${name}esta semana não há treinos do programa.`;
  }
  const kmDone = week.kmRealizados > 0 ? ` e correu ${kmText(week.kmRealizados)}` : '';
  const kmDone0 = week.kmFaltam === 0 || week.kmFaltam == null;
  if (week.treinosFaltam === 0 && kmDone0) {
    const over = week.kmAlemDoPrescrito > 0 ? ` e passou ${kmText(week.kmAlemDoPrescrito)} do volume prescrito` : '';
    return `${name}semana completa! Você fez os ${week.treinosPrescritos} treinos do programa${over}.${extras}`;
  }
  const missingParts: string[] = [];
  if (week.treinosFaltam > 0) missingParts.push(`${week.treinosFaltam} ${plural(week.treinosFaltam, 'treino', 'treinos')}`);
  if (week.kmFaltam != null && week.kmFaltam > 0) missingParts.push(kmText(week.kmFaltam));
  const missing = missingParts.join(' e ');
  if (week.diasRestantes <= 0) return `${name}você fez ${week.prescritosFeitos} de ${week.treinosPrescritos} treinos do programa${kmDone} nesta semana.${extras}`;
  return `${name}nesta semana você já fez ${week.prescritosFeitos} de ${week.treinosPrescritos} treinos do programa${kmDone}. Faltam ${missing} nos ${days} que restam: dá tempo de fechar a semana.${extras}`;
}
