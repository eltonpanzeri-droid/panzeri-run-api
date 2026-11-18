import { readFileSync } from 'fs';
import { join } from 'path';
import { paceTextForView, paceViewLabel, paceViewOptionLabel } from '../../mobile/src/paceView/paceText';

// 18/11/2026 (aluna Thais, via Elton): o aluno escolhe ver ritmo (min/km) ou velocidade (km/h) na prescricao. So' muda o texto mostrado.
describe('ritmo ou velocidade na prescricao', () => {
  it('ritmo: o texto fica exatamente como esta', () => {
    expect(paceTextForView('5:40/km a 6:00/km', 'pace')).toBe('5:40/km a 6:00/km');
    expect(paceTextForView('5:45/km', 'pace')).toBe('5:45/km');
  });
  it('velocidade: faixa vira km/h do mais lento ao mais rapido', () => {
    expect(paceTextForView('5:40/km a 6:00/km', 'speed')).toBe('10,0 a 10,6 km/h');
    expect(paceTextForView('3:55/km a 4:35/km', 'speed')).toBe('13,1 a 15,3 km/h');
  });
  it('velocidade: valor unico e faixa que arredonda igual viram um numero so', () => {
    expect(paceTextForView('6:00/km', 'speed')).toBe('10,0 km/h');
    expect(paceTextForView('6:00/km a 6:00/km', 'speed')).toBe('10,0 km/h');
  });
  it('texto vazio ou sem ritmo reconhecivel nao quebra', () => {
    expect(paceTextForView(undefined, 'speed')).toBeUndefined();
    expect(paceTextForView(null, 'speed')).toBeUndefined();
    expect(paceTextForView('ritmo leve', 'speed')).toBe('ritmo leve');
  });
  it('rotulo acompanha a escolha', () => {
    expect(paceViewLabel('pace')).toBe('Pace');
    expect(paceViewLabel('speed')).toBe('Velocidade');
    expect(paceViewOptionLabel('pace')).toBe('Ritmo (min/km)');
    expect(paceViewOptionLabel('speed')).toBe('Velocidade (km/h)');
  });
  it('a tela usa a escolha nos tres lugares do ritmo e o aluno escolhe em dois botoes', () => {
    const app = readFileSync(join(__dirname, '..', '..', 'mobile', 'App.tsx'), 'utf8');
    expect(app).toContain('paceTextForView(stepPaceText(step), paceView)');
    expect(app).toContain('paceTextForView(collapseEqualRange(paceRaw), paceView)');
    expect(app).toContain('{paceViewLabel(paceView)}</Text>{');
    expect(app).toContain('paceViewOptionLabel(option)');
  });
});
