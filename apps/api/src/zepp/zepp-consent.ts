import { ConsentCapability } from '../provider-hub/provider-connector';

// Texto de consentimento Zepp/Amazfit — MINUTA FUNCIONAL versao 1.1 (19/10/2026). NAO e' documento juridicamente aprovado: antes da disponibilizacao geral aos
// alunos precisa de revisao juridica (LGPD: controlador, contato do titular, retencao, compartilhamentos, transferencia internacional, demais informacoes
// obrigatorias) e, para o envio a fornecedores externos de IA, de atualizacao das informacoes de privacidade e contato previo com a Zepp.
// Qualquer alteracao de texto/grupos/finalidades muda o hash e EXIGE nova versao: a conexao registra a versao e o hash do que o aluno viu.
//
// Mudancas da 1.0 para a 1.1 (19/10/2026):
//  - saiu a "frequencia cardiaca de repouso": a Zepp informou que ela nao existe no webhook de sono (so' nos Daily Events, ainda indisponiveis);
//  - entrou o grupo "Sensores das atividades" (FC, cadencia, altitude, potencia do treino) como categoria propria e opcional;
//  - passos/atividade diaria saíram (Daily Events indisponiveis); o texto cobre so' o que a Zepp entrega hoje (atividades concluidas e sono);
//  - entraram duas finalidades OPCIONAIS e separadas: importar ate 30 dias de historico e analises por IA com fornecedores externos.
// O que cada grupo AUTORIZA aqui e' o teto do que o Panzeri Run pode vir a acessar; nada disso e' importado hoje (recebimento de dados desligado). A restricao
// por grupo e' aplicada pelo Panzeri Run (ProviderConsentService / AiDataEligibility), porque a Zepp nao tem escopos por categoria.
export const ZEPP_CONSENT: ConsentCapability = {
  version: '1.1',
  dateLabel: '19/10/2026',
  title: 'Autorização para conectar Zepp/Amazfit ao Panzeri Run',
  intro: 'Ao conectar minha conta Zepp/Amazfit ao Panzeri Run, autorizo o aplicativo a acessar e utilizar os dados disponibilizados pela Zepp, dentro das categorias que eu selecionar e das permissões efetivamente concedidas pelo serviço.',
  sections: [
    {
      heading: '2.1. Quais dados poderão ser utilizados?',
      paragraphs: [
        'Conforme as permissões disponíveis e as categorias que eu autorizar, a integração poderá envolver:',
        'Nem todos esses dados estarão necessariamente disponíveis. O acesso dependerá das permissões da Zepp e das categorias autorizadas por mim. Dados que eu não selecionar não serão guardados nem utilizados.',
      ],
      bullets: [
        'Atividade física: corridas e caminhadas concluídas — data e hora, distância, duração, ritmo e calorias estimadas.',
        'Sensores das atividades: frequência cardíaca, cadência, altitude e potência registradas durante a atividade, quando o relógio as medir.',
        'Detalhes de atividades: informações de percurso e localização GPS, quando disponibilizadas pela Zepp.',
        'Sono e recuperação: duração e períodos do sono, estágios do sono, despertares, cochilos e pontuação do sono.',
        'Perfil da conta: identificador da conta Zepp, necessário à identificação e vinculação da conexão.',
      ],
    },
    {
      heading: '2.2. Para que meus dados serão utilizados?',
      paragraphs: [
        'Os dados autorizados poderão ser utilizados pelo Panzeri Run para:',
        'Este consentimento, por si só, não autoriza análises por inteligência artificial nem o envio dos dados a fornecedores externos. Isso depende da autorização opcional e separada descrita na seção 2.3.',
      ],
      bullets: [
        'Organizar meu histórico de atividades físicas.',
        'Acompanhar minha evolução e meu treinamento.',
        'Comparar atividades realizadas com os treinos prescritos, quando essa funcionalidade estiver disponível.',
        'Apresentar indicadores de desempenho, atividade física e recuperação, conforme as funcionalidades habilitadas.',
        'Permitir que meu treinador vinculado acompanhe as informações necessárias à orientação do treinamento, dentro das permissões aplicáveis.',
      ],
    },
    {
      heading: '2.3. Análises por inteligência artificial (autorização opcional e separada)',
      paragraphs: [
        'Esta autorização é opcional, é independente da conexão e pode ser concedida ou retirada por mim a qualquer momento, sem precisar desconectar a Zepp.',
        'O Panzeri Run utiliza fornecedores externos de inteligência artificial (atualmente a Anthropic). Se eu autorizar, partes dos dados das categorias que selecionei — e informações calculadas a partir deles — poderão ser enviadas a esses fornecedores para gerar análises técnicas, acompanhar minha evolução e individualizar meu programa de treino. Esses dados não serão usados para outras finalidades.',
        'Se eu não autorizar, meus dados da Zepp continuarão sendo usados nas demais finalidades da seção 2.2, mas não serão enviados a fornecedores externos de inteligência artificial nem usados para gerar análises por IA.',
        'Ao retirar a autorização, o envio futuro cessa. O que já tiver sido enviado não pode ser desfeito junto ao fornecedor.',
      ],
    },
    {
      heading: '2.4. Como meus dados serão protegidos?',
      paragraphs: [
        'O Panzeri Run utilizará mecanismos de segurança para proteger a conexão e os dados recebidos.',
        'As credenciais de acesso à Zepp serão armazenadas de forma cifrada. O aplicativo não solicitará minha senha da conta Zepp diretamente.',
        'O acesso aos meus dados deverá ficar limitado às funcionalidades autorizadas e às pessoas que tenham permissão legítima para consultá-los.',
        'A origem de cada dado (Zepp ou outro dispositivo) será preservada, mesmo quando as informações forem reunidas com as de outros dispositivos.',
      ],
    },
    {
      heading: '2.5. Posso desconectar minha conta?',
      paragraphs: [
        'Sim. Poderei solicitar a desconexão da Zepp/Amazfit a qualquer momento.',
        'A desconexão interromperá o acesso futuro pela integração, mas não significará necessariamente a exclusão automática de dados que já tenham sido importados.',
        'A exclusão dos dados importados poderá ser solicitada por meio de funcionalidade específica, observadas as obrigações legais de conservação eventualmente aplicáveis.',
      ],
    },
    {
      heading: '2.6. O que acontece se eu não autorizar?',
      paragraphs: [
        'A conexão Zepp/Amazfit é opcional.',
        'A recusa não impede a utilização das demais funcionalidades do Panzeri Run que não dependam dessa integração.',
      ],
    },
    {
      heading: '2.7. Minha autorização',
      paragraphs: ['Ao selecionar as categorias desejadas e confirmar a conexão, declaro que:'],
      bullets: [
        'Recebi informações sobre quais dados poderão ser acessados e para quais finalidades.',
        'Compreendo que a disponibilidade dos dados depende das permissões concedidas pela Zepp.',
        'Sei que posso desconectar minha conta e solicitar a exclusão dos dados importados.',
        'Autorizo o tratamento dos dados das categorias selecionadas para as finalidades descritas neste documento, incluindo as finalidades opcionais que eu marcar.',
      ],
    },
  ],
  groups: [
    {
      id: 'account',
      label: 'Dados básicos da conta',
      description: 'Identificador e informações de perfil necessárias para vincular a conta. É o mínimo para a conexão existir e não pode ser desmarcado.',
      required: true,
      categories: ['profile'],
    },
    {
      id: 'activity',
      label: 'Atividades físicas',
      description: 'Corridas e caminhadas: data, distância, duração, ritmo e calorias.',
      required: false,
      categories: ['activity'],
    },
    {
      id: 'sensors',
      label: 'Sensores das atividades',
      description: 'Frequência cardíaca, cadência, altitude e potência registradas durante a atividade, quando disponíveis. Depende de “Atividades físicas”.',
      required: false,
      categories: ['activity_sensors'],
      requires: ['activity'],
    },
    {
      id: 'route',
      label: 'Percursos e GPS',
      description: 'Trajetos e localização das atividades, quando disponíveis. Depende de “Atividades físicas”.',
      required: false,
      categories: ['activity_route'],
      requires: ['activity'],
    },
    {
      id: 'sleep',
      label: 'Sono e recuperação',
      description: 'Duração e períodos do sono, estágios, despertares, cochilos e pontuação.',
      required: false,
      categories: ['sleep'],
    },
  ],
  // Finalidades OBRIGATORIAS descritas no texto (2.2). 'ai_external', 'ai_internal' e qualquer outra NAO estao aqui => nao autorizadas por este consentimento.
  purposes: ['history', 'tracking', 'plan_comparison', 'indicators', 'coach_view'],
  optionalPurposes: [
    {
      id: 'history_backfill',
      label: 'Importar até 30 dias de atividades anteriores à conexão',
      description: 'Permite que o Panzeri Run solicite à Zepp as atividades dos últimos 30 dias, para começar com algum histórico. Só pode ser escolhida agora, ao conectar.',
      external: false,
      changeableAfterConnect: false,
    },
    {
      id: 'ai_external',
      label: 'Análises por IA com fornecedores externos',
      description: 'Permite o envio dos dados das categorias selecionadas, e de informações calculadas a partir deles, a fornecedores externos de inteligência artificial (seção 2.3). Você pode retirar a qualquer momento.',
      external: true,
      changeableAfterConnect: true,
    },
  ],
  acknowledgementText: 'Li as informações acima e autorizo a conexão da minha conta Zepp/Amazfit nas categorias selecionadas.',
  confirmButtonLabel: 'Conectar minha conta Zepp/Amazfit',
};
