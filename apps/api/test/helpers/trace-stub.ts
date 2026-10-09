// Servico de rastreabilidade simulado para os testes unitarios de TrainingPlansService: a rastreabilidade e' OBRIGATORIA (sem ela nenhuma chamada
// de IA de prescricao e' feita), entao todo teste que constroi o servico precisa fornece-la. A gravacao real e' testada em test/integration.
export function traceStub(): never {
  return {
    persistWeekly: jest.fn().mockResolvedValue({ packageId: 'pacote-simulado' }),
    persistDayRegeneration: jest.fn().mockResolvedValue({ packageId: 'pacote-simulado' }),
    collectProvenance: jest.fn().mockResolvedValue({ activity: [], extra: [], prescribedCopy: [] }),
    collectExecutionProvenance: jest.fn().mockResolvedValue({ weeks: [], longestRun: [], nearRecord: [], evolutionReport: [], reassessmentEvolution: [] }),
  } as never;
}
