import { readFileSync } from 'fs';
import { join } from 'path';

// Aba Conta: data de nascimento sem o dia a menos e "Excluir conta" facil de achar (pedido da revisao da Apple).
const app = readFileSync(join(__dirname, '..', '..', 'mobile', 'App.tsx'), 'utf8');
const contaScreen = app.slice(app.indexOf('function ContaScreen('), app.indexOf('// HistoryCalendar'));
const meusDados = app.slice(app.indexOf('function MeusDados('), app.indexOf('interface LegalSummary'));

describe('aba Conta', () => {
  it('"Nascimento" usa a mesma leitura em UTC do campo de edicao (sem o dia a menos no Brasil)', () => {
    expect(app).toContain('{formatDateFromApi(savedMe.birthDate)}');
    expect(app).not.toContain('formatFullDate(new Date(savedMe.birthDate))');
    // a leitura correta usa os getters UTC (a data de nascimento e' guardada como meia-noite UTC)
    const helper = app.slice(app.indexOf('function formatDateFromApi('), app.indexOf('const styles = StyleSheet.create'));
    expect(helper).toContain('getUTCDate()');
    expect(helper).toContain('getUTCMonth()');
    expect(helper).toContain('getUTCFullYear()');
    expect(meusDados).not.toContain('formatFullDate(new Date(savedMe.birthDate))');
  });

  it('o fluxo de exclusao aparece na aba Conta, logo apos "Sair da conta", com o mesmo componente da tela Privacidade e dados', () => {
    expect(contaScreen).toContain('<DeleteAccountSection accessToken={accessToken} apiUrl={API_URL} onOpenBilling={onOpenBilling} onDeleted={onLogout} />');
    expect(contaScreen.indexOf('Sair da conta')).toBeLessThan(contaScreen.indexOf('<DeleteAccountSection'));
    expect(app).toContain("onOpenBilling={() => setActiveTab('billing')}");
    // continua tambem em Privacidade e dados
    expect(app.match(/<DeleteAccountSection/g)).toHaveLength(2);
  });
});
