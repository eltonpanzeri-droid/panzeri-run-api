import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BestMark, isRecentMark, sparklinePoints } from '../../mobile/home/bestMarks';
import { LEGAL_VERSION, TERMS_SECTIONS } from '../src/legal/legal-content';

// 09/11/2026 (Elton): cartao duplicado, "Cancelamentos" abre a lista de ex-alunos, clausula de veracidade nos Termos, tela de marcas mais rica.
const admin = readFileSync(join(__dirname, '..', '..', 'admin', 'app', 'page.tsx'), 'utf8');
const mark = (over: Partial<BestMark> = {}): BestMark => ({ distanceId: '5km', seconds: 1500, paceSecondsKm: 300, extraMeters: 0, activityId: 'a', startedAt: '2026-10-05T10:00:00.000Z', localDate: '2026-10-05', runMeters: 5000, windowStartMeters: null, windowEndMeters: null, source: 'device', provider: 'polar', method: 'whole', timeBasis: 'series_clock', ...over });

describe('painel: visao geral e financeiro', () => {
  it('o cartao "Pagamento atrasado" aparece uma vez so (o do Panorama, com a comparacao do mes anterior)', () => {
    expect(admin).not.toContain('<Stat label="Pagamento atrasado"');
    expect(admin).toContain("tile('Pagamento atrasado'");
  });
  it('"Cancelamentos" e "Cancelados" abrem a lista de ex-alunos (nao o Financeiro)', () => {
    expect(admin).toContain("clique para ver quem', onOpenExStudents, canceledDelta)");
    expect(admin).toContain("onOpenExStudents={() => changeView('exStudents')}");
    expect(admin).toContain('<Detail icon={<X size={18} />} label="Cancelados" value={String(finance?.canceledPlans ?? 0)} onClick={onOpenExStudents} />');
  });
});

describe('Termos de Uso: o aluno atesta a veracidade das informacoes', () => {
  const section = TERMS_SECTIONS.find((item) => item.id === 'informacoes');
  it('a secao 5 diz que o aluno atesta a veracidade e e o unico responsavel, citando registros manuais e marcas', () => {
    const text = (section?.paragraphs ?? []).join(' ');
    expect(text).toContain('atesta a veracidade de todas as informações que fornece');
    expect(text).toContain('registros manuais de treinos');
    expect(text).toContain('marcas ou resultados informados');
    expect(text).toContain('único responsável');
  });
  it('a versao dos textos legais mudou porque o texto mudou', () => {
    expect(LEGAL_VERSION).toBe('2026-11-10.1');
    expect(text(TERMS_SECTIONS)).not.toMatch(/motor|plano de treino/i);
  });
  function text(sections: typeof TERMS_SECTIONS) { return sections.flatMap((s) => s.paragraphs).join(' '); }
});

describe('tela das melhores marcas: selo "novo" e mini-grafico', () => {
  it('"novo" so nos ultimos 30 dias (dia local de Sao Paulo) e nunca no futuro', () => {
    const now = new Date('2026-11-09T15:00:00Z');
    expect(isRecentMark('2026-11-09', now)).toBe(true);
    expect(isRecentMark('2026-10-10', now)).toBe(true); // 30 dias
    expect(isRecentMark('2026-10-09', now)).toBe(false); // 31 dias
    expect(isRecentMark('2026-11-12', now)).toBe(false); // futuro
  });
  it('mini-grafico: so as marcas batidas, em coordenadas 0-1 (mais rapido em cima); vazio sem marcas', () => {
    const points = sparklinePoints([mark({ activityId: 'a', localDate: '2026-01-10', seconds: 1700 }), mark({ activityId: 'b', localDate: '2026-03-10', seconds: 1800 }), mark({ activityId: 'c', localDate: '2026-06-10', seconds: 1600 })]);
    expect(points).toHaveLength(2); // a e c sao marcas batidas; b nao
    expect(points[0]).toEqual({ x: 0, y: 1 });
    expect(points[1]).toEqual({ x: 1, y: 0 });
    expect(sparklinePoints([])).toEqual([]);
    expect(sparklinePoints([mark()])).toEqual([{ x: 0.5, y: 0.5 }]);
  });
  it('a tela tem cartoes em grade, detalhe animado que rola ate ele e a lista de registros manuais', () => {
    const screen = readFileSync(join(__dirname, '..', '..', 'mobile', 'home', 'BestMarksScreen.tsx'), 'utf8');
    expect(screen).toContain('TOQUE EM UMA DISTÂNCIA');
    expect(screen).toContain('scrollAppToWindowY(y, 16)');
    expect(screen).toContain('Meus registros manuais de corrida');
    expect(screen).toContain('<FadeIn k=');
    expect(screen).toContain('isRecentMark(best.localDate)');
  });
});
