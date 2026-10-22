import { readFileSync } from 'fs';
import { join } from 'path';
import { renderPrivacyPage, PRIVACY_SECTIONS } from '../src/legal/legal-content';

// A politica das lojas descreve o que o codigo FAZ. Estes testes ligam as afirmacoes sensiveis a fatos do codigo, para o texto nao divergir da implementacao.
const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');
const all = PRIVACY_SECTIONS.flatMap((s) => s.paragraphs).join('\n');

describe('politica de privacidade das lojas', () => {
  it('Apple Saude: so leitura de treinos e distancia; nao le FC, rota, sono nem passos; nao grava', () => {
    const swift = read('mobile/modules/panzeri-apple-health/ios/PanzeriAppleHealthModule.swift');
    expect(swift).toContain('[HKObjectType.workoutType(), HKQuantityType(.distanceWalkingRunning)]');
    expect(swift).toContain('requestAuthorization(toShare: [], read: self.readTypes)');
    expect(swift).not.toMatch(/heartRate|HKWorkoutRoute|sleepAnalysis|stepCount|activeEnergyBurned/);
    expect(all).toContain('Pedimos apenas permissão de leitura');
    expect(all).toContain('não gravamos nenhum dado no app Saúde');
  });

  it('chaves do Info.plist coerentes: leitura declarada e texto de atualizacao diz que NAO grava', () => {
    const plugin = read('mobile/plugins/withAppleHealthProof.js');
    expect(plugin).toContain('NSHealthShareUsageDescription');
    expect(plugin).toMatch(/NSHealthUpdateUsageDescription/);
    expect(plugin).toContain('nao grava registros de saude');
  });

  it('Apple Watch: envio so por toque do aluno (botao na sessao prescrita)', () => {
    const button = read('mobile/src/appleWatchDelivery/AppleWatchSendButton.tsx');
    expect(button).toContain('Enviar ao Apple Watch');
    expect(all).toContain('O envio só acontece quando você toca nele');
  });

  it('Health Connect: leitura por categoria autorizada (somente leitura, sem escrita, sem rota GPS e sem segundo plano por enquanto) e coerente com o app', () => {
    const app = JSON.parse(read('mobile/app.json')) as { expo: { android: { permissions: string[] } } };
    const hc = app.expo.android.permissions.filter((p) => p.includes('health.'));
    for (const required of ['READ_EXERCISE', 'READ_DISTANCE', 'READ_HEART_RATE', 'READ_SLEEP']) expect(hc).toContain('android.permission.health.' + required);
    expect(hc.some((p) => /WRITE_|BACKGROUND|ROUTES/.test(p))).toBe(false);
    expect(all).toContain('não sincroniza continuamente em segundo plano');
  });

  it('exclusao de conta: o texto descreve o que o app e a API realmente fazem (senha, frase, cobranca externa, tombstone de 365 dias)', () => {
    const service = read('api/src/account-deletion/self-account-deletion.service.ts');
    const logic = read('mobile/src/accountDeletion/logic.ts');
    const ledger = read('api/src/backup/tombstone-ledger.ts');
    expect(service).toContain('bcrypt.compare');
    expect(logic).toContain("CONFIRM_PHRASE = 'EXCLUIR CONTA'");
    expect(ledger).toContain('TOMBSTONE_RETENTION_DAYS = 365');
    expect(all).toContain('Privacidade e dados > Excluir minha conta');
    expect(all).toContain('sua senha atual');
    expect(all).toContain('EXCLUIR CONTA');
    expect(all).toContain('NÃO cancela automaticamente cobranças feitas fora do Panzeri Run');
    expect(all).toContain('não impede a exclusão por causa dela');
    expect(all).toContain('somente você pode cancelá-la');
    expect(all).toContain('por 1 ano');
    expect(all).toContain('a conta não é reativada');
    // cobrancas ja emitidas (documentacao do Asaas, 11/10/2026)
    expect(all).toContain('pendentes ou vencidas');
    expect(all).toContain('Segundo a documentação do Asaas');
    expect(all).toContain('essa regra é do Asaas, não do Panzeri Run');
    expect(all).toContain('as cobranças já emitidas continuam válidas');
    expect(all).toContain('confirmação específica');
    expect(logic).toContain('Segundo o Asaas, cancelar a assinatura remove as cobranças pendentes e vencidas');
  });

  it('nao ha promessa de prazo, certificacao ou seguranca que o codigo nao sustente', () => {
    expect(all).not.toMatch(/ISO ?27001|certificad|100% seguro|nunca será|garantimos|vendemos|SSL|TLS/i);
  });

  it('conteudo atualizado: Apple Saude, ViaCEP, sem GPS, sem Meta no iPhone', () => {
    expect(PRIVACY_SECTIONS.map((section) => section.heading).join(' ')).toContain('Apple Saúde (HealthKit)');
    expect(all).toContain('ViaCEP');
    expect(all).toContain('não armazena coordenadas nem trajetos GPS');
    expect(all).toContain('Cadastros feitos pelo aplicativo para iPhone não geram nenhum envio à Meta');
    expect(all).not.toContain('rota (GPS), quando o serviço a disponibiliza');
  });

  it('pagina oficial (URL cadastrada nas lojas): titulo, secoes e contato; sem script', () => {
    const html = renderPrivacyPage();
    expect(html).toContain('Política de Privacidade');
    for (const section of PRIVACY_SECTIONS) expect(html).toContain(section.heading.replace(/&/g, '&amp;'));
    expect(html).toContain('eltonpanzeri@gmail.com');
    expect(html).not.toMatch(/<script/i);
  });
});
