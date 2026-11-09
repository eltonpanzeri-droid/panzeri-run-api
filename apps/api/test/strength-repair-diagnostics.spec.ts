import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrescriptionAgentService } from '../src/training-plans/prescription-agent.service';

// 09/11/2026 (caso Andreia): "faltaram dias de forca/fortalecimento ... e o reparo avulso tambem falhou" aparecia SEM a causa. Agora a chamada avulsa de forca diz por que devolveu null.
// So' diagnostico: nenhum resultado muda. Cliente da IA e fila simulados.
const slot = { weekday: 1, modality: 'fortalecimento_corredores' } as never;
const usage = { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const validSession = (over: Record<string, unknown> = {}) => ({ weekday: 1, modality: 'fortalecimento_corredores', title: 't', exerciseIds: ['a', 'b', 'c'], sets: 3, reps: '10', restSeconds: 45, intensity: 'Leve', notes: '', reasoning: null, ...over });

function build(parse: jest.Mock) {
  const service = new PrescriptionAgentService({ get: jest.fn().mockReturnValue('') } as never, { run: (fn: () => Promise<unknown>) => fn() } as never);
  (service as any).client = { messages: { parse } };
  const input = { goal: 'Correr 10km', experience: 'intermediario', answers: {} } as never;
  return { service: service as any, input };
}

describe('chamada avulsa de forca: motivo da falha', () => {
  it('resposta vazia/cortada: diz o stop_reason e os tokens', async () => {
    const { service, input } = build(jest.fn().mockResolvedValue({ parsed_output: null, stop_reason: 'max_tokens', usage: { ...usage, output_tokens: 3400 } }));
    const diag: { reason?: string } = {};
    expect(await service.attemptStrengthSessionDecision(input, slot, undefined, 'reparo_forca', diag)).toBeNull();
    expect(diag.reason).toContain('stop_reason=max_tokens');
    expect(diag.reason).toContain('output_tokens=3400');
  });
  it('a IA devolve outro dia/modalidade: diz o que veio e o que foi pedido', async () => {
    const { service, input } = build(jest.fn().mockResolvedValue({ parsed_output: validSession({ weekday: 3, modality: 'forca' }), stop_reason: 'end_turn', usage }));
    const diag: { reason?: string } = {};
    expect(await service.attemptStrengthSessionDecision(input, slot, undefined, 'reparo_forca', diag)).toBeNull();
    expect(diag.reason).toContain('devolveu o dia 3 (forca) em vez do pedido 1 (fortalecimento_corredores)');
  });
  it('erro da chamada (ex.: JSON invalido): o motivo e a mensagem do erro', async () => {
    const { service, input } = build(jest.fn().mockRejectedValue(new Error('Unterminated string in JSON')));
    const diag: { reason?: string } = {};
    expect(await service.attemptStrengthSessionDecision(input, slot, undefined, 'reparo_forca', diag)).toBeNull();
    expect(diag.reason).toContain('Unterminated string in JSON');
  });
  it('sucesso: devolve a sessao e nao grava motivo', async () => {
    const { service, input } = build(jest.fn().mockResolvedValue({ parsed_output: validSession(), stop_reason: 'end_turn', usage }));
    const diag: { reason?: string } = {};
    const result = await service.attemptStrengthSessionDecision(input, slot, undefined, 'reparo_forca', diag);
    expect(result).toMatchObject({ weekday: 1, modality: 'fortalecimento_corredores' });
    expect(diag.reason).toBeUndefined();
  });
  it('sem o parametro de diagnostico o comportamento e o mesmo de antes (compativel com o "regenerar 1 dia")', async () => {
    const { service, input } = build(jest.fn().mockResolvedValue({ parsed_output: null, stop_reason: 'end_turn', usage }));
    expect(await service.attemptStrengthSessionDecision(input, slot)).toBeNull();
  });
});

describe('reparo dos dias de forca da semana', () => {
  it('junta o motivo de cada dia que falhou', async () => {
    const parse = jest.fn()
      .mockResolvedValueOnce({ parsed_output: validSession(), stop_reason: 'end_turn', usage }) // dia 1: ok
      .mockResolvedValueOnce({ parsed_output: null, stop_reason: 'max_tokens', usage: { ...usage, output_tokens: 3400 } }); // dia 4: falha
    const { service, input } = build(parse);
    const diag: { reason?: string } = {};
    const slots = [{ weekday: 1, modality: 'fortalecimento_corredores' }, { weekday: 4, modality: 'forca' }];
    expect(await service.repairStrengthSessions(input, slots, undefined, diag)).toBeNull();
    expect(diag.reason).toContain('4:forca');
    expect(diag.reason).toContain('stop_reason=max_tokens');
    expect(diag.reason).not.toContain('1:fortalecimento_corredores');
  });
  it('tudo certo: devolve as sessoes e nenhum motivo', async () => {
    const { service, input } = build(jest.fn().mockResolvedValue({ parsed_output: validSession(), stop_reason: 'end_turn', usage }));
    const diag: { reason?: string } = {};
    const result = await service.repairStrengthSessions(input, [{ weekday: 1, modality: 'fortalecimento_corredores' }], undefined, diag);
    expect(result).toHaveLength(1);
    expect(diag.reason).toBeUndefined();
  });
  it('o aviso do Telegram passa a trazer a causa do reparo (estatico)', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'training-plans', 'prescription-agent.service.ts'), 'utf8');
    expect(source).toContain('reparo de forca falhou — causa:');
    expect(source).toContain('repairStrengthSessions(input, strengthValidation.missingSlots, trace, repairDiag)');
  });
});
