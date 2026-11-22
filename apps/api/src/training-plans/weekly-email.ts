// E-mail do programa da semana (22/11/2026, ordem de Elton): resumo da semana passada + o que vem nesta semana com o objetivo de cada treino, em cartoes e barras (HTML),
// para gerar conexao e vontade de evoluir. Funcoes PURAS: recebem numeros e textos ja prontos (contas simples de soma/comparacao, nada que escolha treino) e devolvem HTML e texto.
// E-mail nao executa script: o "interativo" fica no botao que abre o Panzeri Run. Layout em tabelas e estilos inline (funciona em Gmail/Outlook/Apple Mail).

export interface WeeklyEmailDay { weekdayLabel: string; dateLabel: string; title: string; durationMin: number | null; distanceKm: number | null; zone: string | null; objective: string | null }
export interface WeeklyEmailLastWeek {
  prescribed: number; done: number; km: number; minutes: number; longestKm: number | null;
  previousKm: number | null; // semana retrasada, so' para comparar
  kmByWeekday: number[]; // 7 posicoes, segunda..domingo
  unregistered: number;
  medals: string[];
}
export interface WeeklyEmailData { goal: string | null; weekLabel: string; lastWeek: WeeklyEmailLastWeek | null; days: WeeklyEmailDay[]; appUrl: string }

const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (value: number) => (Math.round(value * 10) / 10).toString().replace('.', ',');
export const durationLabel = (minutes: number) => (minutes >= 60 ? `${Math.floor(minutes / 60)}h${String(Math.round(minutes % 60)).padStart(2, '0')}` : `${Math.round(minutes)} min`);
const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

// Primeira frase do objetivo (texto que a IA ja escreveu para o treino), no maximo 150 caracteres.
export function shortObjective(text: string | null | undefined): string | null {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const first = clean.split(/(?<=[.!?])\s/)[0];
  return first.length <= 150 ? first : `${first.slice(0, 147).trimEnd()}…`;
}

// Frase de reconhecimento da semana passada: acolhedora, sem cobranca e sem inventar nada.
export function recognitionLine(last: WeeklyEmailLastWeek | null): string {
  if (!last || last.prescribed === 0) return 'Cada semana é uma nova chance de evoluir. Vamos juntos nesta?';
  if (last.done === 0) return 'A semana passada foi difícil de encaixar, e tudo bem: recomeçar também é parte do processo. Vamos para esta semana.';
  if (last.done >= last.prescribed) return 'Você fez todos os treinos da semana passada. Que consistência! É assim que a evolução acontece.';
  return `Você fez ${last.done} dos ${last.prescribed} treinos da semana passada. Cada treino conta. Vamos para mais uma semana!`;
}

export function kmComparison(last: WeeklyEmailLastWeek): string | null {
  if (last.previousKm == null || last.previousKm <= 0 || last.km <= 0) return null;
  const diff = Math.round((last.km - last.previousKm) * 10) / 10;
  if (diff === 0) return 'Mesmo volume da semana anterior.';
  return diff > 0 ? `${num(diff)} km a mais que na semana anterior.` : `${num(Math.abs(diff))} km a menos que na semana anterior.`;
}

function bar(percent: number, color = '#14b8a6'): string {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr><td style="background:#e2e8f0;border-radius:6px;height:10px;font-size:0;line-height:0;"><table role="presentation" width="${p}%" cellpadding="0" cellspacing="0"><tr><td style="background:${color};border-radius:6px;height:10px;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr></table>`;
}

function weekChart(kmByWeekday: number[]): string {
  const max = Math.max(...kmByWeekday, 0);
  if (max <= 0) return '';
  const cells = kmByWeekday.map((km, index) => {
    const height = km > 0 ? Math.max(6, Math.round((km / max) * 70)) : 3;
    const label = km > 0 ? `<div style="font-size:11px;color:#475569;margin-bottom:3px;">${num(km)}</div>` : '<div style="font-size:11px;margin-bottom:3px;">&nbsp;</div>';
    return `<td align="center" valign="bottom" style="padding:0 3px;height:100px;">${label}<div style="height:${height}px;background:${km > 0 ? '#14b8a6' : '#e2e8f0'};border-radius:4px 4px 0 0;font-size:0;line-height:0;">&nbsp;</div><div style="font-size:11px;color:#64748b;margin-top:4px;">${WEEKDAYS[index]}</div></td>`;
  });
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;"><tr>${cells.join('')}</tr></table><div style="font-size:11px;color:#94a3b8;margin-top:2px;">km por dia</div>`;
}

const chip = (text: string) => `<span style="display:inline-block;background:#f1f5f9;color:#334155;border-radius:999px;padding:3px 10px;font-size:12px;margin:0 6px 4px 0;">${esc(text)}</span>`;

export function weeklyEmailHtml(input: { firstName: string; data: WeeklyEmailData; baseMessage: string; appleWatchNote: string | null }): string {
  const { firstName, data, baseMessage, appleWatchNote } = input;
  const last = data.lastWeek;
  const percent = last && last.prescribed > 0 ? (last.done / last.prescribed) * 100 : 0;
  const comparison = last ? kmComparison(last) : null;

  const lastCard = last && last.prescribed + last.km > 0 ? `
    <tr><td style="padding:0 20px 16px 20px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;border:1px solid #e2e8f0;"><tr><td style="padding:18px;">
        <div style="font-size:12px;letter-spacing:1px;color:#0f766e;font-weight:700;">COMO FOI A SUA SEMANA</div>
        <div style="font-size:30px;font-weight:800;color:#0f172a;margin-top:6px;">${last.done} <span style="font-size:16px;font-weight:600;color:#64748b;">de ${last.prescribed} treinos</span></div>
        <div style="margin:10px 0 14px 0;">${bar(percent)}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td width="33%" style="padding-right:6px;"><div style="font-size:20px;font-weight:700;color:#0f172a;">${last.km > 0 ? `${num(last.km)} km` : '—'}</div><div style="font-size:12px;color:#64748b;">distância</div></td>
          <td width="33%" style="padding-right:6px;"><div style="font-size:20px;font-weight:700;color:#0f172a;">${last.minutes > 0 ? durationLabel(last.minutes) : '—'}</div><div style="font-size:12px;color:#64748b;">tempo</div></td>
          <td width="33%"><div style="font-size:20px;font-weight:700;color:#0f172a;">${last.longestKm ? `${num(last.longestKm)} km` : '—'}</div><div style="font-size:12px;color:#64748b;">treino mais longo</div></td>
        </tr></table>
        ${weekChart(last.kmByWeekday)}
        ${comparison ? `<div style="margin-top:12px;font-size:13px;color:#0f766e;font-weight:600;">${esc(comparison)}</div>` : ''}
        ${last.medals.length > 0 ? `<div style="margin-top:12px;">${last.medals.map((m) => `<span style="display:inline-block;background:#fef3c7;color:#92400e;border-radius:999px;padding:4px 12px;font-size:12px;font-weight:700;margin:0 6px 4px 0;">🏅 ${esc(m)}</span>`).join('')}</div>` : ''}
        <div style="margin-top:12px;font-size:14px;color:#334155;line-height:1.5;">${esc(recognitionLine(last))}</div>
        ${last.unregistered > 0 ? `<div style="margin-top:8px;font-size:12px;color:#92400e;line-height:1.5;">${esc(baseMessage)}</div>` : ''}
      </td></tr></table>
    </td></tr>` : `
    <tr><td style="padding:0 20px 16px 20px;"><div style="background:#ffffff;border-radius:14px;border:1px solid #e2e8f0;padding:18px;font-size:14px;color:#334155;line-height:1.5;">${esc(recognitionLine(last))}</div></td></tr>`;

  const dayCards = data.days.map((day) => `
        <tr><td style="padding:0 0 10px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;"><tr>
            <td width="64" align="center" valign="top" style="padding:14px 0 14px 12px;"><div style="background:#0f766e;color:#ffffff;border-radius:10px;padding:8px 0;"><div style="font-size:11px;letter-spacing:1px;font-weight:700;">${esc(day.weekdayLabel.toUpperCase())}</div><div style="font-size:15px;font-weight:800;">${esc(day.dateLabel)}</div></div></td>
            <td valign="top" style="padding:14px 14px 10px 12px;">
              <div style="font-size:16px;font-weight:700;color:#0f172a;">${esc(day.title)}</div>
              <div style="margin-top:6px;">${[day.durationMin ? chip(durationLabel(day.durationMin)) : '', day.distanceKm ? chip(`${num(day.distanceKm)} km`) : '', day.zone ? chip(day.zone) : ''].join('')}</div>
              ${day.objective ? `<div style="margin-top:4px;font-size:13px;color:#475569;line-height:1.5;"><strong style="color:#0f766e;">Objetivo:</strong> ${esc(day.objective)}</div>` : ''}
            </td>
          </tr></table>
        </td></tr>`).join('');

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Seu novo programa de treino chegou</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:16px 0;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;">
    <tr><td style="padding:0 20px 16px 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border-radius:16px;"><tr><td style="padding:24px;">
      <div style="font-size:12px;letter-spacing:2px;color:#5eead4;font-weight:800;">PANZERI RUN</div>
      <div style="font-size:24px;font-weight:800;color:#ffffff;margin-top:8px;">Olá, ${esc(firstName)}! Seu programa da semana chegou.</div>
      <div style="font-size:14px;color:#cbd5e1;margin-top:6px;">${esc(data.weekLabel)}${data.goal ? ` · Objetivo: ${esc(data.goal)}` : ''}</div>
    </td></tr></table></td></tr>
    ${lastCard}
    <tr><td style="padding:0 20px;"><div style="font-size:12px;letter-spacing:1px;color:#0f766e;font-weight:700;margin:4px 0 10px 0;">O QUE VEM NESTA SEMANA</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${dayCards}</table>
    </td></tr>
    <tr><td align="center" style="padding:8px 20px 20px 20px;"><a href="${esc(data.appUrl)}" style="display:inline-block;background:#14b8a6;color:#052e2b;font-weight:800;font-size:16px;text-decoration:none;border-radius:12px;padding:14px 28px;">Abrir o Panzeri Run</a></td></tr>
    ${appleWatchNote ? `<tr><td style="padding:0 20px 16px 20px;"><div style="background:#e0f2fe;color:#075985;border-radius:12px;padding:12px 16px;font-size:13px;line-height:1.5;">${esc(appleWatchNote)}</div></td></tr>` : ''}
    <tr><td align="center" style="padding:0 20px 8px 20px;font-size:12px;color:#94a3b8;">Panzeri Run · seu treinamento, sua evolução</td></tr>
  </table>
</td></tr></table></body></html>`;
}

// Versao em texto (leitores sem HTML e resumo para busca/registro).
export function weeklyEmailText(input: { firstName: string; data: WeeklyEmailData; baseMessage: string; appleWatchNote: string | null }): string {
  const { firstName, data, baseMessage, appleWatchNote } = input;
  const last = data.lastWeek;
  const lines: string[] = [`Olá ${firstName},`, `Seu programa de treino da semana está pronto (${data.weekLabel}).`];
  if (last && last.prescribed + last.km > 0) {
    const parts = [`${last.done} de ${last.prescribed} treinos`, last.km > 0 ? `${num(last.km)} km` : null, last.minutes > 0 ? durationLabel(last.minutes) : null].filter(Boolean);
    lines.push(`Como foi a sua semana: ${parts.join(' · ')}.`);
    const comparison = kmComparison(last);
    if (comparison) lines.push(comparison);
    if (last.medals.length > 0) lines.push(`Conquistas: ${last.medals.join(', ')}.`);
  }
  lines.push(recognitionLine(last));
  if (last && last.unregistered > 0) lines.push(baseMessage);
  lines.push('O que vem nesta semana:');
  for (const day of data.days) {
    const info = [day.durationMin ? durationLabel(day.durationMin) : null, day.distanceKm ? `${num(day.distanceKm)} km` : null, day.zone].filter(Boolean).join(' · ');
    lines.push(`- ${day.weekdayLabel} ${day.dateLabel}: ${day.title}${info ? ` (${info})` : ''}${day.objective ? `. Objetivo: ${day.objective}` : ''}`);
  }
  lines.push(`Abra o Panzeri Run: ${data.appUrl}`);
  if (appleWatchNote) lines.push(appleWatchNote);
  lines.push('Panzeri Run');
  return lines.join('\n\n');
}
