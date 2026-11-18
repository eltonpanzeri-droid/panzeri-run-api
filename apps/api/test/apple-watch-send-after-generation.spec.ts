import { readFileSync } from 'fs';
import { join } from 'path';
import { withWatchSendLock } from '../../mobile/src/appleWatchDelivery/watchSendLock';

// 18/11/2026 (caso Volnei): o envio ao Apple Watch sai assim que a geracao termina, e nunca duas rodadas ao mesmo tempo.
describe('trava de envio ao Apple Watch', () => {
  it('rodadas simultaneas rodam uma depois da outra, na ordem', async () => {
    const log: string[] = [];
    const slow = () => new Promise<void>((resolve) => setTimeout(() => { log.push('a'); resolve(); }, 30));
    const fast = async () => { log.push('b'); };
    await Promise.all([withWatchSendLock(slow), withWatchSendLock(fast)]);
    expect(log).toEqual(['a', 'b']);
  });
  it('erro de uma rodada nao trava a proxima', async () => {
    await expect(withWatchSendLock(async () => { throw new Error('falhou'); })).rejects.toThrow('falhou');
    await expect(withWatchSendLock(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('ligacao na tela da semana', () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, '..', '..', 'mobile', ...p), 'utf8');
  it('os dois caminhos de sucesso da geracao enviam ao relogio e mostram o resultado', () => {
    const app = read('App.tsx');
    expect(app).toContain("import { sendWeekAfterGeneration } from './src/appleWatchDelivery/sendAfterGeneration';");
    expect(app.match(/void announceWatchSend\(\);/g)?.length).toBe(2);
    expect(app).toContain('if (message) setStatus(message);');
  });
  it('o envio da abertura e o da geracao usam a mesma trava, e so valem apos o primeiro envio manual', () => {
    expect(read('src', 'appleWatchDelivery', 'useAppleWatchAutoSend.ts')).toContain('withWatchSendLock(() => autoSendWeekToAppleWatch(');
    const after = read('src', 'appleWatchDelivery', 'sendAfterGeneration.ts');
    expect(after).toContain('withWatchSendLock(() => syncWeekToAppleWatch(');
    expect(after).toContain("AUTO_SEND_STORAGE_KEY)) !== '1') return null");
    expect(after).toContain('if (!isAppleHealthSupported) return null;');
  });
});
