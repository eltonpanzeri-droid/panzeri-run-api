import { ConsentCapability } from '../provider-hub/provider-connector';

// Autorizacao do ATLAS para quem JA' estava conectada em Polar ou Wahoo (22/10/2026). Essas conexoes sao anteriores ao consentimento por finalidade: a importacao das atividades
// ja' foi autorizada na propria conexao (OAuth), mas nao existia autorizacao ESPECIFICA para o uso pelo Atlas (IA externa). Esta tela pergunta isso, com texto, versao e hash proprios.
//
// REGRA DE NAO-PERDA (decisao de Elton, 22/10/2026): enquanto a aluna NAO decidir, nada muda — o comportamento anterior continua valendo (as atividades seguem sendo importadas e
// os resumos continuam podendo compor o contexto da IA, como informado na Politica). Quando ela decidir, vale o que escolheu: autorizou => registro com versao/hash; nao autorizou ou
// retirou => os dados desse provedor deixam de ir a IA. A importacao em si nunca e' interrompida por esta tela (para parar a importacao ela desconecta o provedor).
export const LEGACY_CONSENT_PROVIDERS = ['polar', 'wahoo'] as const;
export type LegacyConsentProvider = (typeof LEGACY_CONSENT_PROVIDERS)[number];
export const isLegacyConsentProvider = (value: string): value is LegacyConsentProvider => (LEGACY_CONSENT_PROVIDERS as readonly string[]).includes(value);

const NAME: Record<LegacyConsentProvider, string> = { polar: 'Polar Flow', wahoo: 'Wahoo' };
export const legacyProviderName = (provider: LegacyConsentProvider) => NAME[provider];

function buildDocument(provider: LegacyConsentProvider): ConsentCapability {
  const name = NAME[provider];
  return {
    version: '1.0',
    dateLabel: '22/10/2026',
    title: `Seus dados do ${name} e o Atlas`,
    intro: `Você já conectou o ${name} ao Panzeri Run, e isso continua valendo. Agora pedimos uma autorização à parte: o uso desses dados pelo Atlas.`,
    sections: [{ heading: null, paragraphs: [`A importação das suas atividades do ${name} já foi autorizada quando você conectou a conta e não muda com esta tela. Aqui você decide só se o Atlas pode usar esses dados em análises personalizadas.`] }],
    groups: [{ id: 'activity', label: 'Atividades importadas', description: `Atividades que você já autorizou ao conectar o ${name}.`, required: true, categories: ['activity'] }],
    purposes: ['history', 'tracking', 'plan_comparison', 'indicators', 'coach_view'],
    optionalPurposes: [
      {
        id: 'ai_external',
        label: 'Análise com o Atlas (inteligência artificial)',
        description: `Permite usar suas atividades do ${name} em análises personalizadas com o Atlas, incluindo o envio dos dados necessários à Anthropic.`,
        external: true,
        changeableAfterConnect: true,
        screen: {
          version: '1.0',
          dateLabel: '22/10/2026',
          title: 'Personalize seus treinos com o Atlas',
          paragraphs: [
            'O Atlas é a inteligência artificial utilizada pelo Panzeri Run para ajudar a analisar seu treinamento e orientar a personalização das próximas sessões.',
            `Com sua autorização, o Atlas poderá utilizar as atividades que você importou do ${name} — distância, ritmo, frequência cardíaca e demais informações que o ${name} fornecer — para avaliar como você respondeu às sessões planejadas.`,
            'Para realizar essas análises, o Panzeri Run poderá transmitir os dados necessários à Anthropic, empresa fornecedora da tecnologia de inteligência artificial utilizada pelo Atlas. Esse processamento poderá envolver transferência internacional de dados, conforme descrito na Política de Privacidade.',
            'As análises automatizadas podem apresentar limitações e não substituem avaliação médica.',
            `A recusa não desconecta o ${name} e não impede você de usar o Panzeri Run. Se você não autorizar, as atividades do ${name} não serão enviadas à Anthropic, nem diretamente nem por meio de resumos derivados delas.`,
            'Você pode mudar de ideia quando quiser nesta mesma tela. Ao retirar, o envio futuro cessa e os resultados de IA já gerados com esses dados são invalidados ou atualizados, respeitadas as obrigações legais de conservação. O que já tiver sido enviado ao fornecedor não pode ser desfeito junto a ele.',
          ],
          checkboxText: `Autorizo o Panzeri Run a utilizar minhas atividades do ${name} para análises personalizadas com o Atlas, incluindo o envio dos dados necessários à Anthropic para processamento por inteligência artificial, conforme a Política de Privacidade.`,
          buttonLabel: 'Autorizar análise com Atlas',
        },
      },
    ],
    acknowledgementText: `Autorizo o Panzeri Run a utilizar os dados que importo do ${name} conforme descrito.`,
    confirmButtonLabel: 'Salvar',
  };
}

export const LEGACY_CONSENT_DOCUMENTS: Readonly<Record<LegacyConsentProvider, ConsentCapability>> = { polar: buildDocument('polar'), wahoo: buildDocument('wahoo') };
