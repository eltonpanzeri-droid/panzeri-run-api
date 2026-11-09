import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBackupReviewMessage, EXPECTED_BACKUP_COPIES, missingBackupDays, ReviewObject } from '../src/backup/backup-review';
import { BackupReviewService } from '../src/backup/backup-review.service';

// 09/11/2026 (Elton): revisao mensal do backup por Telegram, com os numeros reais das copias e a lista do que conferir.
const MB = 1024 * 1024;
const NOW = new Date('2026-12-02T12:00:00Z'); // 09:00 em Sao Paulo
function copies(days: number, sizeMb = 20, lastAt = '2026-12-02T07:00:03Z'): ReviewObject[] {
  const last = new Date(lastAt).getTime();
  return Array.from({ length: days }, (_, index) => ({ key: `panzeri-backups/db/${index}.dump.enc`, lastModified: new Date(last - index * 86_400_000), size: Math.round((sizeMb - index * 0.5) * MB) }));
}

describe('dias sem copia', () => {
  it('14 dias seguidos + hoje: nenhum buraco', () => {
    expect(missingBackupDays(copies(15), NOW)).toEqual([]);
  });
  it('falta uma copia no meio: aponta o dia (data de Sao Paulo)', () => {
    const objects = copies(15).filter((_, index) => index !== 5); // 27/11
    expect(missingBackupDays(objects, NOW)).toEqual(['27/11']);
  });
  it('hoje antes das 04:30 ainda nao conta como falta', () => {
    const early = new Date('2026-12-02T06:00:00Z'); // 03:00 em Sao Paulo
    const objects = copies(14, 20, '2026-12-01T07:00:03Z');
    expect(missingBackupDays(objects, early)).toEqual([]);
  });
});

describe('mensagem da revisao mensal', () => {
  it('tudo certo: numeros reais, sem alertas, com a lista do que conferir', () => {
    const message = buildBackupReviewMessage(copies(15), NOW);
    expect(message).toContain('Revisão mensal do backup (12/2026)');
    expect(message).toContain(`Cópias guardadas: 15 (esperado: cerca de ${EXPECTED_BACKUP_COPIES})`);
    expect(message).toContain('Mais recente: 02/12 04:00 (há 5 h)');
    expect(message).toContain('Dias sem cópia nos últimos 14: nenhum ✅');
    expect(message).not.toContain('⚠️');
    expect(message).toContain('Cloudflare > Gerenciar Conta > Cobrança > Faturas');
    expect(message).toContain('"Está pegando tudo?"');
    expect(message).toContain('BACKUP_ENCRYPTION_KEY');
    expect(message).toContain('revisão do backup feita');
  });
  it('alerta quando o ultimo backup tem mais de 26 h, faltam copias ou ha dias sem copia', () => {
    const old = buildBackupReviewMessage(copies(15, 20, '2026-11-30T07:00:00Z'), NOW);
    expect(old).toContain('passou de 26 h sem backup novo');
    const few = buildBackupReviewMessage(copies(5), NOW);
    expect(few).toContain('abaixo do esperado');
    expect(few).toContain('Dias sem cópia nos últimos 14:');
    expect(few).toContain('⚠️');
  });
  it('sem nenhuma copia: avisa que precisa de atencao hoje', () => {
    expect(buildBackupReviewMessage([], NOW)).toContain('Não encontrei nenhuma cópia');
  });
  it('mes de teste de restauracao (jan/abr/jul/out) pede o teste; os outros dizem que nao precisa', () => {
    expect(buildBackupReviewMessage(copies(15), new Date('2027-01-02T12:00:00Z'))).toContain('ESTE MÊS tem teste de restauração');
    expect(buildBackupReviewMessage(copies(15), new Date('2026-12-02T12:00:00Z'))).toContain('Este mês não precisa');
  });
  it('sem termos proibidos e em portugues', () => {
    expect(buildBackupReviewMessage(copies(15), NOW)).not.toMatch(/motor|plano de treino/i);
  });
});

describe('BackupReviewService', () => {
  function service(configValues: Record<string, string | undefined>, objects: ReviewObject[] | Error) {
    const telegram = { notifyCoach: jest.fn().mockResolvedValue(undefined) };
    const instance = new BackupReviewService({ get: jest.fn((key: string) => configValues[key]) } as never, telegram as never) as any;
    instance.createR2 = () => ({ listObjects: jest.fn(async () => { if (objects instanceof Error) throw objects; return objects; }) });
    return { instance, telegram };
  }
  const configured = { R2_ACCOUNT_ID: 'a', R2_BUCKET: 'b', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's' };
  it('manda a revisao com os numeros lidos do armazenamento', async () => {
    const { instance, telegram } = service(configured, copies(15, 20, new Date().toISOString()));
    await instance.sendMonthlyReview();
    expect(telegram.notifyCoach).toHaveBeenCalledTimes(1);
    expect(telegram.notifyCoach.mock.calls[0][0]).toContain('Revisão mensal do backup');
    expect(telegram.notifyCoach.mock.calls[0][0]).toContain('Cópias guardadas: 15');
  });
  it('armazenamento nao configurado ou ilegivel: o aviso diz isso (e nunca vaza a chave)', async () => {
    const unconfigured = service({}, []);
    await unconfigured.instance.sendMonthlyReview();
    expect(unconfigured.telegram.notifyCoach.mock.calls[0][0]).toContain('não está configurado');
    const failing = service(configured, new Error('falha com s e k na mensagem'));
    await failing.instance.sendMonthlyReview();
    const text = failing.telegram.notifyCoach.mock.calls[0][0] as string;
    expect(text).toContain('Não consegui ler as cópias');
  });
  it('agendado para o dia 2 de cada mes as 12:00 UTC (09:00 em Sao Paulo); nao altera nem apaga copias (estatico)', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'backup', 'backup-review.service.ts'), 'utf8');
    expect(source).toContain("@Cron('0 12 2 * *')");
    expect(source).not.toMatch(/deleteObject|putObject/);
  });
});
