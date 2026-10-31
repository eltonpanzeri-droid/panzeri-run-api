// Leitura da lista de atividades da COROS (ferramenta querySportRecords, 30/10/2026). A resposta e' TEXTO em linguagem humana (nao JSON) que, segundo a descricao da ferramenta, traz por
// atividade: data, esporte, local, tempo, distancia ou series, ritmo/velocidade, `labelId`, `sportType` e, quando disponiveis, `startTimestamp`/`endTimestamp`. O Panzeri Run so' precisa
// dos IDENTIFICADORES (labelId + sportType) para baixar o arquivo FIT da atividade, que e' estruturado; tudo o mais vem do FIT.
// ATENCAO: a conta usada na validacao de 30/10/2026 estava vazia, entao este leitor foi escrito contra a DESCRICAO da ferramenta e testado com formatos plausiveis (linhas
// "chave: valor" e JSON), NAO contra uma resposta real com atividades. Ele e' tolerante e nunca inventa: registro sem labelId E sportType e' ignorado.
export interface CorosRecord {
  labelId: string;
  sportType: number;
  startTimestamp: number | null;
  endTimestamp: number | null;
}

const FIELD = (name: string) => new RegExp(`["']?${name}["']?\\s*[:=]\\s*["']?([A-Za-z0-9_.-]+)`, 'i');
const LABEL = /["']?labelId["']?\s*[:=]\s*["']?([A-Za-z0-9_-]+)/gi;

function recordFrom(segment: string, lookbehind: string): CorosRecord | null {
  const label = FIELD('labelId').exec(segment)?.[1];
  const sport = FIELD('sportType').exec(segment)?.[1] ?? FIELD('sportType').exec(lookbehind)?.[1];
  if (!label || !sport || !/^\d+$/.test(sport)) return null;
  const ts = (name: string) => {
    const value = FIELD(name).exec(segment)?.[1];
    if (!value || !/^\d{9,13}$/.test(value)) return null;
    const n = Number(value);
    return n > 1e11 ? Math.round(n / 1000) : n; // aceita segundos ou milissegundos
  };
  return { labelId: label, sportType: Number(sport), startTimestamp: ts('startTimestamp'), endTimestamp: ts('endTimestamp') };
}

export function parseSportRecords(text: string): CorosRecord[] {
  const found = new Map<string, CorosRecord>();
  const matches = [...text.matchAll(LABEL)];
  matches.forEach((match, index) => {
    const start = match.index ?? 0;
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? text.length) : text.length;
    // campos de uma atividade podem vir ANTES do labelId (esporte, data) ou DEPOIS (sportType, timestamps): olha o trecho do labelId ate' o proximo e uma janela anterior
    const segment = text.slice(start, end);
    const lookbehind = text.slice(Math.max(0, start - 240), start);
    const record = recordFrom(segment, lookbehind);
    if (record && !found.has(record.labelId)) found.set(record.labelId, record);
  });
  return [...found.values()];
}

// Primeiro link https de download da resposta de queryActivityFitFileDownloadUrls (texto). So' https, nome de host de DNS (nunca IP, localhost ou rede interna).
export function firstFitUrl(text: string): string | null {
  for (const candidate of text.match(/https:\/\/[^\s"'<>)\]]+/g) ?? []) {
    try {
      const url = new URL(candidate.replace(/[.,;]+$/, ''));
      const host = url.hostname.toLowerCase();
      if (url.protocol !== 'https:' || url.username || url.password) continue;
      if (host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || /\.(local|internal|localhost)$/.test(host) || !host.includes('.')) continue;
      return url.toString();
    } catch { /* tenta o proximo */ }
  }
  return null;
}

// "limite diario de arquivos" da COROS (50 por 24 h por usuario): a ferramenta responde com erro de texto; qualquer mencao a limite/quota para a tentativa e deixa o resto para a proxima rodada.
export const isFitLimitMessage = (message: string) => /limit|quota|too many|exceed/i.test(message);

export const ymd = (date: Date) => date.toISOString().slice(0, 10).replace(/-/g, '');
