import { readFileSync } from 'fs';
import { join } from 'path';

// 03/11/2026 — passo a passo do Samsung Health no cartao do Health Connect (decisao de Elton de 31/10). Guarda: os passos existem, citam os botoes que o cartao realmente tem e o aviso de que os menus variam.
const mobile = (...parts: string[]) => readFileSync(join(__dirname, '..', '..', 'mobile', ...parts), 'utf8');
const guide = mobile('src', 'healthConnect', 'samsungGuide.ts');
const card = mobile('src', 'healthConnect', 'HealthConnectCard.tsx');

describe('passo a passo do Samsung Health', () => {
  it('tem os cinco passos, com Configurações → Health Connect e o aviso de que os menus podem variar', () => {
    const steps = [...guide.matchAll(/^  '(.+)',$/gm)].map((m) => m[1]);
    expect(steps).toHaveLength(5);
    expect(guide).toContain('Configurações → Health Connect');
    expect(guide).toContain('podem mudar conforme a versão');
    expect(guide).toContain('Sem isso o Health Connect fica vazio');
  });

  it('cita só botões que o cartao realmente tem ("Permitir no Android" e "Sincronizar agora")', () => {
    expect(card).toContain('Permitir no Android');
    expect(card).toContain('Sincronizar agora');
    expect(guide).toContain('"Permitir no Android"');
    expect(guide).toContain('"Sincronizar agora"');
  });

  it('o cartao mostra o passo a passo (recolhido por padrao) e a frase solta antiga saiu', () => {
    expect(card).toContain("import { SAMSUNG_HEALTH_NOTE, SAMSUNG_HEALTH_STEPS, SAMSUNG_HEALTH_TITLE } from './samsungGuide'");
    expect(card).toContain('useState(false)');
    expect(card).toContain('SAMSUNG_HEALTH_STEPS.map');
    expect(card).not.toContain('No app Samsung Health, abra Configurações → Health Connect e ligue o compartilhamento dos dados. Sem isso o Health Connect fica vazio.</Text>');
  });

  it('texto visivel sem "plano de treino" nem "motor"', () => {
    expect(guide).not.toMatch(/plano de treino|\bmotor\b/i);
  });
});
