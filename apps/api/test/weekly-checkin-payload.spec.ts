import { ValidationPipe } from '@nestjs/common';
import { SubmitWeeklyCheckInDto } from '../src/training-plans/dto/submit-weekly-checkin.dto';

// 11/10/2026 — regressao: o status do check-in passou a devolver `additionalActivities` (07/10) e apps ja publicados reenviam o resumo inteiro.
// Com o mesmo ValidationPipe da producao (main.ts: forbidNonWhitelisted), o envio dava 400 e o aluno nao conseguia gerar o treino.
describe('SubmitWeeklyCheckInDto — payload real do app', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const validate = (value: unknown) => pipe.transform(value, { type: 'body', metatype: SubmitWeeklyCheckInDto });
  const base = {
    asPrescribedSessions: 3, changedModalitySessions: 0, differentSessions: 0, missedSessions: 1,
    prescriptionLiking: 4, prescriptionSuitability: 4, executionSatisfaction: 3, weekDemandVsNormal: 3,
    bodyResponseVsNormal: 3, postWeekMotivation: 4, expectedRoutineInterference: 2,
    preferredNextWeekTraining: 'evento_proximo_considerar', freeTextObservation: '', checkinVersion: 3,
  };

  it('aceita o resumo completo do status (com additionalActivities), como apps ja publicados enviam', async () => {
    await expect(validate({ ...base, additionalActivities: 2 })).resolves.toBeDefined();
    await expect(validate({ ...base, additionalActivities: 0 })).resolves.toBeDefined();
  });

  it('aceita o payload so com os quatro numeros (app atual)', async () => {
    await expect(validate(base)).resolves.toBeDefined();
  });

  it('continua rejeitando campos desconhecidos de verdade', async () => {
    await expect(validate({ ...base, campoInventado: 1 })).rejects.toBeDefined();
  });
});
