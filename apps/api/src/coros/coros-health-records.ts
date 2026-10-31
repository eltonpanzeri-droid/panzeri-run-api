// Leitura de SAUDE da COROS (sono, HRV, FC de repouso, atividade diaria) a partir das respostas em TEXTO do COROS MCP (30/10/2026).
//
// ATENCAO — NAO VALIDADO COM DADOS REAIS: a conta de teste do projeto nao tem relogio COROS, entao so' foram vistas respostas VAZIAS ou o cabecalho; os rotulos abaixo foram inferidos da descricao
// oficial de cada ferramenta (querySleepOverview, querySleepHrv, queryRestingHeartRate, queryDailyHealthData). Por isso o leitor e' TOLERANTE e conservador: so' aceita um valor quando o rotulo
// e a unidade conferem e o numero e' fisiologicamente possivel; qualquer outra coisa e' DESCARTADA (nunca vira zero, nunca e' estimada). Sem horario absoluto do sono nao ha registro de sono.
// Quando surgir a primeira resposta real, ajustar aqui e acrescentar o texto ao teste `coros-health-records.spec.ts`.

export interface CorosSleepRecord {
  calendarDate: string; // dia de ACORDAR (a COROS atribui a noite ao dia em que ela termina)
  durationSec: number;
  deepSleepSec: number | null;
  lightSleepSec: number | null;
  remSleepSec: number | null;
  awakeSec: number | null;
  scoreValue: number | null;
  // So' preenchidos quando a janela vem com data, hora E fuso explicitos; sem isso a noite NAO e' gravada.
  startTimeSec: number | null;
  endTimeSec: number | null;
  startOffsetSec: number | null;
}
export interface CorosHrvRecord { calendarDate: string; averageMs: number }
export interface CorosRestingHrRecord { calendarDate: string; bpm: number }
export interface CorosDailyRecord { calendarDate: string; steps: number | null; distanceMeters: number | null }

const HEADER = /^\s*(?:-{2,}\s*)?(\d{4}-\d{2}-\d{2}|\d{8})(?:\s*-{2,})?\s*:?\s*$/;

export function toCalendarDate(token: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(token) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(token);
  if (!iso) return null;
  const [, y, m, d] = iso;
  const time = Date.UTC(Number(y), Number(m) - 1, Number(d));
  const back = new Date(time).toISOString().slice(0, 10);
  return back === `${y}-${m}-${d}` ? back : null;
}

/** Ancora estavel do DIA (meia-noite UTC) para registros diarios, sem horario proprio; a chave real do registro e' `calendarDate`. */
export function dayAnchorSec(calendarDate: string): number {
  return Math.floor(Date.parse(`${calendarDate}T00:00:00Z`) / 1000);
}

function sections(text: string): Array<{ calendarDate: string; body: string }> {
  const lines = text.replace(/\\n/g, '\n').split(/\r?\n/);
  const out: Array<{ calendarDate: string; lines: string[] }> = [];
  for (const line of lines) {
    const header = HEADER.exec(line);
    const date = header ? toCalendarDate(header[1]) : null;
    if (date) out.push({ calendarDate: date, lines: [] });
    else if (out.length) out[out.length - 1].lines.push(line);
  }
  return out.map((s) => ({ calendarDate: s.calendarDate, body: s.lines.join('\n') }));
}

function durationSec(raw: string): number | null {
  const hm = /(\d+)\s*h(?:ours?|rs?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?/i.exec(raw);
  if (hm) return Number(hm[1]) * 3600 + Number(hm[2] ?? 0) * 60;
  const m = /(\d+)\s*m(?:in(?:ute)?s?)?\b/i.exec(raw);
  return m ? Number(m[1]) * 60 : null;
}

const ISO_WITH_OFFSET = /(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?\s*(Z|[+-]\d{2}:?\d{2})/g;

function windowOf(line: string): { startMs: number; endMs: number; offsetSec: number } | null {
  const hits = [...line.matchAll(ISO_WITH_OFFSET)];
  if (hits.length < 2) return null;
  const parse = (h: RegExpMatchArray) => {
    const zone = h[4] === 'Z' ? '+00:00' : h[4].length === 5 ? `${h[4].slice(0, 3)}:${h[4].slice(3)}` : h[4];
    const ms = Date.parse(`${h[1]}T${h[2]}:${h[3] ?? '00'}${zone}`);
    const sign = zone.startsWith('-') ? -1 : 1;
    const offsetSec = sign * (Number(zone.slice(1, 3)) * 3600 + Number(zone.slice(4, 6)) * 60);
    return { ms, offsetSec };
  };
  const a = parse(hits[0]);
  const b = parse(hits[1]);
  if (Number.isNaN(a.ms) || Number.isNaN(b.ms) || b.ms <= a.ms || b.ms - a.ms > 24 * 3600_000) return null;
  return { startMs: a.ms, endMs: b.ms, offsetSec: a.offsetSec };
}

export function parseSleepOverview(text: string): CorosSleepRecord[] {
  const records: CorosSleepRecord[] = [];
  for (const { calendarDate, body } of sections(text)) {
    const mainLine = body.split('\n').find((l) => /main\s*sleep/i.test(l) && /duration|\d+\s*h|\d+\s*min/i.test(l) && !/window/i.test(l)) ?? body.split('\n').find((l) => /sleep\s*duration|duration/i.test(l));
    const duration = mainLine ? durationSec(mainLine.replace(/^[^:]*:/, '')) : null;
    if (duration === null || duration < 30 * 60 || duration > 24 * 3600) continue;
    const pct = (label: RegExp) => {
      const m = body.match(new RegExp(label.source + '\\D{0,20}?(\\d+(?:\\.\\d+)?)\\s*%', 'i'));
      return m ? Number(m[1]) : null;
    };
    const deep = pct(/deep/);
    const light = pct(/light/);
    const rem = pct(/rem/);
    const ratiosOk = deep !== null && light !== null && rem !== null;
    // Divisao por etapas so' quando a COROS informa as TRES proporcoes e elas fecham ~100% (com folga de arredondamento); caso contrario, so' a duracao total.
    const splitOk = ratiosOk && deep! + light! + rem! >= 90 && deep! + light! + rem! <= 105;
    const stage = (p: number | null) => (splitOk && p !== null ? Math.round((duration * p) / 100) : null);
    const awakeLine = body.split('\n').find((l) => /awake\s*(?:time|duration)/i.test(l));
    const awake = awakeLine ? durationSec(awakeLine.replace(/^[^:]*:/, '')) : null;
    const scoreMatch = /sleep\s*score\D{0,12}(\d{1,3})\b/i.exec(body);
    const score = scoreMatch && Number(scoreMatch[1]) <= 100 ? Number(scoreMatch[1]) : null;
    const win = windowOf(body.split('\n').find((l) => /window/i.test(l) && !/nap/i.test(l)) ?? '');
    records.push({
      calendarDate,
      durationSec: duration,
      deepSleepSec: stage(deep),
      lightSleepSec: stage(light),
      remSleepSec: stage(rem),
      awakeSec: awake !== null && awake >= 0 && awake <= duration ? awake : null,
      scoreValue: score,
      startTimeSec: win ? Math.floor(win.startMs / 1000) : null,
      endTimeSec: win ? Math.floor(win.endMs / 1000) : null,
      startOffsetSec: win ? win.offsetSec : null,
    });
  }
  return records;
}

export function parseSleepHrv(text: string): CorosHrvRecord[] {
  const out: CorosHrvRecord[] = [];
  for (const { calendarDate, body } of sections(text)) {
    // So' a avaliacao OFICIAL do dia ("average"); nunca a media de pontos brutos nem a linha de base.
    const m = /(?:avg|average|mean)\w*(?:\s+sleep)?(?:\s+hrv)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*ms/i.exec(body);
    if (!m) continue;
    const value = Number(m[1]);
    if (value >= 5 && value <= 300) out.push({ calendarDate, averageMs: value });
  }
  return out;
}

export function parseRestingHeartRate(text: string): CorosRestingHrRecord[] {
  const out = new Map<string, number>();
  for (const line of text.replace(/\\n/g, '\n').split(/\r?\n/)) {
    const m = /(\d{4}-\d{2}-\d{2}|\b\d{8}\b)\D{1,20}?(\d{2,3})\s*(?:bpm)?\s*$/i.exec(line.trim()) ?? /(\d{4}-\d{2}-\d{2}|\b\d{8}\b)\D{1,20}?(\d{2,3})\s*bpm/i.exec(line);
    const date = m ? toCalendarDate(m[1]) : null;
    const bpm = m ? Number(m[2]) : NaN;
    if (date && bpm >= 25 && bpm <= 140) out.set(date, bpm);
  }
  return [...out].map(([calendarDate, bpm]) => ({ calendarDate, bpm }));
}

export function parseDailyHealth(text: string): CorosDailyRecord[] {
  const out: CorosDailyRecord[] = [];
  for (const { calendarDate, body } of sections(text)) {
    const stepsM = /steps\s*[:=]?\s*(\d[\d,.]*)/i.exec(body);
    const distM = /distance\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(km|m)\b/i.exec(body);
    const calM = /calories\s*[:=]?\s*(\d[\d,.]*)/i.exec(body);
    const exM = /exercise\s*[:=]?\s*(\d[\d,.]*)/i.exec(body);
    const steps = stepsM ? Number(stepsM[1].replace(/[,.](?=\d{3}\b)/g, '')) : null;
    const distance = distM ? Number(distM[1]) * (distM[2].toLowerCase() === 'km' ? 1000 : 1) : null;
    // Dia com tudo zerado (sem relogio ou sem uso) e' AUSENCIA de dado, nunca "zero passos".
    const allZero = [steps, calM ? Number(calM[1].replace(/,/g, '')) : null, exM ? Number(exM[1].replace(/,/g, '')) : null, distance].every((v) => v === null || v === 0);
    if (allZero) continue;
    out.push({
      calendarDate,
      steps: steps !== null && Number.isFinite(steps) && steps >= 0 && steps <= 200_000 ? Math.round(steps) : null,
      distanceMeters: distance !== null && Number.isFinite(distance) && distance >= 0 && distance <= 300_000 ? distance : null,
    });
  }
  return out;
}
