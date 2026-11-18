// Ritmo ou velocidade na prescricao (18/11/2026, pedido da aluna Thais via Elton): o aluno escolhe ver o ritmo (min/km) ou a velocidade correspondente (km/h). Funcao pura: so' converte o TEXTO
// que o Panzeri Run ja' mostra ("5:40/km a 6:00/km" -> "10,0 a 10,6 km/h"); nao muda a prescricao nem o que vai ao relogio.
export type PaceView = 'pace' | 'speed';

const fmt = (value: number) => value.toFixed(1).replace('.', ',');

export function paceTextForView(text: string | null | undefined, view: PaceView): string | undefined {
  if (!text) return undefined;
  if (view !== 'speed') return text;
  const seconds = [...text.matchAll(/(\d+):(\d{2})/g)].map((match) => Number(match[1]) * 60 + Number(match[2])).filter((value) => value > 0);
  if (seconds.length === 0) return text; // texto sem ritmo reconhecivel fica como esta
  const speeds = seconds.map((value) => 3600 / value).sort((left, right) => left - right);
  const low = fmt(speeds[0]);
  const high = fmt(speeds[speeds.length - 1]);
  return low === high ? `${low} km/h` : `${low} a ${high} km/h`;
}

export const paceViewOptionLabel = (view: PaceView): string => (view === 'speed' ? 'Velocidade (km/h)' : 'Ritmo (min/km)');

export const paceViewLabel = (view: PaceView): string => (view === 'speed' ? 'Velocidade' : 'Pace');
