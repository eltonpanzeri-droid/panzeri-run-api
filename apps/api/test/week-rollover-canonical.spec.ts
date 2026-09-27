import {
  startOfWeek,
  addDays,
  weekdayOffsetFromMonday,
  anyAvailableDayIsFuture,
  computeShouldRollToNextWeek,
  shouldMigrateTodaySessionsToNewPlan,
  isModalityAllowedOnWeekday,
} from '../src/training-plans/training-plans.service';

// 27/09/2026 — Auditoria do caso real Roberta Kemp: sessão de domingo (27/09, já executada,
// 13.09km) foi reparentada pro plano da semana seguinte (28/09-04/10) durante o rollover de
// antecipação de domingo, contaminando prescribedSessions/completedKm/adherencePercent desse
// plano com uma execução que pertence à semana anterior. CAUSA RAIZ: a migração de "sessão de
// hoje já executada" rodava mesmo quando "hoje" não pertencia à semana sendo gerada (rollover).
// Estes testes validam a REGRA CANÔNICA extraída (computeShouldRollToNextWeek/
// shouldMigrateTodaySessionsToNewPlan), não o generateWeek() inteiro (que exige mockar IA +
// dezenas de queries) — a decisão temporal em si é pura e isolável, e é exatamente onde o bug
// vivia.

function utcDate(iso: string): Date {
  return new Date(iso + 'T12:00:00Z');
}

describe('startOfWeek — regra canônica SEGUNDA→DOMINGO (item 1 do pedido)', () => {
  it('domingo pertence à semana que TERMINA nele, não à que começa nele', () => {
    // 27/09/2026 é domingo. startOfWeek deve devolver a segunda ANTERIOR (21/09), nunca 28/09.
    const start = startOfWeek(utcDate('2026-09-27'));
    expect(start.toISOString().slice(0, 10)).toBe('2026-09-21');
  });

  it('segunda-feira é o próprio início da semana', () => {
    const start = startOfWeek(utcDate('2026-09-28'));
    expect(start.toISOString().slice(0, 10)).toBe('2026-09-28');
  });

  it('qualquer dia do meio da semana volta pra segunda-feira correta', () => {
    const start = startOfWeek(utcDate('2026-09-30')); // quarta
    expect(start.toISOString().slice(0, 10)).toBe('2026-09-28');
  });

  it('virada de mês: domingo 04/10 pertence à semana de 28/09, não vira semana nova sozinho', () => {
    const start = startOfWeek(utcDate('2026-10-04'));
    expect(start.toISOString().slice(0, 10)).toBe('2026-09-28');
  });
});

describe('weekdayOffsetFromMonday + addDays — weekStart <= sessionDate <= weekEnd (item 5)', () => {
  it('domingo (weekday=0) mapeia pro FIM da semana (offset 6), nunca pro início', () => {
    const weekStart = startOfWeek(utcDate('2026-09-28'));
    const sundayDate = addDays(weekStart, weekdayOffsetFromMonday(0));
    expect(sundayDate.toISOString().slice(0, 10)).toBe('2026-10-04'); // nunca 2026-09-27
  });

  it('todos os weekdays de uma semana caem dentro de [weekStart, weekStart+6] — invariante', () => {
    const weekStart = startOfWeek(utcDate('2026-09-28'));
    const weekEnd = addDays(weekStart, 6);
    for (let weekday = 0; weekday <= 6; weekday++) {
      const date = addDays(weekStart, weekdayOffsetFromMonday(weekday));
      expect(date.getTime()).toBeGreaterThanOrEqual(weekStart.getTime());
      expect(date.getTime()).toBeLessThanOrEqual(weekEnd.getTime());
    }
  });
});

describe('computeShouldRollToNextWeek — regra canônica de liberação de domingo (itens 2, 10.1-10.4)', () => {
  it('10.1: domingo ANTES das 12h não libera a próxima semana (aluno já com plano ativo)', () => {
    expect(computeShouldRollToNextWeek({
      hasFutureDayThisWeek: false, hasReferenceDateOverride: false, hasActivePlan: true, isPastWeeklyRelease: false,
    })).toBe(false);
  });

  it('10.2: domingo DEPOIS das 12h libera a próxima semana (aluno já com plano ativo, sem dia futuro sobrando)', () => {
    expect(computeShouldRollToNextWeek({
      hasFutureDayThisWeek: false, hasReferenceDateOverride: false, hasActivePlan: true, isPastWeeklyRelease: true,
    })).toBe(true);
  });

  it('10.4: segunda-feira gera a semana corrente — nunca rola pra frente só por ser segunda (aluno com plano ativo)', () => {
    // saoPauloWeekdayAndHour numa segunda nunca produz isPastWeeklyRelease=true (isso só existe pra weekday===0)
    expect(computeShouldRollToNextWeek({
      hasFutureDayThisWeek: true, hasReferenceDateOverride: false, hasActivePlan: true, isPastWeeklyRelease: false,
    })).toBe(false);
  });

  it('10.5: geração no meio da semana com dia futuro ainda sobrando não rola pra frente (ex: aluna só treina Seg/Ter, treinador regenera na quinta)', () => {
    expect(computeShouldRollToNextWeek({
      hasFutureDayThisWeek: false, hasReferenceDateOverride: false, hasActivePlan: true, isPastWeeklyRelease: false,
    })).toBe(false); // sem dia futuro E sem ser domingo pós-liberação -> nao rola (fica na semana atual pra ajustar o resto)
  });

  it('primeira geração (sem plano ativo) rola pra frente independente do dia da semana, quando não sobra dia futuro', () => {
    expect(computeShouldRollToNextWeek({
      hasFutureDayThisWeek: false, hasReferenceDateOverride: false, hasActivePlan: false, isPastWeeklyRelease: false,
    })).toBe(true);
  });

  it('referenceDate explícito (cron de domingo 19h / "gerar semana seguinte") nunca recalcula rollover sozinho', () => {
    expect(computeShouldRollToNextWeek({
      hasFutureDayThisWeek: false, hasReferenceDateOverride: true, hasActivePlan: true, isPastWeeklyRelease: true,
    })).toBe(false);
  });

  it('sobrando dia futuro nesta semana NUNCA rola, mesmo domingo pós-liberação (não deveria acontecer na prática, mas a prioridade é clara)', () => {
    expect(computeShouldRollToNextWeek({
      hasFutureDayThisWeek: true, hasReferenceDateOverride: false, hasActivePlan: true, isPastWeeklyRelease: true,
    })).toBe(false);
  });
});

describe('shouldMigrateTodaySessionsToNewPlan — CAUSA RAIZ do bug real da Roberta (itens 3, 4, 10.3, 10.6, 10.13)', () => {
  it('10.3/10.13: durante o rollover de antecipação (domingo->semana seguinte), NUNCA migra sessão de "hoje" pro plano novo — reproduz o cenário real da Roberta (27/09 -> semana 28/09-04/10)', () => {
    expect(shouldMigrateTodaySessionsToNewPlan({ hasActivePlan: true, shouldRollToNextWeek: true })).toBe(false);
  });

  it('10.6: gerando a semana que de fato contém hoje (sem rollover), a migração de sessões de hoje/passadas continua acontecendo — sessão executada permanece protegida e visível na semana certa', () => {
    expect(shouldMigrateTodaySessionsToNewPlan({ hasActivePlan: true, shouldRollToNextWeek: false })).toBe(true);
  });

  it('sem plano ativo anterior (primeira geração), não há nada a migrar', () => {
    expect(shouldMigrateTodaySessionsToNewPlan({ hasActivePlan: false, shouldRollToNextWeek: false })).toBe(false);
  });
});

describe('anyAvailableDayIsFuture', () => {
  it('detecta corretamente quando ainda sobra dia de rotina no futuro dentro da semana', () => {
    const weekStart = startOfWeek(utcDate('2026-09-21')); // segunda 21/09
    const today = utcDate('2026-09-23'); // quarta
    const availableDays = [{ weekday: 5 }]; // sexta, ainda no futuro desta semana
    expect(anyAvailableDayIsFuture(availableDays, weekStart, today)).toBe(true);
  });

  it('domingo à tarde, sem mais nenhum dia de rotina restante nesta semana', () => {
    const weekStart = startOfWeek(utcDate('2026-09-21'));
    const today = utcDate('2026-09-27'); // domingo, último dia da semana
    const availableDays = [{ weekday: 1 }, { weekday: 3 }, { weekday: 5 }]; // seg/qua/sex, todos no passado
    expect(anyAvailableDayIsFuture(availableDays, weekStart, today)).toBe(false);
  });
});

describe('isModalityAllowedOnWeekday — restrição objetiva da rotina (item 8, item 10.12)', () => {
  it('10.12: modalidade NÃO disponível naquele dia — sistema recusa, nunca depende só do prompt da IA', () => {
    // Caso real Roberta: segunda só tem corrida+fortalecimento na rotina, nunca musculação isolada num dia sem corrida cadastrada
    const availableDays = [{ weekday: 1, modalities: ['fortalecimento_corredores'] }]; // segunda SEM corrida
    expect(isModalityAllowedOnWeekday(availableDays, 1, 'corrida')).toBe(false);
  });

  it('modalidade disponível naquele dia — permitido', () => {
    const availableDays = [{ weekday: 1, modalities: ['corrida', 'fortalecimento_corredores'] }];
    expect(isModalityAllowedOnWeekday(availableDays, 1, 'corrida')).toBe(true);
  });

  it('dia nem presente na rotina — não disponível por definição', () => {
    const availableDays = [{ weekday: 2, modalities: ['corrida'] }];
    expect(isModalityAllowedOnWeekday(availableDays, 1, 'corrida')).toBe(false);
  });
});
