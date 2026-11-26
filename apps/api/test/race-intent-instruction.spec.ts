import { RACE_CALENDAR_INSTRUCTION } from '../src/training-plans/prescription-agent.service';

// 26/11/2026 — prova alvo nao e' motivo, por si so, para reduzir a carga (casos do Elton e da Juliana: sabado cortado antes de 5 km social).
// A IA avalia o tipo de prova (questionario + gap + se e' passo de preparacao maior) e separa reducao por saude de reducao por prova.
describe('instrucao de prova alvo: tipo de prova decide se ha polimento', () => {
  const t = RACE_CALENDAR_INSTRUCTION;
  it('prova alvo nao e motivo, por si so, para reduzir; avalia questionario e gap', () => {
    expect(t).toContain('PROVA ALVO NAO E, POR SI SO, MOTIVO PARA REDUZIR A CARGA');
    expect(t).toContain('oQuantoQuerMelhorarPerformance');
    expect(t).toContain('gap');
    expect(t).toContain('Sem resposta no questionario, nao presuma importancia alta nem baixa');
  });
  it('tres posturas: acomodar (participativa), preparar (desempenho), parte de plano maior', () => {
    expect(t).toContain('ACOMODE a prova na semana');
    expect(t).toContain('nunca cortado ao minimo');
    expect(t).toContain('PREPARACAO especifica');
    expect(t).toContain('preparacao maior');
  });
  it('reducao por saude e por prova sao declaradas separadas; diretriz continua vencendo', () => {
    expect(t).toContain('Ajuste por saude');
    expect(t).toContain('Ajuste por prova');
    expect(t).toContain('a diretriz especifica do treinador continua vencendo');
  });
  it('mantem as regras anteriores: dia da prova sem limite de tempo e alerta de dia de prova', () => {
    expect(t).toContain('O DIA DA PROVA NAO TEM LIMITE DE TEMPO');
    expect(t).toContain('alerta de dia de prova sugerindo nao fazer esse treino e descansar');
    expect(t).not.toContain("'");
  });
});
