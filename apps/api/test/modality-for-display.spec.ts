import { modalityForDisplay } from '../src/training-intelligence/observation-reader.service';

// 26/11/2026 — caso Elton: na Evolucao (FC media de cada atividade) apareciam botoes "OTHER" e "RUNNING" ao lado de "Corrida" e "Forca".
// Causa: ActivityLog legado guarda o enum bruto do provedor em `sport` e a observacao usava esse valor como modalidade.
describe('modalityForDisplay: sempre o vocabulario canonico', () => {
  it('enum bruto do provedor vira a modalidade canonica (RUNNING = corrida, junto com o que ja era corrida)', () => {
    expect(modalityForDisplay('RUNNING')).toBe('corrida');
    expect(modalityForDisplay('running')).toBe('corrida');
    expect(modalityForDisplay('corrida')).toBe('corrida');
    expect(modalityForDisplay('TREADMILL_RUNNING')).toBe('corrida');
  });
  it('valores canonicos continuam iguais', () => {
    expect(modalityForDisplay('forca')).toBe('forca');
    expect(modalityForDisplay('fortalecimento_corredores')).toBe('fortalecimento_corredores');
  });
  it('OTHER e valores nao reconhecidos viram "outra" (nunca texto bruto em ingles)', () => {
    expect(modalityForDisplay('OTHER')).toBe('outra');
    expect(modalityForDisplay('QUALQUER_COISA_NOVA')).toBe('outra');
  });
  it('sem modalidade informada segue sem modalidade (nao inventa)', () => {
    expect(modalityForDisplay(null)).toBeUndefined();
    expect(modalityForDisplay('')).toBeUndefined();
    expect(modalityForDisplay('   ')).toBeUndefined();
  });
});
