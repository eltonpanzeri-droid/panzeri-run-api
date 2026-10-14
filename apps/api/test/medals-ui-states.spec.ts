import { readFileSync } from 'fs';
import { join } from 'path';

// Interface do aluno (15/10/2026): conquistas atualmente conquistadas, reativadas, revogadas (com motivo) e em atualizacao, historico sob demanda e relatorio de treino
// em atualizacao. Verificacao ESTATICA do codigo do app (mesmo padrao dos outros testes de tela) — a renderizacao real exige build/dispositivo e nao foi executada aqui.

const mobile = (...parts: string[]) => readFileSync(join(__dirname, '..', '..', 'mobile', ...parts), 'utf8');
const screen = mobile('home', 'MedalsScreen.tsx');
const app = mobile('App.tsx');

describe('MedalsScreen: estados das conquistas', () => {
  it('distingue conquistadas, reativadas, revogadas e em atualizacao', () => {
    expect(screen).toContain('label="Reativada"');
    expect(screen).toContain('label="Revogada"');
    expect(screen).toContain('label="Em atualização"');
    expect(screen).toContain('item.medal.reactivatedAt');
    expect(screen).toContain('item.medal.provisional');
    expect(screen).toContain("'Revogadas'");
    expect(screen).toContain('{medal.reasonText}'); // o motivo de cada revogacao aparece para o aluno
  });

  it('mostra o aviso de atualizacao e consulta de novo enquanto a reavaliacao esta pendente (com limite)', () => {
    expect(screen).toContain('data?.pending?.updating');
    expect(screen).toMatch(/MAX_POLLS = \d+/);
    expect(screen).toContain('Estamos atualizando suas conquistas');
  });

  it('historico das transicoes sob demanda, pelo endpoint dedicado', () => {
    expect(screen).toContain('/me/medals/history');
    expect(screen).toContain('Ver histórico das conquistas');
    expect(screen).toContain('entry.reasonText');
  });

  it('o filtro "Revogadas" so aparece quando existe alguma; a experiencia atual (Todas/Conquistadas/Em progresso) permanece', () => {
    expect(screen).toContain("revoked.length > 0 ? ['all', 'unlocked', 'progress', 'revoked'] : ['all', 'unlocked', 'progress']");
    expect(screen).toContain('Em progresso');
    expect(screen).toContain('Como as conquistas funcionam');
  });

  it('nao introduz notificacoes push nem logica de elegibilidade no app', () => {
    for (const text of [screen, mobile('home', 'homeLogic.ts')]) {
      expect(text).not.toMatch(/expo-notifications|scheduleNotificationAsync|sendPush|Notifications\./);
    }
    expect(screen).not.toMatch(/threshold\s*[<>]=?\s*currentValue|Math\.(floor|ceil)\(.*threshold/);
  });
});

describe('App: relatorio de treino em atualizacao', () => {
  it('o cartao do relatorio marca "Em atualizacao" e o plano traz os treinos pendentes', () => {
    expect(app).toContain('sessionReportsUpdating?: string[]');
    expect(app).toContain('Em atualização — uma correção recente ainda está sendo processada.');
    expect(app).toContain('updating={Boolean(plan?.sessionReportsUpdating?.includes(session.id))}');
  });
});
