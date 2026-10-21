import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ZeppController } from '../src/zepp/zepp.controller';
import { buildIntegrationsCatalog, INTEGRATION_PROVIDERS } from '../src/integrations/integrations-catalog';
import { PRIVACY_SECTIONS, TERMS_SECTIONS, LEGAL_SUMMARY, renderPrivacyPage, renderTermsPage, LEGAL_CONTACT } from '../src/legal/legal-content';

const read = (...parts: string[]) => readFileSync(join(__dirname, '..', '..', ...parts), 'utf8');
const screen = read('mobile', 'src', 'zepp', 'ZeppIntegration.tsx');
const text = (sections: Array<{ heading: string; paragraphs: string[] }>) => sections.map((s) => `${s.heading}\n${s.paragraphs.join('\n')}`).join('\n');
const PRIVACY = text(PRIVACY_SECTIONS);
const TERMS = text(TERMS_SECTIONS);

describe('telas Zepp no app: nada marcado, autorizacoes independentes, revogacao acessivel', () => {
  it('nenhuma caixa nasce marcada: todo estado de autorizacao comeca falso/vazio', () => {
    expect(screen).toContain("useState<string[]>([])"); // grupos escolhidos
    for (const name of ['acknowledged', 'history', 'openAck']) expect(screen).toMatch(new RegExp(`const \\[${name}, set\\w+\\] = useState\\(false\\)`));
    expect(screen.match(/useState\(true\)/g)).toHaveLength(1); // so o indicador de carregamento (loading); nenhuma caixa de autorizacao
    expect(screen).not.toMatch(/checked=\{true\}|defaultChecked/);
  });

  it('o texto da conexao e das telas por finalidade vem do SERVIDOR (versao e hash devolvidos em cada autorizacao); o app nao duplica o texto legal', () => {
    for (const field of ['doc.title', 'doc.intro', 'doc.acknowledgementText', 'doc.confirmButtonLabel', 'option.screen.title', 'option.screen.checkboxText', 'option.screen.buttonLabel']) expect(screen).toContain(field);
    expect(screen).toContain('consentVersion: doc.version');
    expect(screen).toContain('consentTextHash: doc.textHash');
    expect(screen).toContain('consentVersion: option.screen ? option.screen.version : doc.version');
    expect(screen).toContain('doc.purposeHashes[option.id]');
    expect(screen).not.toContain('Conecte seu Amazfit ao Panzeri Run');
    expect(screen).not.toContain('Personalize seus treinos com o Atlas');
  });

  it('botao de conectar so habilita com a autorizacao obrigatoria marcada; Atlas indisponivel nao pode ser autorizado e a recusa nao bloqueia nada', () => {
    expect(screen).toContain('disabled={!acknowledged}');
    expect(screen).toContain('const unavailable = !state.available');
    expect(screen).toContain('disabled={unavailable || !(open === id && openAck)}');
    expect(screen).toContain('Esta autorização ainda não está disponível');
    // conectar nao depende de watch/Atlas: o corpo do pedido de conexao so' leva grupos, o historico (opcional) e o aceite
    const connectBody = screen.slice(screen.indexOf("call('/zepp/connect'"), screen.indexOf('setBusy(\'\');', screen.indexOf("call('/zepp/connect'")));
    expect(connectBody).not.toMatch(/watch_delivery|ai_external|WATCH|ATLAS/);
  });

  it('Privacidade e permissoes: as quatro autorizacoes separadas, cada uma com controle proprio de retirada e confirmacao dentro do app', () => {
    expect(screen).toContain('Privacidade e permissões');
    for (const label of ['Importação de atividades', 'Importação do histórico (30 dias)', 'Envio de treinos ao relógio', 'Análise pelo Atlas com a Anthropic']) expect(screen).toContain(label);
    expect(screen).toContain('Você controla como seus dados Amazfit são utilizados no Panzeri Run. Pode retirar uma autorização quando desejar. A revogação interrompe os novos tratamentos relacionados àquela finalidade e será aplicada aos dados e resultados já existentes conforme a Política de Privacidade e as obrigações legais.');
    expect(screen).toContain("row('activity', 'group'");
    expect(screen).toContain('row(HISTORY, \'purpose\'');
    expect(screen).toContain('row(WATCH, \'purpose\'');
    expect(screen).toContain('row(ATLAS, \'purpose\'');
    expect(screen).toContain('Retirar autorização');
    expect(screen).toContain("call('/zepp/purposes', 'POST', { revoke: [id] })");
    expect(screen).toContain("call('/zepp/groups', 'POST', { revoke: [id] })");
    expect(screen).not.toMatch(/window\.confirm|Alert\.alert/);
    for (const effect of ['REVOKE_EFFECT', 'invalidados ou atualizados', 'remove da sua conta Zepp os treinos já enviados']) expect(screen).toContain(effect);
  });

  it('desconectar e excluir: opcoes presentes, e a exclusao explica o que e apagado, o que pode ser mantido e as consequencias ANTES do botao', () => {
    expect(screen).toContain('Desconectar minha conta Zepp');
    expect(screen).toContain('Solicitar exclusão dos meus dados Zepp');
    const explanation = screen.slice(screen.indexOf('Antes de excluir, saiba o que acontece'), screen.indexOf('Excluir os dados da Zepp'));
    for (const part of ['O que será apagado', 'O que pode ser mantido', 'Consequências', 'obrigações', 'Não é possível desfazer']) {
      if (part === 'obrigações') continue; // a politica trata das obrigacoes legais; a tela cita a Politica de Privacidade
      expect(explanation).toContain(part);
    }
    expect(explanation).toContain('Política de Privacidade');
    expect(explanation).not.toMatch(/\b\d+ (dias|meses)\b/); // nenhum prazo inventado na tela
  });

  it('historico auditavel visivel ao aluno (item, decisao, versao, data) e links para Politica e Termos', () => {
    expect(screen).toContain('histórico das minhas autorizações');
    expect(screen).toMatch(/texto v\$\{entry\.version\}/);
    expect(screen).toContain('Política de Privacidade');
    expect(screen).toContain('Termos de Uso');
  });

  it('o app registra a tela no hub de integracoes e em Privacidade e dados', () => {
    const app = read('mobile', 'App.tsx');
    expect(app).toContain("import { ZeppIntegration } from './src/zepp/ZeppIntegration';");
    expect(app).toContain('zepp: () => <ZeppIntegration');
    expect(app).toContain('variant="manage" privacyUrl');
  });
});

describe('rotas e catalogo', () => {
  it('retirar o envio de treinos remove os treinos da Zepp na hora (sem esperar a rotina) e nunca desfaz a revogacao', async () => {
    const connections = { updatePurposes: jest.fn(async () => ({ purposes: [] })) };
    const reconcile = jest.fn(async () => { throw new Error('falha da Zepp'); });
    const controller = new ZeppController(connections as any, {} as any, { reconcile } as any);
    const result = await controller.purposes({ sub: 'u1' } as any, { revoke: ['watch_delivery'] });
    expect(result).toEqual({ purposes: [] });
    expect(reconcile).toHaveBeenCalledWith('u1');
    reconcile.mockClear();
    await controller.purposes({ sub: 'u1' } as any, { revoke: ['ai_external'] });
    await controller.purposes({ sub: 'u1' } as any, { grant: ['watch_delivery'], acknowledged: true });
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('o aluno acessa as proprias permissoes: as rotas usam so o usuario do JWT', () => {
    const controller = new ZeppController({ permissions: jest.fn(async (_p: string, userId: string) => ({ userId })), updateGroups: jest.fn(async (_p: string, userId: string) => ({ userId })) } as any, {} as any, {} as any);
    expect(controller.permissions({ sub: 'aluno-A' } as any)).resolves.toEqual({ userId: 'aluno-A' });
    expect(controller.groups({ sub: 'aluno-B' } as any, { revoke: ['route'] })).resolves.toEqual({ userId: 'aluno-B' });
  });

  it('catalogo: Zepp so aparece disponivel para quem foi habilitado (ou ja conectado) e com as 4 variaveis; recebe atividades e envia treinos', () => {
    const entry = INTEGRATION_PROVIDERS.find((p) => p.id === 'zepp')!;
    expect(entry).toMatchObject({ name: 'Zepp / Amazfit', requiresAllowlist: true, capabilities: { receiveActivities: true, sendWorkouts: true } });
    const env = new Set(['ZEPP_CLIENT_ID', 'ZEPP_CLIENT_SECRET', 'ZEPP_REDIRECT_URI', 'ZEPP_TOKEN_ENCRYPTION_KEY']);
    const find = (inputs: Parameters<typeof buildIntegrationsCatalog>[0]) => buildIntegrationsCatalog(inputs).find((p) => p.id === 'zepp')!;
    expect(find({ configuredEnv: env, connectedProviderIds: new Set() }).availability).toBe('unavailable');
    expect(find({ configuredEnv: env, connectedProviderIds: new Set(), allowedProviderIds: new Set(['zepp']) }).availability).toBe('available');
    expect(find({ configuredEnv: new Set(), connectedProviderIds: new Set(), allowedProviderIds: new Set(['zepp']) }).availability).toBe('unavailable');
    expect(find({ configuredEnv: env, connectedProviderIds: new Set(['zepp']) }).connection.state).toBe('connected');
  });
});

describe('Politica de Privacidade e Termos de Uso: Zepp/Amazfit e Atlas', () => {
  it('a Politica explica dados recebidos, dados enviados a Zepp, uso, autorizacoes separadas, controle, revogacao, desconexao, exclusao e retencao', () => {
    for (const part of [
      '5A. Zepp/Amazfit', 'quatro autorizações separadas', 'nenhuma vem marcada e nenhuma é presumida', 'Dados que recebemos da Zepp', 'identificador da conta Zepp',
      'O arquivo original da atividade não é guardado', 'percurso GPS (coordenadas) só é guardado se você autorizar', 'Dados que enviamos à Zepp', 'nome do treino, data, etapas (distância ou tempo) e ritmos-alvo',
      'Não enviamos seu nome, dados de saúde', 'Privacidade e permissões', 'Registramos cada decisão sua', 'nova autorização', 'Desconectar a conta Zepp', 'A exclusão dos dados da Zepp é uma ação separada', 'Permanecem as informações que você mesmo forneceu',
      'hoje não há exclusão automática por prazo', 'Não definimos um prazo adicional',
    ]) expect(PRIVACY).toContain(part);
  });

  it('o Atlas e a Anthropic: finalidade, limitacoes, autorizacao especifica, proibicao de derivados e transferencia internacional SEM inventar mecanismo', () => {
    for (const part of [
      '7A. Atlas e a Anthropic', 'O Atlas é o nome da inteligência artificial', 'autorização específica, separada e opcional', 'nem diretamente nem por meio de relatórios ou informações derivados deles',
      'Recusar não impede conectar o Amazfit', 'não substituem avaliação médica', 'transferência internacional de dados', 'ainda estão sendo confirmados', 'antes de qualquer envio de dados da Zepp/Amazfit à Anthropic',
      'a autorização do Atlas não pode ser concedida', 'As coordenadas do percurso não fazem parte', 'não fazem parte do que o Panzeri Run envia à IA',
    ]) expect(PRIVACY.replace(/\n/g, ' ')).toContain(part.replace('As coordenadas do percurso não fazem parte', 'as coordenadas do percurso não fazem parte'));
    // nada de mecanismo, garantia contratual, prazo de retencao do fornecedor ou "nao treina" inventados
    expect(PRIVACY).not.toMatch(/cláusulas[- ]padrão|decisão de adequação|art\.? ?33|normas corporativas globais|selo|certifica/i);
    expect(PRIVACY).not.toMatch(/(não|nunca) (é|são|serão|será) (usado|usados) para treinar/i);
    expect(PRIVACY).not.toMatch(/retenção zero|zero retention/i);
  });

  it('direitos da LGPD e canal do responsavel; nenhum contato inventado', () => {
    for (const part of ['confirmar que tratamos seus dados', 'pedir a portabilidade', 'pedir a eliminação dos dados tratados com base no seu consentimento', 'saber com quem compartilhamos seus dados', 'revogar o consentimento a qualquer momento', 'canal do responsável pelo tratamento']) expect(PRIVACY).toContain(part);
    expect(LEGAL_CONTACT).toBe('eltonpanzeri@gmail.com');
    const emails = (PRIVACY.match(/[\w.+-]+@[\w-]+\.[\w-]+(?:\.[\w-]+)*/g) ?? []).map((email) => email.replace(/\.$/, ''));
    expect(emails.length).toBeGreaterThan(0);
    expect([...new Set(emails)]).toEqual([LEGAL_CONTACT]);
  });

  it('a Politica nomeia a Zepp Health e a Anthropic entre os fornecedores, com a funcao de cada um, e preserva as demais disposicoes', () => {
    expect(PRIVACY).toContain('Zepp Health (Zepp/Amazfit): serviço que você conecta');
    expect(PRIVACY).toContain('Anthropic: tecnologia de inteligência artificial usada pelo Atlas');
    for (const preserved of ['Asaas, RevenueCat', 'Cloudflare (R2)', 'Excluir os dados importados de um serviço é uma ação separada de desconectar', 'Hoje o aplicativo oferece conexão com a Polar, com o Strava e com a Wahoo', 'dependem dos termos do próprio fornecedor']) expect(PRIVACY).toContain(preserved);
    // a frase antiga "nao armazena GPS" agora tem a unica excecao declarada
    expect(JSON.stringify(LEGAL_SUMMARY)).toContain('exceto o percurso GPS do Amazfit, que só é guardado se você o autorizar');
  });

  it('os Termos explicam que o Atlas e apoio com limitacoes e que a integracao depende da disponibilidade e compatibilidade da Zepp/Amazfit', () => {
    for (const part of ['7. Atlas e inteligência artificial', 'apoia a prescrição e a análise do treinamento', 'limitações, podem conter erros e não substituem avaliação médica', 'depende de uma autorização específica', 'disponibilidade e da compatibilidade dos serviços e dos aparelhos Zepp/Amazfit', 'Cada autorização dessa integração é opcional']) expect(TERMS).toContain(part);
    expect(TERMS).toContain('8. Alterações');
    expect(TERMS).toContain('9. Contato');
  });

  it('as paginas publicas e o resumo do app trazem os novos blocos (mesma fonte canonica)', () => {
    expect(renderPrivacyPage()).toContain('5A. Zepp/Amazfit');
    expect(renderPrivacyPage()).toContain('7A. Atlas e a Anthropic');
    expect(renderTermsPage()).toContain('7. Atlas e inteligência artificial');
    expect(LEGAL_SUMMARY.sections.map((s) => s.id)).toEqual(expect.arrayContaining(['zepp', 'atlas']));
  });
});
