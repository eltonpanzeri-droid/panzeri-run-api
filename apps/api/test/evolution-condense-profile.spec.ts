import { EvolutionAgentService } from '../src/reassessment/evolution-agent.service';

// 02/11/2026 — condensacao do prontuario: teto de saida maior (4000) e registro do motivo da parada quando o parse falha, sem conteudo do prontuario no log.
describe('EvolutionAgentService.condenseProfile', () => {
  const input = { currentSummary: 'resumo atual', newEvents: [{ code: 'WORKOUT_COMPLETED', content: 'CONTEUDO-SENSIVEL-DO-ALUNO', createdAt: '2026-11-02T10:00:00.000Z' }] };

  function build(streamFactory: (params: any) => any) {
    const warn = jest.fn();
    const log = jest.fn();
    const stream = jest.fn(streamFactory);
    const service = new EvolutionAgentService({ get: () => undefined } as never, { run: async (fn: () => unknown) => fn() } as never);
    (service as any).client = { messages: { stream } };
    (service as any).logger = { warn, log };
    return { service, stream, warn, log };
  }

  function fakeStream(options: { snapshot?: any; result?: any; error?: Error }) {
    let handler: ((event: unknown, snapshot: unknown) => void) | undefined;
    return {
      on: (_name: string, fn: (event: unknown, snapshot: unknown) => void) => { handler = fn; },
      finalMessage: async () => {
        if (options.snapshot) handler?.({}, options.snapshot);
        if (options.error) throw options.error;
        return options.result;
      },
    };
  }

  it('usa teto de saida de 4000 tokens (o resumo pode ter ate 6000 caracteres) e devolve o resumo', async () => {
    const { service, stream } = build(() => fakeStream({ result: { parsed_output: { summary: 'novo resumo' }, usage: { input_tokens: 10, output_tokens: 5 } } }));
    expect(await service.condenseProfile(input)).toBe('novo resumo');
    const params = stream.mock.calls[0][0];
    expect(params.max_tokens).toBe(4000);
    expect(params.thinking).toEqual({ type: 'disabled' });
  });

  it('falha de parse: devolve null e registra stop_reason, tokens e tamanho, sem o texto do prontuario', async () => {
    const snapshot = { stop_reason: 'max_tokens', usage: { output_tokens: 2400 }, content: [{ type: 'text', text: 'x'.repeat(5349) + ' CONTEUDO-SENSIVEL-DO-ALUNO' }] };
    const { service, warn } = build(() => fakeStream({ snapshot, error: new Error('Unterminated string in JSON') }));
    expect(await service.condenseProfile(input)).toBeNull();
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('Unterminated string in JSON');
    expect(message).toContain('stop_reason=max_tokens');
    expect(message).toContain('output_tokens=2400');
    expect(message).toContain('texto_bruto_chars=5376');
    expect(message).not.toContain('CONTEUDO-SENSIVEL-DO-ALUNO');
  });

  it('falha sem nenhum evento recebido: devolve null e registra so a mensagem do erro', async () => {
    const { service, warn } = build(() => fakeStream({ error: new Error('rede caiu') }));
    expect(await service.condenseProfile(input)).toBeNull();
    expect(String(warn.mock.calls[0][0])).toBe('Falha ao condensar prontuario: rede caiu');
  });

  // 03/11/2026 (pedido de Elton): feedback antigo pesa cada vez menos SEMPRE; meta de tamanho no pedido; segunda passada so de reducao antes de qualquer corte.
  describe('tamanho do resumo (meta, reducao e peso por recencia)', () => {
    const ok = (summary: string) => ({ result: { parsed_output: { summary }, usage: { input_tokens: 10, output_tokens: 5 } } });
    const userPromptOf = (call: any) => JSON.parse(call[0].messages[0].content);

    it('o pedido traz os limites (meta 4500, maximo 6000, tamanho atual) e o prompt manda dar menos peso ao antigo SEMPRE, preservando as excecoes', async () => {
      const { service, stream } = build(() => fakeStream(ok('novo resumo')));
      await service.condenseProfile(input);
      const params = stream.mock.calls[0][0];
      expect(userPromptOf(stream.mock.calls[0]).limites).toEqual({ metaDeCaracteres: 4500, maximoAbsolutoDeCaracteres: 6000, tamanhoDoResumoAtual: 'resumo atual'.length });
      const system = params.system[0].text as string;
      expect(system).toMatch(/PESO POR RECENCIA, SEMPRE/);
      expect(system).toMatch(/nunca apagar o fato/);
      expect(system).toMatch(/NAO encolha, enquanto houver outra opcao: fatos persistentes, diretrizes do treinador/);
      expect(system).toMatch(/TAMANHO:.*meta/s);
    });

    it('resumo ate a margem: UMA chamada so', async () => {
      const { service, stream } = build(() => fakeStream(ok('x'.repeat(5200))));
      expect((await service.condenseProfile(input))!.length).toBe(5200);
      expect(stream).toHaveBeenCalledTimes(1);
    });

    it('resumo acima da margem: segunda passada so de reducao (sem evento novo) e devolve o menor', async () => {
      const summaries = ['x'.repeat(5800), 'y'.repeat(4400)];
      const { service, stream } = build(() => fakeStream(ok(summaries.shift() as string)));
      const result = await service.condenseProfile(input);
      expect(result).toBe('y'.repeat(4400));
      expect(stream).toHaveBeenCalledTimes(2);
      const second = userPromptOf(stream.mock.calls[1]);
      expect(second.resumoAtual).toBe('x'.repeat(5800));
      expect(second.eventosNovos).toEqual([]);
      expect(second.instrucaoDeReducao).toMatch(/sem apagar nenhum fato importante/);
    });

    it('reducao que falha ou nao encolhe: fica o primeiro resumo (nunca perde o que ja foi condensado)', async () => {
      const failing = build((() => { let n = 0; return () => (n++ === 0 ? fakeStream(ok('x'.repeat(5800))) : fakeStream({ error: new Error('rede caiu') })); })());
      expect((await failing.service.condenseProfile(input))!.length).toBe(5800);
      const bigger = build((() => { let n = 0; return () => fakeStream(ok(n++ === 0 ? 'x'.repeat(5400) : 'y'.repeat(5900))); })());
      expect((await bigger.service.condenseProfile(input))!.length).toBe(5400);
    });
  });

  it('sem chave de IA configurada: nao chama a API e devolve null', async () => {
    const service = new EvolutionAgentService({ get: () => undefined } as never, { run: async (fn: () => unknown) => fn() } as never);
    expect(await service.condenseProfile(input)).toBeNull();
  });
});
