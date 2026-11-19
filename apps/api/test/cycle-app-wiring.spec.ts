import { readFileSync } from 'fs';
import { join } from 'path';
import { CYCLE_NOTES_MAX_CHARS, CYCLE_SYMPTOMS } from '../src/menstrual-cycle/cycle-symptoms';
import { CYCLE_NOTES_MAX_CHARS as APP_NOTES_MAX, CYCLE_SYMPTOM_OPTIONS } from '../../mobile/src/cycleReport/cycleSymptoms';

// 19/11/2026: o aplicativo e o servidor precisam falar a mesma lista de sintomas; a tela do Ciclo traz o registro rico e o relatorio por fase.
describe('Ciclo: aplicativo x servidor', () => {
  it('a lista de sintomas do aplicativo e igual a do servidor', () => {
    expect(CYCLE_SYMPTOM_OPTIONS.map((item) => [item.id, item.label])).toEqual(CYCLE_SYMPTOMS.map((item) => [item.id, item.label]));
    expect(APP_NOTES_MAX).toBe(CYCLE_NOTES_MAX_CHARS);
  });

  it('o registro do dia envia sintomas e relato livre; a tela traz o relatorio mensal', () => {
    const app = readFileSync(join(__dirname, '..', '..', 'mobile', 'App.tsx'), 'utf8');
    expect(app).toContain('symptoms, notes: notes.trim() || undefined');
    expect(app).toContain('<CycleReportSection accessToken={accessToken} apiUrl={API_URL} />');
    const section = readFileSync(join(__dirname, '..', '..', 'mobile', 'src', 'cycleReport', 'CycleReportSection.tsx'), 'utf8');
    expect(section).toContain('/menstrual-cycle/reports/request');
    expect(section).toContain('Pedir relatório mensal');
    expect(section).not.toMatch(/\bapp\b/i);
  });
});
