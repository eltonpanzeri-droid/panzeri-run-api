import { CommunityAnalysisReminderService, COMMUNITY_REMINDER_TEXT, CYCLE_COMMUNITY_ANALYSIS_MILESTONE } from '../src/notifications/community-analysis-reminder.service';
import { MarketplaceReminderService, MARKETPLACE_REMINDER_MILESTONE, MARKETPLACE_REMINDER_TEXT } from '../src/notifications/marketplace-reminder.service';

// 19/11/2026 (Elton): lembretes semanais no Telegram, ate ele pedir para encerrar (marco gravado).
function fakes(done: boolean) {
  const findUnique = jest.fn().mockResolvedValue(done ? { key: 'x' } : null);
  const notifyCoach = jest.fn().mockResolvedValue(undefined);
  return { prisma: { coachMilestone: { findUnique } }, telegram: { notifyCoach }, findUnique, notifyCoach };
}

describe('lembretes semanais para o treinador', () => {
  it('Marketplace: envia uma mensagem com as regras ditas por Elton; some quando o marco existe', async () => {
    const on = fakes(false);
    expect(await new MarketplaceReminderService(on.prisma as never, on.telegram as never).run()).toEqual({ sent: true });
    expect(on.findUnique).toHaveBeenCalledWith({ where: { key: MARKETPLACE_REMINDER_MILESTONE } });
    expect(on.notifyCoach).toHaveBeenCalledWith(MARKETPLACE_REMINDER_TEXT);
    expect(MARKETPLACE_REMINDER_TEXT).toContain('5%');
    expect(MARKETPLACE_REMINDER_TEXT).toContain('comissão');
    expect(MARKETPLACE_REMINDER_TEXT).not.toMatch(/\bapp\b/i);
    const off = fakes(true);
    expect(await new MarketplaceReminderService(off.prisma as never, off.telegram as never).run()).toEqual({ sent: false });
    expect(off.notifyCoach).not.toHaveBeenCalled();
  });

  it('Ciclo da comunidade: mesmo comportamento, marco proprio', async () => {
    const on = fakes(false);
    expect(await new CommunityAnalysisReminderService(on.prisma as never, on.telegram as never).run()).toEqual({ sent: true });
    expect(on.findUnique).toHaveBeenCalledWith({ where: { key: CYCLE_COMMUNITY_ANALYSIS_MILESTONE } });
    expect(on.notifyCoach).toHaveBeenCalledWith(COMMUNITY_REMINDER_TEXT);
    const off = fakes(true);
    expect(await new CommunityAnalysisReminderService(off.prisma as never, off.telegram as never).run()).toEqual({ sent: false });
  });

  it('falha do Telegram nao derruba o cron semanal', async () => {
    const broken = fakes(false);
    broken.notifyCoach.mockRejectedValue(new Error('telegram fora'));
    await expect(new MarketplaceReminderService(broken.prisma as never, broken.telegram as never).weekly()).resolves.toBeUndefined();
  });
});
