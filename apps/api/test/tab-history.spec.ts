import { readFileSync } from 'fs';
import { join } from 'path';
import { TAB_HISTORY_LIMIT, tabHistoryBack, tabHistoryGo, tabHistoryInitial } from '../../mobile/src/tabHistory';

// 08/11/2026 — pedido de Elton (e relato da Thaís no Android): botão voltar do sistema e botão "Voltar" em todas as telas.
type T = 'home' | 'week' | 'history' | 'profile' | 'billing';

describe('histórico de telas (parte pura)', () => {
  it('ir para uma tela nova empilha a anterior, e voltar desfaz', () => {
    let s = tabHistoryInitial<T>('home');
    s = tabHistoryGo(s, 'week', 'home');
    s = tabHistoryGo(s, 'history', 'home');
    expect(s).toEqual({ current: 'history', stack: ['home', 'week'] });
  });

  it('voltar percorre o caminho até o início, e do início não há para onde voltar', () => {
    let s = tabHistoryInitial<T>('home');
    s = tabHistoryGo(s, 'week', 'home');
    expect(s.stack).toEqual(['home']);
    s = tabHistoryGo(s, 'history', 'home');
    expect(s.stack).toEqual(['home', 'week']);
    const b1 = tabHistoryBack(s)!;
    expect(b1).toEqual({ current: 'week', stack: ['home'] });
    expect(tabHistoryBack(b1)).toEqual({ current: 'home', stack: [] });
    expect(tabHistoryBack(tabHistoryInitial<T>('home'))).toBeNull();
  });

  it('ir para o início zera a pilha', () => {
    let s = tabHistoryInitial<T>('home');
    s = tabHistoryGo(s, 'week', 'home');
    s = tabHistoryGo(s, 'history', 'home');
    s = tabHistoryGo(s, 'home', 'home');
    expect(s).toEqual({ current: 'home', stack: [] });
  });

  it('ir para a tela do topo da pilha desfaz o passo (sem vai-e-volta infinito)', () => {
    let s = tabHistoryInitial<T>('home');
    s = tabHistoryGo(s, 'week', 'home');
    s = tabHistoryGo(s, 'history', 'home');
    s = tabHistoryGo(s, 'week', 'home'); // botão "Voltar" da própria tela chamando setTab('week')
    expect(s).toEqual({ current: 'week', stack: ['home'] });
  });

  it('ir para a tela em que já está não muda nada', () => {
    const s = tabHistoryGo(tabHistoryInitial<T>('home'), 'week', 'home');
    expect(tabHistoryGo(s, 'week', 'home')).toBe(s);
  });

  it('a pilha tem limite', () => {
    const tabs: T[] = ['week', 'history', 'profile', 'billing'];
    let s = tabHistoryInitial<T>('home');
    for (let i = 0; i < 200; i += 1) s = tabHistoryGo(s, tabs[i % tabs.length], 'home');
    expect(s.stack.length).toBeLessThanOrEqual(TAB_HISTORY_LIMIT);
  });
});

describe('ligação no aplicativo', () => {
  const app = readFileSync(join(__dirname, '..', '..', 'mobile', 'App.tsx'), 'utf8');
  it('App usa o histórico em vez de useState simples para a aba', () => {
    expect(app).toContain("useTabHistory<Tab>('home'");
    expect(app).not.toContain("const [activeTab, setActiveTab] = useState<Tab>('home')");
  });
});
