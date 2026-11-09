import { BACKUP_RETENTION_DAYS, BACKUP_SIZE_TIERS_MB, backupSizeAlert, BackupService } from '../src/backup/backup.service';

// 09/11/2026 (Elton): "aumentar o tamanho do backup, sem comprometer financeiramente e sem risco de perder dados". O backup nao tem limite de tamanho; o que mudou foi o AVISO (antes: todo dia acima de 20 MB).
const MB = 1024 * 1024;

describe('aviso de crescimento do backup (degraus)', () => {
  it('a faixa de 26,9 MB de hoje nao avisa mais (primeiro degrau = 100 MB)', () => {
    expect(BACKUP_SIZE_TIERS_MB[0]).toBe(100);
    expect(backupSizeAlert(26.9 * MB, 25 * MB).shouldAlert).toBe(false);
    expect(backupSizeAlert(26.9 * MB, null).shouldAlert).toBe(false);
  });
  it('avisa UMA vez ao cruzar um degrau, com o custo estimado e dizendo que nenhum dado esta em risco', () => {
    const alert = backupSizeAlert(105 * MB, 98 * MB);
    expect(alert).toMatchObject({ shouldAlert: true, tierMb: 100 });
    expect(alert.message).toContain('passou de 100 MB');
    expect(alert.message).toContain('Nenhum dado esta em risco');
    expect(alert.message).toContain(`${BACKUP_RETENTION_DAYS} dias de copias`);
    expect(alert.message).toMatch(/US\$ \d+\.\d{2} por mes/);
    expect(alert.message).toContain('Novo aviso so quando passar de 250 MB');
  });
  it('no dia seguinte, ainda acima do mesmo degrau, NAO repete o aviso', () => {
    expect(backupSizeAlert(108 * MB, 105 * MB).shouldAlert).toBe(false);
  });
  it('salto grande: avisa o degrau mais alto cruzado; sem backup anterior, avisa se ja estiver acima de um degrau', () => {
    expect(backupSizeAlert(600 * MB, 90 * MB)).toMatchObject({ shouldAlert: true, tierMb: 500 });
    expect(backupSizeAlert(120 * MB, null)).toMatchObject({ shouldAlert: true, tierMb: 100 });
  });
  it('ultimo degrau: diz que e o ultimo configurado', () => {
    expect(backupSizeAlert(2100 * MB, 1900 * MB).message).toContain('ultimo degrau');
  });
  it('estimativa de custo: ~100 MB x 15 copias a US$ 0,015/GB-mes fica em centavos', () => {
    const alert = backupSizeAlert(100 * MB, 50 * MB);
    const usd = Number(/US\$ (\d+\.\d{2}) por mes/.exec(alert.message)?.[1]);
    expect(usd).toBeLessThan(0.1);
  });
});

describe('o aviso diario usa o tamanho do backup anterior', () => {
  function service(result: { ok: boolean; sizeBytes?: number; previousSizeBytes?: number | null }) {
    const telegram = { notifyCoach: jest.fn().mockResolvedValue(undefined) };
    const instance = new BackupService({ get: jest.fn() } as never, telegram as never);
    jest.spyOn(instance, 'runBackup').mockResolvedValue(result as never);
    return { instance, telegram };
  }
  it('26,9 MB: nenhuma mensagem de aviso (backup ok)', async () => {
    const { instance, telegram } = service({ ok: true, sizeBytes: 26.9 * MB, previousSizeBytes: 26 * MB });
    await instance.runScheduledBackup();
    expect(telegram.notifyCoach).not.toHaveBeenCalled();
  });
  it('cruzou 100 MB: uma mensagem; falha do backup continua avisando como antes', async () => {
    const crossed = service({ ok: true, sizeBytes: 101 * MB, previousSizeBytes: 99 * MB });
    await crossed.instance.runScheduledBackup();
    expect(crossed.telegram.notifyCoach).toHaveBeenCalledTimes(1);
    const failed = service({ ok: false });
    await failed.instance.runScheduledBackup();
    expect(failed.telegram.notifyCoach.mock.calls[0][0]).toContain('Falha no backup diario');
  });
});
