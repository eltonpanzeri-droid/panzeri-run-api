// Revisao mensal do backup (09/11/2026, ordem do Elton): todo mes o Panzeri Run manda no Telegram os numeros reais das copias guardadas e a lista do que conferir. Modulo PURO (sem rede nem banco).
// Nao decide nada e nao altera nada: so' le o que ja existe e lembra o Elton de revisar.

export interface ReviewObject { key: string; lastModified: Date; size: number }

export const EXPECTED_BACKUP_COPIES = 15; // 14 dias de retencao + a copia de hoje
export const MAX_HOURS_SINCE_LAST_BACKUP = 26; // backup diario as 04:00 (Sao Paulo): acima disto algo falhou
export const RESTORE_TEST_MONTHS = [1, 4, 7, 10]; // teste de restauracao a cada 3 meses (RUNBOOKS/2026-10-05-BACKUP-RESTORE.md)

const MB = 1024 * 1024;
const two = (n: number) => String(n).padStart(2, '0');
const brDate = (date: Date) => {
  const local = new Date(date.getTime() - 3 * 3600_000);
  return `${two(local.getUTCDate())}/${two(local.getUTCMonth() + 1)}`;
};
const brDateTime = (date: Date) => {
  const local = new Date(date.getTime() - 3 * 3600_000);
  return `${brDate(date)} ${two(local.getUTCHours())}:${two(local.getUTCMinutes())}`;
};
const dayKey = (date: Date) => new Date(date.getTime() - 3 * 3600_000).toISOString().slice(0, 10);

// Dias dos ultimos 14 sem nenhuma copia (dia de Sao Paulo). O dia de hoje so' conta se o backup de hoje ja' deveria ter rodado (depois das 04:30).
export function missingBackupDays(objects: ReviewObject[], now: Date, windowDays = 14): string[] {
  const have = new Set(objects.map((object) => dayKey(object.lastModified)));
  const missing: string[] = [];
  for (let offset = 0; offset < windowDays; offset++) {
    const day = new Date(now.getTime() - offset * 86_400_000);
    if (offset === 0) {
      const local = new Date(now.getTime() - 3 * 3600_000);
      if (local.getUTCHours() * 60 + local.getUTCMinutes() < 4 * 60 + 30) continue;
    }
    if (!have.has(dayKey(day))) missing.push(brDate(day));
  }
  return missing.reverse();
}

export function buildBackupReviewMessage(objects: ReviewObject[], now: Date = new Date()): string {
  const monthLocal = new Date(now.getTime() - 3 * 3600_000);
  const monthNumber = monthLocal.getUTCMonth() + 1;
  const title = `📋 Revisão mensal do backup (${two(monthNumber)}/${monthLocal.getUTCFullYear()})`;
  const lines: string[] = [title, ''];

  const sorted = [...objects].sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime());
  if (sorted.length === 0) {
    lines.push('⚠️ Não encontrei nenhuma cópia no armazenamento. Isso precisa de atenção hoje: peça ao Claude para investigar o backup.');
  } else {
    const newest = sorted[sorted.length - 1];
    const oldest = sorted[0];
    const hours = (now.getTime() - newest.lastModified.getTime()) / 3600_000;
    const total = sorted.reduce((sum, object) => sum + object.size, 0);
    const missing = missingBackupDays(sorted, now);
    lines.push('Números de hoje (lidos do armazenamento):');
    lines.push(`- Cópias guardadas: ${sorted.length} (esperado: cerca de ${EXPECTED_BACKUP_COPIES})${sorted.length < EXPECTED_BACKUP_COPIES - 1 ? ' ⚠️ abaixo do esperado' : ''}`);
    lines.push(`- Mais recente: ${brDateTime(newest.lastModified)} (há ${Math.round(hours)} h)${hours > MAX_HOURS_SINCE_LAST_BACKUP ? ' ⚠️ passou de 26 h sem backup novo' : ''}`);
    lines.push(`- Mais antiga: ${brDate(oldest.lastModified)}`);
    lines.push(`- Tamanho: a mais recente tem ${(newest.size / MB).toFixed(1)} MB; a mais antiga tinha ${(oldest.size / MB).toFixed(1)} MB; total guardado ${(total / MB).toFixed(0)} MB`);
    lines.push(missing.length === 0 ? '- Dias sem cópia nos últimos 14: nenhum ✅' : `- Dias sem cópia nos últimos 14: ${missing.join(', ')} ⚠️`);
  }

  lines.push('', 'O que conferir (uns 5 minutos):');
  lines.push('1. Custo: Cloudflare > Gerenciar Conta > Cobrança > Faturas. Deve continuar US$ 0,00.');
  lines.push('2. "Está pegando tudo?": o backup copia o banco inteiro. De propósito ficam de fora só o CONTEÚDO de: dados do Strava (regra da Strava), conexões e chaves de integrações (Wahoo, Polar, Garmin e outras: a aluna reconecta depois de uma restauração) e a fila temporária de eventos. Se criamos algo novo desde o mês passado, diga ao Claude: "confira se o que criamos entra no backup".');
  lines.push(RESTORE_TEST_MONTHS.includes(monthNumber)
    ? '3. ESTE MÊS tem teste de restauração (a cada 3 meses): peça ao Claude o passo a passo do teste, que está em RUNBOOKS/2026-10-05-BACKUP-RESTORE.md.'
    : '3. Teste de restauração: acontece a cada 3 meses (janeiro, abril, julho e outubro). Este mês não precisa.');
  lines.push('4. Notebook: o último trabalho foi enviado ao GitHub (Push)? As chaves, principalmente a BACKUP_ENCRYPTION_KEY, estão no seu gerenciador de senhas?');
  lines.push('5. Quando terminar, diga ao Claude: "revisão do backup feita". Ele registra no PRONTUARIO.');
  return lines.join('\n');
}

// Lembrete SEMANAL do que esta no computador (09/11/2026, ordem do Elton: "coloque um lembrete semanal para eu revisar as chaves e os backups do que tem no computador"). O servidor nao enxerga o notebook:
// so' lembra. Sexta-feira as 17:00 (Sao Paulo). Sem dados lidos de lugar nenhum.
export function buildWeeklyLocalBackupReminder(): string {
  return [
    '🗓️ Lembrete semanal: backup do que está no seu computador',
    '',
    '1. Push: abra o GitHub Desktop e dê o Push. Até isso, o trabalho da semana só existe no notebook.',
    '2. Dois cliques em copiar-memoria-claude-para-onedrive.bat (na pasta do projeto). Ele copia a memória do Claude e a pasta da Garmin para OneDrive > Documentos > Backup-Panzeri-Run. Só copia, nunca apaga.',
    '3. Chaves: elas estão no EasyPanel e também no seu e-mail "dados easypanel" (Gmail). Conferiu se alguma chave mudou desde o último envio? Se mudou, mande o e-mail de novo ou atualize. Sem a BACKUP_ENCRYPTION_KEY, nenhuma cópia do banco pode ser aberta. Lembre: quem entra no seu Gmail entra no sistema; mantenha a verificação em duas etapas da conta Google ligada e não apague esse e-mail.',
    '4. Quando terminar, diga ao Claude: "revisão semanal feita". Ele registra a data no PRONTUARIO.',
    '',
    'Guia completo: RUNBOOKS/2026-11-09-BACKUP-DO-NOTEBOOK.md',
  ].join('\n');
}
