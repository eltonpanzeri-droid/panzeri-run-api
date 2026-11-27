import { PAIN_INTENSITY_FROM_FLAG, effectivePainIntensity, normalizePain, painFlagFromIntensity } from '../src/workout-completions/pain-scale';
import { painLine } from '../src/workout-completions/feedback-telegram-lines';
import { painIntensityText } from '../src/workout-completions/workout-completions.service';

// 28/11/2026 — escala unica de dor do feedback: Nao = 0; Sim = 1 (muito leve) a 10 (extremamente forte). Dado antigo convertido por leitura: leve 3, moderado 5, forte 8.
describe('escala unica de dor do feedback', () => {
  it('conversao do dado antigo (decisao de Elton): leve 3, moderado 5, forte 8, sem dor 0', () => {
    expect(PAIN_INTENSITY_FROM_FLAG).toEqual({ none: 0, leve: 3, moderado: 5, forte: 8 });
    expect(effectivePainIntensity({ painFlag: 'leve' })).toEqual({ value: 3, native: false });
    expect(effectivePainIntensity({ painFlag: 'moderado' })).toEqual({ value: 5, native: false });
    expect(effectivePainIntensity({ painFlag: 'forte' })).toEqual({ value: 8, native: false });
    expect(effectivePainIntensity({ painFlag: 'none' })).toEqual({ value: 0, native: false });
  });
  it('a nota nova prevalece e e nativa; sem resposta nunca vira zero', () => {
    expect(effectivePainIntensity({ painFlag: 'forte', painIntensity: 6 })).toEqual({ value: 6, native: true });
    expect(effectivePainIntensity({})).toEqual({ value: null, native: false });
    expect(effectivePainIntensity({ painFlag: null, painIntensity: null })).toEqual({ value: null, native: false });
  });
  it('faixas em palavras: 1-3 leve, 4-6 moderado, 7-10 forte (e as notas 3/5/8 caem uma em cada)', () => {
    expect([1, 3, 4, 6, 7, 10].map(painFlagFromIntensity)).toEqual(['leve', 'leve', 'moderado', 'moderado', 'forte', 'forte']);
    expect([3, 5, 8].map(painFlagFromIntensity)).toEqual(['leve', 'moderado', 'forte']);
  });
  it('normalizePain: cliente novo (nota), cliente antigo (so painFlag), "nao" e conflitos', () => {
    expect(normalizePain({ painIntensity: 7 })).toEqual({ painFlag: 'forte', painIntensity: 7 });
    expect(normalizePain({ painFlag: 'leve' })).toEqual({ painFlag: 'leve', painIntensity: null });
    expect(normalizePain({ painFlag: 'none' })).toEqual({ painFlag: 'none', painIntensity: null });
    expect(normalizePain({})).toEqual({ painFlag: null, painIntensity: null });
    expect(normalizePain({ painFlag: 'none', painIntensity: 4 }).error).toMatch(/inconsistente/);
    expect(normalizePain({ painIntensity: 11 }).error).toMatch(/1 a 10/);
    expect(normalizePain({ painIntensity: 0 }).error).toMatch(/1 a 10/);
    expect(normalizePain({ painIntensity: 4.5 }).error).toMatch(/1 a 10/);
  });
  it('textos para o treinador e a IA mostram a nota; sem nota, o rotulo antigo', () => {
    expect(painLine({ painFlag: 'moderado', painIntensity: 5 })).toBe('🩹 Dor durante o treino: nota 5/10');
    expect(painLine({ painFlag: 'moderado' })).toBe('🩹 Dor durante o treino: Moderado');
    expect(painIntensityText('forte', 9)).toMatch(/nota 9 de 10/);
    expect(painIntensityText('forte', null)).toBe('Forte');
  });
});
