import { PrescriptionAgentService } from '../src/training-plans/prescription-agent.service';
import { PANZERI_DEVELOPMENTAL_DIRECTIVE } from '../src/training-plans/panzeri-developmental-directive';
import { PANZERI_METHODOLOGY_KNOWLEDGE } from '../src/training-plans/panzeri-methodology-knowledge';

// 25/10/2026 — diretriz desenvolvimentista do treinador no prompt SEMANAL. O que e' contrato aqui: ela entra DEPOIS da metodologia, no bloco estavel (cacheavel), os numeros sao
// referencia (nunca regra rigida) e o unico conflito encontrado (regua de dor) ficou subordinado. Nao testa o conteudo da resposta da IA (isso e' julgamento, nao codigo).
const joined = (PrescriptionAgentService.prototype as unknown as { buildSystemPromptStable: () => string }).buildSystemPromptStable.call({});

describe('diretriz desenvolvimentista no prompt semanal', () => {
  it('entra logo depois da metodologia, uma unica vez, no bloco estavel', () => {
    const idxMethodology = joined.indexOf(PANZERI_METHODOLOGY_KNOWLEDGE);
    const idxDirective = joined.indexOf(PANZERI_DEVELOPMENTAL_DIRECTIVE);
    expect(idxMethodology).toBeGreaterThanOrEqual(0);
    expect(idxDirective).toBe(idxMethodology + PANZERI_METHODOLOGY_KNOWLEDGE.length + 2); // separados so pelo separador do prompt
    expect(joined.split('# Diretriz desenvolvimentista').length).toBe(2);
  });
  it('carrega os pontos centrais: desenvolver sem aumentar sempre, 10% nao e limite absoluto, faixas por objetivo e direcoes de decisao', () => {
    for (const trecho of [
      'NAO trate 10% de aumento semanal como limite absoluto',
      'entre 30 e 36 km', 'longos de 16 a 18 km', 'longos de 18 a 25 km', 'longos progressivos de 7 a 9 km', 'longos de 12 a 14 km',
      'PROGREDIR', 'CONSOLIDAR', 'RECALCULAR', 'RECUPERAR', 'REORGANIZAR',
      'Dor leve e ocasional', 'Sinais de alerta', 'Diretrizes individuais do treinador para um aluno especifico continuam SOBERANAS',
      'sem transformar recomendacoes numericas em regras rigidas',
    ]) expect(PANZERI_DEVELOPMENTAL_DIRECTIVE).toContain(trecho);
  });
  it('o conflito da regua de dor ficou subordinado e o restante da metodologia permanece', () => {
    expect(PANZERI_METHODOLOGY_KNOWLEDGE).toContain('SUBORDINADO a secao 5 da');
    for (const permanece of ['## Distribuicao de intensidade', '## Fases da preparacao para uma prova', '## Consolidar o degrau atual', '## Treino longo / longao']) {
      expect(joined).toContain(permanece);
    }
  });
  it('a decisao vai para rationale (campo interno) e nao para notes do aluno', () => {
    expect(PANZERI_DEVELOPMENTAL_DIRECTIVE).toContain('Registre em rationale');
    expect(PANZERI_DEVELOPMENTAL_DIRECTIVE).toContain('notes continua sendo apenas objetivo/foco da sessao');
  });
});
