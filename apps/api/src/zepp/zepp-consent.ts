import { ConsentCapability } from '../provider-hub/provider-connector';

// Texto de consentimento Zepp/Amazfit — MINUTA FUNCIONAL versao 1.0 (19/10/2026), fornecida pelo treinador. NAO e' documento juridicamente aprovado: antes da
// disponibilizacao geral aos alunos precisa de revisao juridica (LGPD: controlador, contato do titular, retencao, compartilhamentos, demais informacoes
// obrigatorias). Qualquer alteracao de texto/grupos/finalidades muda o hash e EXIGE nova versao: a conexao registra a versao e o hash do que o aluno viu.
//
// O que cada grupo AUTORIZA aqui e' o teto do que o Panzeri Run pode vir a acessar; nada disso esta sendo importado hoje (recebimento de dados desligado
// ate a resposta oficial da Zepp). A restricao por grupo e' aplicada pelo Panzeri Run (ProviderConsentService), porque a Zepp nao tem escopos por categoria.
// Finalidades: a lista abaixo NAO inclui IA, treinamento de modelos nem outros usos — o texto os exclui expressamente.
export const ZEPP_CONSENT: ConsentCapability = {
  version: '1.0',
  dateLabel: '19/10/2026',
  title: 'Autorização para conectar Zepp/Amazfit ao Panzeri Run',
  intro: 'Ao conectar minha conta Zepp/Amazfit ao Panzeri Run, autorizo o aplicativo a acessar e utilizar os dados disponibilizados pela Zepp, dentro das categorias que eu selecionar e das permissões efetivamente concedidas pelo serviço.',
  sections: [
    {
      heading: '2.1. Quais dados poderão ser utilizados?',
      paragraphs: [
        'Conforme as permissões disponíveis e as categorias que eu autorizar, a integração poderá envolver:',
        'Nem todos esses dados estarão necessariamente disponíveis. O acesso dependerá das permissões da Zepp e das categorias autorizadas por mim.',
      ],
      bullets: [
        'Atividade física: passos, distância percorrida, calorias estimadas, duração de corridas e caminhadas.',
        'Detalhes de atividades: informações de percurso e localização GPS, quando disponibilizadas pela Zepp.',
        'Sono e recuperação: duração e períodos do sono, estágios do sono, despertares, pontuação do sono e frequência cardíaca de repouso.',
        'Perfil da conta: identificador da conta Zepp e informações básicas de perfil necessárias à identificação e vinculação da conexão.',
      ],
    },
    {
      heading: '2.2. Para que meus dados serão utilizados?',
      paragraphs: [
        'Os dados autorizados poderão ser utilizados pelo Panzeri Run para:',
        'O uso desses dados em análises por inteligência artificial não está autorizado por este consentimento. Caso essa funcionalidade seja disponibilizada futuramente, suas condições e permissões deverão ser apresentadas separadamente.',
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
      heading: '2.3. Como meus dados serão protegidos?',
      paragraphs: [
        'O Panzeri Run utilizará mecanismos de segurança para proteger a conexão e os dados recebidos.',
        'As credenciais de acesso à Zepp serão armazenadas de forma cifrada. O aplicativo não solicitará minha senha da conta Zepp diretamente.',
        'O acesso aos meus dados deverá ficar limitado às funcionalidades autorizadas e às pessoas que tenham permissão legítima para consultá-los.',
      ],
    },
    {
      heading: '2.4. Posso desconectar minha conta?',
      paragraphs: [
        'Sim. Poderei solicitar a desconexão da Zepp/Amazfit a qualquer momento.',
        'A desconexão interromperá o acesso futuro pela integração, mas não significará necessariamente a exclusão automática de dados que já tenham sido importados.',
        'A exclusão dos dados importados poderá ser solicitada por meio de funcionalidade específica, observadas as obrigações legais de conservação eventualmente aplicáveis.',
      ],
    },
    {
      heading: '2.5. O que acontece se eu não autorizar?',
      paragraphs: [
        'A conexão Zepp/Amazfit é opcional.',
        'A recusa não impede a utilização das demais funcionalidades do Panzeri Run que não dependam dessa integração.',
      ],
    },
    {
      heading: '2.6. Minha autorização',
      paragraphs: ['Ao selecionar as categorias desejadas e confirmar a conexão, declaro que:'],
      bullets: [
        'Recebi informações sobre quais dados poderão ser acessados e para quais finalidades.',
        'Compreendo que a disponibilidade dos dados depende das permissões concedidas pela Zepp.',
        'Sei que posso desconectar minha conta e solicitar a exclusão dos dados importados.',
        'Autorizo o tratamento dos dados das categorias selecionadas para as finalidades descritas neste documento.',
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
      description: 'Passos, corridas, caminhadas, distância, duração e calorias.',
      required: false,
      categories: ['activity'],
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
      description: 'Estágios e duração do sono, despertares e frequência cardíaca de repouso.',
      required: false,
      categories: ['sleep', 'resting_heart_rate'],
    },
  ],
  // Finalidades descritas no texto (2.2). 'ai' e qualquer outra NAO estao aqui => nao autorizadas.
  purposes: ['history', 'tracking', 'plan_comparison', 'indicators', 'coach_view'],
  acknowledgementText: 'Li as informações acima e autorizo a conexão da minha conta Zepp/Amazfit nas categorias selecionadas.',
  confirmButtonLabel: 'Conectar minha conta Zepp/Amazfit',
};
