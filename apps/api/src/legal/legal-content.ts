// FONTE CANONICA dos Termos de Uso e da Politica de Privacidade (05/10/2026).
// Tudo que e' publico (paginas HTML) e tudo que o app mostra na tela "Privacidade e dados" sai DAQUI —
// nenhum outro lugar tem copia do texto. As URLs /termos-de-uso e /politica-privacidade sao as
// canonicas (usadas pelo cadastro no app e pelas lojas); /legal/terms e /legal/privacy apenas
// redirecionam para elas.
//
// Regra editorial: o texto descreve o que o sistema FAZ (conferido no codigo). Nao afirma conformidade
// legal, nao inventa prazo, base legal nem garantia de fornecedor. O que depende de contrato ou de
// configuracao externa e' dito como tal.

export const LEGAL_VERSION = '2026-10-05';
export const LEGAL_UPDATED_LABEL = '5 de outubro de 2026';
export const LEGAL_CONTACT = 'eltonpanzeri@gmail.com';
export const LEGAL_PATHS = { terms: '/termos-de-uso', privacy: '/politica-privacidade' } as const;

export interface LegalSection {
  id: string;
  heading: string;
  // Itens iniciados por "- " viram lista; os demais, paragrafos.
  paragraphs: string[];
}

// ─── Blocos compartilhados (Politica, Termos e tela do app usam as MESMAS frases) ──────────────────

const DATA_CATEGORIES = [
  '- Cadastro e perfil: nome, e-mail, telefone, CPF, endereço, data de nascimento, sexo, altura e peso.',
  '- Entrevista e rotina: objetivos, disponibilidade semanal, histórico de treino, lesões e condições de saúde informadas.',
  '- Feedback de treino: esforço percebido, dor, sono, estresse, motivação, cansaço físico e mental, e suas observações.',
  '- Relatos e registros opcionais: dores, observações escritas, testes de desempenho, prova alvo, tênis cadastrados e, para quem optar, registro do ciclo menstrual.',
  '- Treino: programa de treino, sessões prescritas e realizadas, histórico, métricas de evolução (como volume e aderência) e conquistas.',
];

const WEARABLE_INTRO =
  'Você pode autorizar serviços externos compatíveis a compartilhar suas atividades com o Panzeri Run. Hoje o aplicativo oferece conexão com a Polar e com o Strava. Outros serviços poderão ser adicionados e, nesse caso, esta política será atualizada.';

const WEARABLE_FIELDS = [
  'Dependendo do serviço e das permissões que você conceder, podem ser recebidos dados como:',
  '- data e horário, duração, distância e modalidade;',
  '- ritmo, frequência cardíaca, cadência, potência, elevação e calorias;',
  '- rota (GPS), quando o serviço a disponibiliza;',
  '- amostras e séries ao longo da atividade;',
  '- outros campos efetivamente fornecidos pelo serviço autorizado.',
  'Nem todo serviço fornece todos esses dados, e dados vindos de dispositivos podem conter erros ou limitações.',
];

const RAW_AND_DERIVED = [
  'O Panzeri Run guarda o registro recebido do serviço conectado tal como ele chegou e gera, a partir dele, informações derivadas para: mostrar a atividade, comparar o que foi prescrito com o que foi realizado, acompanhar sua evolução, manter seu histórico ao longo do tempo e personalizar seu treinamento.',
];

const AI_PARAGRAPHS = [
  'O Panzeri Run usa serviços de inteligência artificial em funções do produto, como montar e ajustar o programa de treino, analisar a evolução, interpretar relatos escritos e apoiar o acompanhamento feito pelo treinador. O fornecedor utilizado hoje é a Anthropic.',
  'Para cada uma dessas funções, o Panzeri Run envia ao fornecedor, no momento da solicitação, as informações necessárias àquela função, como dados do seu perfil e da entrevista, sua rotina, seus feedbacks e relatos, e seu histórico e métricas de treino. Quando você conecta serviços de atividades, resumos derivados delas (como volume, distância e ritmo) podem fazer parte desse contexto. O conteúdo bruto recebido desses serviços (registros completos, séries de amostras e rotas) não faz parte do que o Panzeri Run envia à IA.',
  'Este texto descreve o que o Panzeri Run envia. As regras do fornecedor sobre guardar essas informações ou usá-las para treinar modelos dependem dos termos do próprio fornecedor, e o Panzeri Run não as afirma por ele.',
];

const DISCONNECT_PARAGRAPH =
  'Desconectar um serviço interrompe novas sincronizações e retira a autorização guardada no Panzeri Run, mas não apaga automaticamente o histórico já importado.';

const DELETE_PARAGRAPHS = [
  'Excluir os dados importados de um serviço é uma ação separada de desconectar. Para a Polar, você faz isso no próprio aplicativo (Privacidade e dados), depois de desconectar. Para os demais serviços, a exclusão é feita mediante solicitação ao contato abaixo.',
  'São excluídos os dados que vieram exclusivamente do serviço (o registro recebido, a atividade, as amostras, as séries e os vínculos com os treinos). Informações que você mesmo forneceu ao Panzeri Run depois, como esforço percebido, dor, observações e escolha do tênis, podem permanecer, sem os valores que vieram do serviço.',
];

const THIRD_PARTIES = [
  '- Anthropic: processamento por inteligência artificial, descrito acima.',
  '- Polar e Strava: serviços que você conecta, com suas próprias políticas.',
  '- Asaas, RevenueCat e as lojas de aplicativos (Google Play e App Store): cobrança e assinatura. Não armazenamos dados de cartão.',
  '- Resend: envio de e-mails do serviço e das cópias de segurança descritas abaixo.',
  '- Expo: entrega de notificações no aplicativo.',
  '- Telegram: canal interno de avisos do treinador sobre o acompanhamento dos alunos.',
  '- Meta: quando configurado, o cadastro pode enviar um evento de medição de campanhas com e-mail em formato criptografado (hash), endereço IP e navegador.',
  '- Infraestrutura de hospedagem do aplicativo e do banco de dados.',
];

const BACKUP_PARAGRAPHS = [
  'Mantemos cópias de segurança periódicas do banco de dados para recuperação em caso de falha. Elas contêm os dados da conta existentes no momento de cada cópia e ficam guardadas fora do banco em operação.',
  'Quando um dado é excluído do banco em operação, a exclusão não alcança imediatamente as cópias de segurança já feitas: elas permanecem até serem substituídas ou descartadas pela nossa rotina, e não prometemos um prazo exato. A restauração de uma cópia pode trazer de volta dados que tinham sido excluídos depois da data dela.',
];

const REQUEST_PARAGRAPHS = [
  'Pelo aplicativo você pode: ver os dados que informou nas telas de perfil e feedbacks, desconectar a Polar e excluir os dados importados da Polar.',
  `Os demais pedidos (acesso, correção, exclusão da conta, exclusão de dados do Strava, revogação de consentimento) são tratados manualmente: escreva para ${LEGAL_CONTACT}, do mesmo e-mail cadastrado. O procedimento e os prazos de exclusão de conta estão na Política de Privacidade.`,
];

// ─── Politica de Privacidade ────────────────────────────────────────────────────────────────────

export const PRIVACY_SECTIONS: LegalSection[] = [
  { id: 'controlador', heading: '1. Controlador dos dados', paragraphs: ['Elton Panzeri, responsável pelo Panzeri Run.'] },
  {
    id: 'dados',
    heading: '2. Dados que coletamos',
    paragraphs: [
      'Dados fornecidos por você ou gerados pelo uso do aplicativo:',
      ...DATA_CATEGORIES,
      'Dados de pagamento são processados pelo Asaas ou pela loja de aplicativos; não armazenamos dados de cartão.',
    ],
  },
  { id: 'wearables', heading: '3. Serviços e dispositivos conectados', paragraphs: [WEARABLE_INTRO, ...WEARABLE_FIELDS, ...RAW_AND_DERIVED] },
  {
    id: 'finalidades',
    heading: '4. Para que usamos',
    paragraphs: [
      'Personalizar a prescrição de treinos; acompanhar evolução e segurança do aluno; processar pagamento da assinatura; comunicação sobre o serviço (e-mail, notificações).',
    ],
  },
  {
    id: 'base-legal',
    heading: '5. Base legal',
    paragraphs: ['Execução de contrato (prestação do serviço) e consentimento explícito, para dados sensíveis de saúde.'],
  },
  { id: 'ia', heading: '6. Inteligência artificial', paragraphs: AI_PARAGRAPHS },
  {
    id: 'terceiros',
    heading: '7. Compartilhamento e serviços de terceiros',
    paragraphs: ['O Panzeri Run usa os seguintes serviços externos, cada um para a finalidade indicada:', ...THIRD_PARTIES],
  },
  {
    id: 'desconexao',
    heading: '8. Desconectar um serviço',
    paragraphs: [DISCONNECT_PARAGRAPH, 'Depois de desconectar, novos dados daquele serviço não são mais recebidos. Para voltar a receber, é preciso autorizar a conexão novamente.'],
  },
  { id: 'exclusao-integracao', heading: '9. Excluir os dados de um serviço conectado', paragraphs: DELETE_PARAGRAPHS },
  { id: 'backup', heading: '10. Cópias de segurança', paragraphs: BACKUP_PARAGRAPHS },
  {
    id: 'retencao',
    heading: '11. Retenção',
    paragraphs: ['Os dados são mantidos enquanto a conta estiver ativa e pelo prazo necessário para cumprimento de obrigações legais após o encerramento. As cópias de segurança seguem o descrito na seção 10.'],
  },
  {
    id: 'direitos',
    heading: '12. Seus direitos',
    paragraphs: ['Acesso, correção, exclusão, portabilidade e revogação do consentimento a qualquer momento, mediante solicitação ao contato abaixo. Parte do controle já pode ser exercida no aplicativo, na área Privacidade e dados.'],
  },
  {
    id: 'exclusao-conta',
    heading: '13. Como pedir a exclusão da sua conta e dos seus dados',
    paragraphs: [
      `Envie um e-mail para ${LEGAL_CONTACT}, do mesmo endereço cadastrado no Panzeri Run, com o assunto "Exclusão de conta". Confirmamos o pedido em até 5 dias úteis e concluímos a exclusão em até 15 dias.`,
      'São excluídos: dados de cadastro (nome, e-mail, telefone, CPF, endereço), dados de saúde e condicionamento físico, histórico de treinos prescritos e realizados, dados importados de serviços conectados e mensagens trocadas com o treinador/agente de IA, no banco em operação. As cópias de segurança seguem o descrito na seção 10.',
      'São mantidos, quando exigido por lei, apenas registros de pagamento (nota fiscal/comprovante), pelo prazo mínimo exigido pela legislação fiscal brasileira — nunca usados para nenhum outro fim depois da exclusão da conta.',
    ],
  },
  {
    id: 'alteracoes',
    heading: '14. Alterações e versão',
    paragraphs: [`Esta é a versão de ${LEGAL_UPDATED_LABEL}. Alterações relevantes serão comunicadas dentro do aplicativo.`],
  },
  { id: 'contato', heading: '15. Contato', paragraphs: [LEGAL_CONTACT] },
];

// ─── Termos de Uso ─────────────────────────────────────────────────────────────────────────────

export const TERMS_SECTIONS: LegalSection[] = [
  {
    id: 'o-que-e',
    heading: '1. O que é o Panzeri Run',
    paragraphs: ['Aplicativo de prescrição e acompanhamento de treinos de corrida, personalizado por metodologia técnica definida pelo treinador responsável (Elton Panzeri) e operacionalizado por agentes de inteligência artificial, sob supervisão técnica.'],
  },
  {
    id: 'natureza',
    heading: '2. Natureza do serviço',
    paragraphs: ['O acompanhamento é feito a distância, sem supervisão presencial ou em tempo real durante a execução dos treinos. O aluno é responsável por avaliar suas próprias condições físicas a cada sessão e por interromper a atividade e buscar atendimento médico diante de qualquer sinal de risco.'],
  },
  {
    id: 'medico',
    heading: '3. Não substitui avaliação médica',
    paragraphs: ['O Panzeri Run não presta serviço médico, fisioterapêutico ou de emergência. Recomenda-se avaliação médica prévia, especialmente para pessoas com condições de saúde preexistentes.'],
  },
  {
    id: 'assinatura',
    heading: '4. Assinatura e pagamento',
    paragraphs: ['O acesso ao programa de treinos depende de assinatura mensal ativa. Para novas assinaturas, o valor atual é de R$24,90/mês, processado pelo canal de pagamento escolhido. Condições anteriores já contratadas podem ser preservadas. O cancelamento pode ser feito a qualquer momento, sem multa, produzindo efeito conforme as regras vigentes de cobrança.'],
  },
  {
    id: 'informacoes',
    heading: '5. Responsabilidade sobre informações',
    paragraphs: ['O programa de treinos é construído com base nas informações fornecidas pelo aluno. Informações incompletas, desatualizadas ou incorretas podem comprometer a adequação e a segurança do treino prescrito.'],
  },
  {
    id: 'integracoes',
    heading: '6. Integrações com serviços externos',
    paragraphs: [
      '- Conectar um serviço externo (como Polar ou Strava) depende da sua autorização, que você pode retirar a qualquer momento.',
      '- O Panzeri Run usa os dados desses serviços como parte do acompanhamento e da personalização do seu treino, conforme a Política de Privacidade.',
      '- Dados vindos de dispositivos podem conter erros ou limitações, e a disponibilidade da integração pode depender do próprio serviço, que pode mudar ou ficar indisponível.',
      '- Desconectar uma integração não apaga automaticamente o histórico já importado; a exclusão desses dados é uma ação separada, descrita na Política de Privacidade.',
    ],
  },
  { id: 'alteracoes', heading: '7. Alterações', paragraphs: [`Estes termos podem ser atualizados; alterações relevantes serão comunicadas dentro do aplicativo. Versão de ${LEGAL_UPDATED_LABEL}.`] },
  { id: 'contato', heading: '8. Contato', paragraphs: [`Dúvidas: ${LEGAL_CONTACT}`] },
];

// ─── Resumo para a tela "Privacidade e dados" do app (mesmas frases dos documentos) ─────────────

export const LEGAL_SUMMARY = {
  version: LEGAL_VERSION,
  updatedLabel: LEGAL_UPDATED_LABEL,
  contact: LEGAL_CONTACT,
  links: LEGAL_PATHS,
  sections: [
    { id: 'dados', title: 'Seus dados', paragraphs: ['Estes são os tipos de dado que o Panzeri Run usa para personalizar e acompanhar seu treino:', ...DATA_CATEGORIES] },
    { id: 'integracoes', title: 'Dispositivos e integrações', paragraphs: [WEARABLE_INTRO, ...WEARABLE_FIELDS, ...RAW_AND_DERIVED] },
    { id: 'ia', title: 'Inteligência Artificial', paragraphs: AI_PARAGRAPHS },
    { id: 'gerenciar', title: 'Gerenciar dados da integração', paragraphs: [DISCONNECT_PARAGRAPH, ...DELETE_PARAGRAPHS, ...BACKUP_PARAGRAPHS.slice(1, 2)] },
    { id: 'terceiros', title: 'Terceiros e processamento', paragraphs: ['O Panzeri Run usa estes serviços externos, cada um para a finalidade indicada:', ...THIRD_PARTIES] },
    { id: 'solicitacoes', title: 'Solicitações sobre meus dados', paragraphs: REQUEST_PARAGRAPHS },
  ] as Array<{ id: string; title: string; paragraphs: string[] }>,
};

// ─── Renderizacao HTML (unica) ──────────────────────────────────────────────────────────────────

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderParagraphs(paragraphs: string[]): string {
  let html = '';
  let inList = false;
  for (const paragraph of paragraphs) {
    if (paragraph.startsWith('- ')) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${escapeHtml(paragraph.slice(2))}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p>${escapeHtml(paragraph)}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return html;
}

export function renderLegalPage(title: string, sections: LegalSection[]): string {
  const body = sections.map((section) => `<h2>${escapeHtml(section.heading)}</h2>${renderParagraphs(section.paragraphs)}`).join('');
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>Panzeri Run - ${escapeHtml(title)}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { background: #f8fafc; color: #0f172a; font-family: Arial, sans-serif; margin: 0; padding: 24px; line-height: 1.6; }
      main { background: #ffffff; border: 1px solid #dbe4ee; border-radius: 12px; margin: 24px auto; max-width: 640px; padding: 32px; }
      h1 { color: #0f766e; font-size: 22px; }
      h2 { color: #0f766e; font-size: 16px; margin-top: 24px; }
      p, li { color: #334155; font-size: 15px; }
    </style>
  </head>
  <body>
    <main><h1>${escapeHtml(title)} — Panzeri Run</h1>${body}</main>
  </body>
</html>`;
}

export const renderTermsPage = () => renderLegalPage('Termos de Uso', TERMS_SECTIONS);
export const renderPrivacyPage = () => renderLegalPage('Política de Privacidade', PRIVACY_SECTIONS);
