import { doneDateLabel, painLine, prescribedDateLabel, trainingNumberLabel } from '../src/workout-completions/feedback-telegram-lines';

// 10/11/2026: o aviso de feedback no Telegram traz numero do treino, data prescrita, data realizada e a dor (sem dor marcado vem como "sem dor").
describe('linhas do aviso de feedback no Telegram', () => {
  it('numero do treino: posicao no programa e codigo do programa; sem posicao so o codigo', () => {
    expect(trainingNumberLabel(2, 7, 65)).toBe('Treino 3 de 7 do programa Cód. 65');
    expect(trainingNumberLabel(null, 0, 65)).toBe('Treino do programa Cód. 65');
    expect(trainingNumberLabel(0, 1, null)).toBe('Treino 1 de 1 do programa');
  });
  it('datas: prescrita e a data-calendario (meia-noite UTC, sem virar o dia); realizada no fuso de Sao Paulo', () => {
    expect(prescribedDateLabel(new Date('2026-11-10T00:00:00Z'))).toMatch(/ter.*10\/11\/2026/);
    expect(doneDateLabel(new Date('2026-11-10T01:30:00Z'))).toBe('09/11/2026'); // 22h30 de 09/11 em Sao Paulo
    expect(doneDateLabel(new Date('2026-11-10T15:00:00Z'))).toBe('10/11/2026');
    expect(doneDateLabel(null)).toBe('não informada');
  });
  it('dor: "sem dor" marcado aparece como sem dor; nao respondida diz que nao respondeu; com dor traz grau, momento e relato de hoje', () => {
    expect(painLine({ painFlag: 'none' })).toBe('🩹 Dor durante o treino: sem dor');
    expect(painLine({ painFlag: undefined })).toBe('🩹 Dor durante o treino: não respondida');
    expect(painLine({ painFlag: 'moderado', timingLabel: 'durante o treino' })).toBe('🩹 Dor durante o treino: Moderado — durante o treino');
    expect(painLine({ painFlag: 'forte', todayReport: { intensity: 7, regions: ['joelho', 'tornozelo'] } })).toBe('🩹 Dor durante o treino: Forte | relato de dor de hoje: 7/10 (joelho, tornozelo)');
  });
});
