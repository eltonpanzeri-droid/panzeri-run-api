import { readFileSync } from 'fs';
import { join } from 'path';
import { AppController } from '../src/app.controller';
import { AuthController } from '../src/auth/auth.controller';
import {
  LEGAL_PATHS, LEGAL_SUMMARY, PRIVACY_SECTIONS, TERMS_SECTIONS,
  renderPrivacyPage, renderTermsPage,
} from '../src/legal/legal-content';

// Bloco pre-Garmin 3 (05/10/2026): uma unica fonte canonica para Politica e Termos, URLs antigas
// preservadas, texto fiel ao comportamento real e sem promessas que o codigo/contrato nao sustentam.

const text = (sections: Array<{ paragraphs: string[]; heading?: string; title?: string }>) =>
  sections.map((s) => `${s.heading ?? s.title ?? ''}\n${s.paragraphs.join('\n')}`).join('\n');
const PRIVACY = text(PRIVACY_SECTIONS);
const TERMS = text(TERMS_SECTIONS);
const SUMMARY = text(LEGAL_SUMMARY.sections);

function send(handler: (res: never) => void) {
  let html = '';
  handler({ type: () => ({ send: (value: string) => { html = value; } }) } as never);
  return html;
}

describe('fonte canonica unica e URLs preservadas', () => {
  const auth = new AuthController({} as never);

  it('/termos-de-uso e /politica-privacidade (usadas pelo cadastro e pelas lojas) renderizam a fonte canonica', () => {
    expect(send((res) => auth.termsOfUsePage(res as never))).toBe(renderTermsPage());
    expect(send((res) => auth.privacyPolicyPage(res as never))).toBe(renderPrivacyPage());
  });

  it('/legal/terms e /legal/privacy nao tem mais conteudo proprio: redirecionam 301 para as canonicas', () => {
    const redirect = (handler: unknown) => Reflect.getMetadata('__redirect__', handler as object) as { url: string; statusCode: number };
    expect(redirect(AppController.prototype.terms)).toEqual({ url: LEGAL_PATHS.terms, statusCode: 301 });
    expect(redirect(AppController.prototype.privacy)).toEqual({ url: LEGAL_PATHS.privacy, statusCode: 301 });
    expect(LEGAL_PATHS).toEqual({ terms: '/termos-de-uso', privacy: '/politica-privacidade' });
  });

  it('o app aponta para as mesmas URLs canonicas no cadastro e na area Privacidade e dados', () => {
    const app = readFileSync(join(__dirname, '../../mobile/App.tsx'), 'utf8');
    expect(app).toContain("/termos-de-uso';");
    expect(app).toContain("/politica-privacidade';");
    expect(app).not.toMatch(/legal\/(terms|privacy)/);
  });

  it('o resumo do app e servido pela mesma fonte e reaproveita as MESMAS frases da Politica (IA e terceiros)', () => {
    const controller = new AppController({} as never);
    expect(controller.legalSummary()).toBe(LEGAL_SUMMARY);
    const ai = PRIVACY_SECTIONS.find((s) => s.id === 'ia')!.paragraphs;
    expect(LEGAL_SUMMARY.sections.find((s) => s.id === 'ia')!.paragraphs).toEqual(ai);
    const third = PRIVACY_SECTIONS.find((s) => s.id === 'terceiros')!.paragraphs.filter((p) => p.startsWith('- '));
    expect(LEGAL_SUMMARY.sections.find((s) => s.id === 'terceiros')!.paragraphs).toEqual(expect.arrayContaining(third));
  });

  it('paginas HTML declaram UTF-8 e escapam o conteudo', () => {
    const html = renderPrivacyPage();
    expect(html).toContain('<meta charset="utf-8" />');
    expect(html).not.toContain('<script');
    expect(html).toContain('Política de Privacidade');
  });
});

describe('conteudo fiel ao produto atual', () => {
  it('nao afirma Garmin (nem na politica, nem nos termos, nem no resumo do app)', () => {
    for (const doc of [PRIVACY, TERMS, SUMMARY]) expect(doc).not.toMatch(/garmin/i);
    expect(PRIVACY).toContain('Hoje o aplicativo oferece conexão com a Polar e com o Strava');
    expect(PRIVACY).toContain('Outros serviços poderão ser adicionados');
  });

  it('desconexao e exclusao sao operacoes diferentes e a regra implementada esta descrita', () => {
    expect(PRIVACY).toContain('não apaga automaticamente o histórico já importado');
    expect(PRIVACY).toContain('Excluir os dados importados de um serviço é uma ação separada de desconectar');
    expect(PRIVACY).toContain('exclusivamente do serviço');
    expect(PRIVACY).toContain('podem permanecer, sem os valores que vieram do serviço');
    expect(TERMS).toContain('não apaga automaticamente o histórico já importado');
  });

  it('IA: descreve inferencia e o que e enviado; nao promete nada sobre retencao/treinamento do fornecedor', () => {
    expect(PRIVACY).toContain('Anthropic');
    expect(PRIVACY).toContain('no momento da solicitação');
    expect(PRIVACY).toContain('dependem dos termos do próprio fornecedor');
    expect(PRIVACY).toContain('não faz parte do que o Panzeri Run envia à IA');
    for (const doc of [PRIVACY, TERMS, SUMMARY]) {
      expect(doc).not.toMatch(/nunca (são|serão) usados? para treinar/i);
      expect(doc).not.toMatch(/não (são|serão) usados? para treinar/i);
      expect(doc).not.toMatch(/contrato de confidencialidade/i);
    }
  });

  it('backup: sem exclusao instantanea de todas as copias e sem prazo inventado', () => {
    expect(PRIVACY).toContain('a remoção das cópias de segurança pode não ocorrer imediatamente');
    for (const doc of [PRIVACY, SUMMARY]) expect(doc).not.toMatch(/restaura/i); // nao normaliza o retorno de dados excluidos
    expect(PRIVACY).toContain('não prometemos um prazo exato');
    expect(PRIVACY).not.toMatch(/exclusão (imediata|instantânea)/i);
    expect(PRIVACY).not.toMatch(/cópias de segurança[^.]*em até d+/i); // nenhum prazo de backup prometido
  });

  it('terceiros efetivamente usados estao listados', () => {
    for (const name of ['Anthropic', 'Resend', 'Asaas', 'RevenueCat', 'Expo', 'Telegram', 'Meta', 'Polar', 'Strava', 'hospedagem', 'Cloudflare']) {
      expect(PRIVACY).toContain(name);
    }
  });

  it('nao ha alegacao de conformidade nem a antiga promessa de nao compartilhar para publicidade (houve evento Meta)', () => {
    for (const doc of [PRIVACY, TERMS, SUMMARY]) {
      expect(doc).not.toMatch(/compliant|em conformidade com a lgpd|100% (seguro|conforme)/i);
    }
    expect(PRIVACY).not.toContain('Não vendemos nem compartilhamos dados com terceiros para fins de publicidade');
  });

  it('wearables: lista campos possiveis sem dizer que todos os servicos fornecem todos', () => {
    for (const field of ['frequência cardíaca', 'cadência', 'potência', 'elevação', 'calorias', 'rota (GPS)', 'amostras']) {
      expect(PRIVACY).toContain(field);
    }
    expect(PRIVACY).toContain('Nem todo serviço fornece todos esses dados');
  });

  it('termos: integracoes dependem de autorizacao, disponibilidade do provider e erros de dispositivo', () => {
    expect(TERMS).toContain('depende da sua autorização');
    expect(TERMS).toContain('podem conter erros ou limitações');
    expect(TERMS).toContain('pode mudar ou ficar indisponível');
    expect(TERMS).toContain('como parte do acompanhamento e da personalização');
  });

  it('o cadastro continua exigindo o aceite e mostrando os links dos documentos vigentes', () => {
    const app = readFileSync(join(__dirname, '../../mobile/App.tsx'), 'utf8');
    expect(app).toMatch(/Aceite os termos para criar a conta/);
    expect(app).toContain('Linking.openURL(LEGAL_TERMS_URL)');
    expect(app).toContain('Linking.openURL(LEGAL_PRIVACY_URL)');
    const service = readFileSync(join(__dirname, '../src/auth/auth.service.ts'), 'utf8');
    expect(service).toContain('acceptedTermsAt');
    expect(service).toContain('acceptedPrivacyAt');
  });
});

describe('tela Privacidade e dados (app)', () => {
  const app = readFileSync(join(__dirname, '../../mobile/App.tsx'), 'utf8');

  it('entrada permanente no menu e rota da tela', () => {
    expect(app).toContain("label: 'Privacidade e dados'");
    expect(app).toContain("activeTab === 'privacy'");
  });

  it('reutiliza os endpoints existentes (sem regra duplicada) e o resumo canonico', () => {
    const screen = app.slice(app.indexOf('function PrivacyDataScreen'), app.indexOf('function Anamnese('));
    expect(screen).toContain('/legal/summary');
    expect(screen).toContain('<PolarConnect accessToken={accessToken} variant="status" />');
    expect(screen).toContain('<PolarConnect accessToken={accessToken} variant="manage" />');
    expect(screen).not.toMatch(/\/polar\/(disconnect|data)/);
    expect(screen).not.toMatch(/garmin/i);
    for (const title of ['Seus dados', 'Dispositivos e integrações', 'Inteligência Artificial', 'Gerenciar dados da integração', 'Privacidade e Termos', 'Terceiros e processamento', 'Solicitações sobre meus dados']) {
      expect(screen).toContain(title);
    }
  });

  it('desconectar e excluir sao acoes distintas, ambas com confirmacao; excluir explica o que e removido e o que pode ficar', () => {
    const polar = app.slice(app.indexOf('function PolarConnect('), app.indexOf('interface LegalSummary'));
    expect(polar).toContain("fetch(`${API_URL}/polar/disconnect`");
    expect(polar).toContain("fetch(`${API_URL}/polar/data`, { method: 'DELETE'");
    expect(polar).toContain('window.confirm');
    expect(polar).toContain("style: 'destructive'");
    expect(polar).toContain('Serão removidos os dados que vieram exclusivamente da Polar');
    expect(polar).toContain('podem ser preservadas, sem os valores da Polar');
    expect(polar).toContain('Ação diferente de desconectar');
  });
});
