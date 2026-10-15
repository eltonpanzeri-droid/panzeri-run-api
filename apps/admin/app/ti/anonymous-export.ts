// Exportacao ANONIMA das series mostradas no Training Intelligence (15/10/2026, plano de revitalizacao do admin,
// Fase 4 lote 4.6). So monta texto no navegador a partir do que a tela ja carregou; nada e gravado nem enviado.
//
// REGRA FIXA (decisao de Elton): o arquivo identifica a aluna so pelo CODIGO sequencial e leva idade, sexo, altura
// e peso. NUNCA entram nome, e-mail, CPF, telefone, endereco, data de nascimento exata, comentarios em texto livre
// nem texto de eventos de contexto. A lista de campos abaixo e' fechada: nao existe opcao para incluir o nome.
import type { Series, Snapshot, Variable } from './data';

export type ExportProfile = {
  studentCode: string;
  ageYears: number | null;
  sex: string;
  heightCm: number | null;
  weightKg: number | null;
};

type Input = {
  profile: ExportProfile;
  series: Series[];
  snapshots: Record<string, Snapshot>;
  legend: Variable[];
  range: [number, number];
  modalityName: (modality: string) => string;
};

const DAY_MS = 86400000;

function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildAnonymousExport({ profile, series, snapshots, legend, range, modalityName }: Input) {
  const rows: Array<{ date: string; indicator: string; value: string | number; unit: string; modality: string }> = [];
  const indicators: string[] = [];
  for (const item of series) {
    const snapshot = snapshots[item.key];
    if (!snapshot) continue;
    const variable = legend.find((candidate) => candidate.id === item.variableId) ?? snapshot.variable;
    const name = variable.constructLabel ?? variable.id;
    const unit = snapshot.variable.scale?.unit ?? '';
    const scale = snapshot.variable.scale ? `escala ${snapshot.variable.scale.min} a ${snapshot.variable.scale.max}${unit ? ` ${unit}` : ''}` : 'sem escala numérica';
    indicators.push(`${name} (${scale})`);
    for (const observation of snapshot.observations) {
      const at = Date.parse(observation.timestamp);
      if (Number.isNaN(at) || at < range[0] || at > range[1] + DAY_MS) continue;
      const modality = observation.context?.modality ?? item.modality ?? '';
      rows.push({ date: observation.timestamp.slice(0, 10), indicator: name, value: observation.value, unit, modality: modality ? modalityName(modality) : '' });
    }
  }
  rows.sort((a, b) => (a.date === b.date ? a.indicator.localeCompare(b.indicator, 'pt-BR') : a.date < b.date ? -1 : 1));

  const age = profile.ageYears != null ? profile.ageYears : '';
  const height = profile.heightCm != null ? Math.round(profile.heightCm) : '';
  const weight = profile.weightKg != null ? Math.round(profile.weightKg) : '';
  const sex = profile.sex || '';

  const header = ['aluna_codigo', 'idade_anos', 'sexo', 'altura_cm', 'peso_kg', 'data', 'indicador', 'valor', 'unidade', 'modalidade'];
  const csvLines = [header.join(';')];
  for (const row of rows) {
    // Excel em portugues espera virgula decimal.
    const value = typeof row.value === 'number' ? String(row.value).replace('.', ',') : row.value;
    csvLines.push([profile.studentCode, age, sex, height, weight, row.date, row.indicator, value, row.unit, row.modality].map(csvCell).join(';'));
  }

  const from = new Date(range[0]).toISOString().slice(0, 10);
  const to = new Date(range[1]).toISOString().slice(0, 10);
  const textLines = [
    'Dados ANONIMIZADOS de acompanhamento de treino (Panzeri Run). A pessoa é identificada só pelo código; não há nome nem contato.',
    `Aluna: código ${profile.studentCode}; idade ${age === '' ? 'não informada' : `${age} anos`}; sexo ${sex || 'não informado'}; altura ${height === '' ? 'não informada' : `${height} cm`}; peso ${weight === '' ? 'não informado' : `${weight} kg`}.`,
    `Período: ${from} a ${to}.`,
    `Indicadores: ${indicators.join('; ')}.`,
    'Cada linha: data | indicador | valor (unidade) | modalidade. Valores são registros da aluna ou do sistema; coincidência entre indicadores não demonstra causa.',
    '',
    ...rows.map((row) => `${row.date} | ${row.indicator} | ${row.value}${row.unit ? ` ${row.unit}` : ''}${row.modality ? ` | ${row.modality}` : ''}`),
  ];

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return {
    csv: csvLines.join('\r\n'),
    text: textLines.join('\n'),
    rows: rows.length,
    fileName: `panzeri-evolucao-${profile.studentCode}-${today}.csv`,
  };
}
