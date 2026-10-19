import { readFileSync } from 'fs';
import { join } from 'path';
import { PrescriptionAgentService, AiFailureInfo } from '../src/training-plans/prescription-agent.service';

// 19/10/2026: o aviso de falha da IA (Telegram) passa a trazer o MOTIVO tecnico — o log do EasyPanel nao e' confiavel para investigar (mostra janela antiga).
// Caso real: a geracao da semana da Eduarda falhou e o aviso so' dizia "verifique a chave da IA". Nunca expoe chave, prompt ou texto de aluno.
describe('motivo da falha da geracao semanal', () => {
  const evidence = { testPace: null, selfReportedPace: null };

  it('sem chave da IA: devolve null e o motivo cita ANTHROPIC_API_KEY (sem valor nenhum)', async () => {
    const agent = new PrescriptionAgentService({ get: () => undefined } as never, {} as never);
    const failure: AiFailureInfo = {};
    expect(await agent.proposeWeeklyDecision({ availability: [] } as never, evidence as never, undefined, failure)).toBeNull();
    expect(failure.reason).toContain('ANTHROPIC_API_KEY');
  });

  it('rotina sem nenhum dia de corrida: devolve null com motivo explicito (nao chama a IA)', async () => {
    const agent = new PrescriptionAgentService({ get: () => 'chave-falsa-de-teste' } as never, {} as never);
    const failure: AiFailureInfo = {};
    expect(await agent.proposeWeeklyDecision({ availability: [] } as never, evidence as never, undefined, failure)).toBeNull();
    expect(failure.reason).toContain('nenhum dia de corrida');
  });

  it('o 4o parametro e opcional: chamadas antigas (3 argumentos) continuam funcionando', async () => {
    const agent = new PrescriptionAgentService({ get: () => undefined } as never, {} as never);
    await expect(agent.proposeWeeklyDecision({ availability: [] } as never, evidence as never)).resolves.toBeNull();
  });

  it('generateWeek coloca o motivo no aviso do Telegram e no log de erro, e nao manda mais a chave como unica pista', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'training-plans', 'training-plans.service.ts'), 'utf8');
    expect(source).toContain('const aiFailure: AiFailureInfo = {};');
    expect(source).toContain('proposeWeeklyDecision(methodologyInput, paceEvidence, agentTrace, aiFailure)');
    expect(source).toContain('Motivo: ${failureReason}');
    expect(source).not.toContain('verifique a chave da IA (ANTHROPIC_API_KEY) e os logs do EasyPanel');
  });
});
