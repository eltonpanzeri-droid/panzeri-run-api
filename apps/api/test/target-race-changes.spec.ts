import { readFileSync } from 'fs';
import { join } from 'path';
import { NotFoundException } from '@nestjs/common';
import { TargetRacesService } from '../src/target-races/target-races.service';
import { describeRaceChanges } from '../src/target-races/target-race-messages';
import { ProfileEventCode } from '../src/training-plans/student-profile.service';

// Alterar (dados ou status) e excluir meta: aviso ao treinador + Prontuario; a aluna nao recebe nada; reenvio sem mudanca nao avisa.
const DATE = new Date('2026-11-15T12:00:00.000Z');
type RaceRow = { [key: string]: unknown };
const existing: RaceRow & { id: string; userId: string; name: string; raceDate: Date; distanceKm: number; targetSeconds: number | null; notes: string | null; anxietyLevel: number | null } = {
  id: 'r1', userId: 'u1', name: 'Meia de BH', raceDate: DATE, distanceKm: 21, targetSeconds: 7200, priority: 'principal', status: 'em_andamento', notes: null,
  isFirstTimeAtDistance: true, performanceIntent: 9, socialIntent: null, personalImportance: null, perceivedDifficulty: null, dedicationWillingness: null,
  achievementSatisfaction: null, confidenceLevel: null, injuryConcern: null, adjustmentOpenness: null, anxietyLevel: 5,
};

function build(updated: Partial<typeof existing> | null = null, opts: { owner?: string; telegramFails?: boolean; profileFails?: boolean } = {}) {
  const after = { ...existing, ...(updated ?? {}) };
  const prisma = {
    targetRace: {
      findUnique: jest.fn().mockResolvedValue({ ...existing, userId: opts.owner ?? 'u1' }),
      update: jest.fn().mockResolvedValue(after),
      delete: jest.fn().mockResolvedValue(existing),
    },
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Thalita Rodrigues', studentCode: 321 }) },
    weeklyAvailability: { findMany: jest.fn().mockResolvedValue([{ weekday: 0, noTraining: false }, { weekday: 6, noTraining: false }]) },
    trainingSession: { findFirst: jest.fn().mockResolvedValue({ completion: { distanceKm: 30 } }) },
  };
  const telegram = { notifyCoach: jest.fn(opts.telegramFails ? async (_t: string) => { throw new Error('fora'); } : async (_t: string) => undefined) };
  const painReports = { computeSafetyTier: jest.fn().mockResolvedValue({ tier: 'normal' }) };
  const studentProfile = { recordEvent: jest.fn(opts.profileFails ? async (_u: string, _c: string, _t: string) => { throw new Error('fora'); } : async (_u: string, _c: string, _t: string) => undefined) };
  const service = new TargetRacesService(prisma as never, telegram as never, painReports as never, studentProfile as never);
  return { service, prisma, telegram, studentProfile };
}

describe('alteracao de meta', () => {
  it('mudanca de STATUS: uma mensagem ao treinador ("antes -> depois") e um evento no Prontuario', async () => {
    const t = build({ status: 'concluida' });
    await t.service.update('u1', 'r1', { status: 'concluida' } as never);
    expect(t.telegram.notifyCoach).toHaveBeenCalledTimes(1);
    const text = t.telegram.notifyCoach.mock.calls[0][0];
    expect(text).toContain('Status de meta de prova alterado');
    expect(text).toContain('Thalita Rodrigues');
    expect(text).toContain('Status: em andamento -> concluida');
    expect(text).not.toContain('Merece um olhar');
    expect(t.studentProfile.recordEvent).toHaveBeenCalledWith('u1', ProfileEventCode.TARGET_RACE_CHANGED, expect.stringContaining('Status: em andamento -> concluida'));
  });

  it('mudanca de dados: lista exatamente o que mudou (data, distancia, tempo, observacao, nota)', async () => {
    const t = build({ raceDate: new Date('2026-12-06T12:00:00.000Z'), distanceKm: 10, targetSeconds: null, notes: 'Agora e 10k', anxietyLevel: 8 });
    await t.service.update('u1', 'r1', { distanceKm: 10 } as never);
    const text = t.telegram.notifyCoach.mock.calls[0][0];
    expect(text).toContain('✏️ Meta de prova alterada');
    expect(text).toContain('Data: 15/11/2026 -> 06/12/2026');
    expect(text).toContain('Distancia: 21 km -> 10 km');
    expect(text).toContain('Tempo-alvo: 2h00min00s -> sem tempo-alvo');
    expect(text).toContain('Observacao: (vazio) -> Agora e 10k');
    expect(text).toContain('ansiedade: 5/10 -> 8/10');
    expect(text).not.toContain('Nome:');
  });

  it('data ou distancia mudou: motivos de risco entram NA MESMA mensagem (dia fora da rotina)', async () => {
    const t = build({ raceDate: new Date('2026-11-18T12:00:00.000Z') }); // quarta, fora da rotina (dom/sab)
    await t.service.update('u1', 'r1', { raceDate: '2026-11-18T12:00:00.000Z' } as never);
    expect(t.telegram.notifyCoach).toHaveBeenCalledTimes(1);
    expect(t.telegram.notifyCoach.mock.calls[0][0]).toContain('nao esta na rotina');
  });

  it('reenvio SEM mudanca nao avisa nem grava nada', async () => {
    const t = build();
    await t.service.update('u1', 'r1', { name: 'Meia de BH' } as never);
    expect(t.telegram.notifyCoach).not.toHaveBeenCalled();
    expect(t.studentProfile.recordEvent).not.toHaveBeenCalled();
    expect(describeRaceChanges(existing, { ...existing })).toEqual([]);
  });

  it('falha do Telegram ou do Prontuario nunca desfaz a edicao', async () => {
    for (const opts of [{ telegramFails: true }, { profileFails: true }, { telegramFails: true, profileFails: true }]) {
      const t = build({ status: 'arquivada' }, opts);
      await expect(t.service.update('u1', 'r1', { status: 'arquivada' } as never)).resolves.toMatchObject({ status: 'arquivada' });
      expect(t.telegram.notifyCoach).toHaveBeenCalledTimes(1);
      expect(t.studentProfile.recordEvent).toHaveBeenCalledTimes(1);
    }
  });

  it('meta de OUTRA aluna: 404, sem alterar e sem avisar', async () => {
    const t = build({ status: 'concluida' }, { owner: 'outra-aluna' });
    await expect(t.service.update('u1', 'r1', { status: 'concluida' } as never)).rejects.toBeInstanceOf(NotFoundException);
    expect(t.prisma.targetRace.update).not.toHaveBeenCalled();
    expect(t.telegram.notifyCoach).not.toHaveBeenCalled();
  });

  it('o app envia null para LIMPAR campos na edicao (servidor grava null) sem quebrar a validacao', async () => {
    const t = build({ targetSeconds: null, notes: null });
    await t.service.update('u1', 'r1', { targetSeconds: null, notes: null } as never);
    expect(t.prisma.targetRace.update.mock.calls[0][0].data).toMatchObject({ targetSeconds: null, notes: null });
  });
});

describe('exclusao de meta', () => {
  it('apaga e avisa o treinador + Prontuario (a linha do Prontuario permanece apos a exclusao da meta)', async () => {
    const t = build();
    await expect(t.service.remove('u1', 'r1')).resolves.toEqual({ removed: true });
    expect(t.prisma.targetRace.delete).toHaveBeenCalledTimes(1);
    const text = t.telegram.notifyCoach.mock.calls[0][0];
    expect(text).toContain('Meta de prova removida pela aluna');
    expect(text).toContain('Meia de BH — 21 km em 15/11/2026');
    expect(text).toContain('status antes: em andamento');
    expect(t.studentProfile.recordEvent).toHaveBeenCalledWith('u1', ProfileEventCode.TARGET_RACE_REMOVED, expect.stringContaining('Meta de prova removida pela aluna'));
  });

  it('falhas de aviso nao desfazem a exclusao; meta de outra aluna: 404 e nada e apagado', async () => {
    const t = build(null, { telegramFails: true, profileFails: true });
    await expect(t.service.remove('u1', 'r1')).resolves.toEqual({ removed: true });
    const other = build(null, { owner: 'outra-aluna' });
    await expect(other.service.remove('u1', 'r1')).rejects.toBeInstanceOf(NotFoundException);
    expect(other.prisma.targetRace.delete).not.toHaveBeenCalled();
    expect(other.telegram.notifyCoach).not.toHaveBeenCalled();
  });
});

describe('app: editar, reabrir e remover com confirmacao', () => {
  const app = readFileSync(join(__dirname, '..', '..', 'mobile', 'App.tsx'), 'utf8');
  it('botoes Editar/Reabrir e remocao com confirmacao (window.confirm na web, Alert no celular)', () => {
    expect(app).toContain('onPress={() => startEdit(race)}');
    expect(app).toContain("updateStatus(race.id, 'em_andamento')");
    expect(app).toContain('onPress={() => askRemove(race)}');
    expect(app).not.toContain('onPress={() => removeRace(race.id)}'); // nunca mais apaga com um toque
    expect(app).toContain('window.confirm(text)');
    expect(app).toContain("Alert.alert('Remover meta'");
  });
  it('edicao usa PATCH no mesmo formulario, limpa campos com null e mostra "Salvar alteracoes" / "Cancelar edicao"', () => {
    expect(app).toContain("method: editingId ? 'PATCH' : 'POST'");
    expect(app).toContain('const clear = editingId ? null : undefined;');
    expect(app).toContain("'Salvar alteracoes'");
    expect(app).toContain('Cancelar edição');
    expect(app).toContain('onPress={saveRace}');
  });
  it('a aluna nao recebe mensagem de aviso: nenhum envio de notificacao a aluna no servico de metas', () => {
    const service = readFileSync(join(__dirname, '..', 'src', 'target-races', 'target-races.service.ts'), 'utf8');
    expect(service).not.toMatch(/notifyUser|sendEmail|sendPush|notifications\./);
  });
});
