// Apresentacao (so' texto) de faixas ja decididas pela IA/montagem da sessao. Nao calcula nem altera prescricao: apenas evita mostrar uma
// faixa degenerada ("50:00 a 50:00") e resume o pace de uma sessao de varias partes continuas sem afirmar um unico pace que so' vale
// para uma delas.

// "5:45/km a 5:45/km" -> "5:45/km"; "10.4 a 10.4 km/h" -> "10.4 km/h"; "50:00 a 50:00" -> "50:00". Faixa real (valores diferentes) fica igual.
export function collapseEqualRange(text: string): string {
  const match = text.match(/^\s*([\d:.,]+)([^\d\s]*?)\s+a\s+([\d:.,]+)(.*)$/);
  if (!match) return text;
  const [, first, , second, rest] = match;
  return first === second ? `${second}${rest}` : text;
}

function formatPaceSeconds(totalSeconds: number): string {
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

// Pace exibido no cabecalho de uma sessao de corrida. Sessao de UMA parte, ou intervalada: devolve o pace representativo ja gravado
// (comportamento anterior). Sessao de VARIAS partes continuas com paces diferentes: devolve a faixa entre o mais rapido e o mais lento
// efetivamente prescritos nas partes — antes o cabecalho mostrava so' o pace de uma parte (ex.: 5:45) enquanto outras eram 6:45.
export function runPaceHeaderLabel(structure: unknown, fallback: string | null): string | null {
  const blocks = (structure as { type?: unknown; blocks?: unknown } | null)?.blocks;
  if ((structure as { type?: unknown } | null)?.type !== 'run' || !Array.isArray(blocks) || blocks.length < 2) return fallback;
  const paces: number[] = [];
  for (const block of blocks as Array<{ repeatCount?: unknown; steps?: unknown; paceRange?: unknown }>) {
    if (block.repeatCount || block.steps) return fallback; // intervalada: o pace representativo (estimulo) continua valendo
    if (typeof block.paceRange !== 'string') continue;
    for (const m of block.paceRange.matchAll(/(\d+):(\d{2})/g)) paces.push(Number(m[1]) * 60 + Number(m[2]));
  }
  if (paces.length === 0) return fallback;
  const fast = Math.min(...paces);
  const slow = Math.max(...paces);
  return fast === slow ? `${formatPaceSeconds(fast)}/km` : `${formatPaceSeconds(fast)} a ${formatPaceSeconds(slow)}/km`;
}
