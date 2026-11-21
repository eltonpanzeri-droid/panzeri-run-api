import { ConsentCapability } from '../provider-hub/provider-connector';
import { OWN_RECORDING_PROVIDER_ID } from '../activity-execution/physical-canonical';

// Autorizacoes para GRAVAR treinos no proprio Panzeri Run ("Iniciar treino", celular) — versao 1.0 de 21/11/2026. RASCUNHO redigido por Claude como revisor juridico a pedido de Elton enquanto nao ha advogado;
// o texto da Politica de Privacidade e dos Termos continua pendente de advogado. Qualquer alteracao de texto, grupo ou finalidade muda o hash e EXIGE nova versao (quem ja' autorizou reconfirma).
//
// Decisoes de Elton (21/11/2026): (1) o GPS so' grava durante o treino que a aluna inicia, tambem com a tela bloqueada ou com outro aplicativo aberto, e nunca fora do treino (nada da rotina do dia a dia);
// (2) a IA usa os dados autorizados, incluindo o percurso (premissa de 01/11), com desligamento posterior pela aluna; (3) a finalidade inclui mapa, parciais, comparacao com o programa de treino e os cartoes
// de compartilhamento que a aluna escolher publicar. O celular nao registra frequencia cardiaca: nao ha grupo de sensores.
//
// A permissao de localizacao do iPhone/Android (pedida ao iniciar o treino) e este consentimento (registrado no servidor) sao coisas DIFERENTES: a primeira deixa o aplicativo LER o GPS; este autoriza o
// Panzeri Run a GUARDAR e USAR o que chega. O servidor so' guarda o que este registro autoriza.
export const PANZERI_RUN_PROVIDER_ID = OWN_RECORDING_PROVIDER_ID; // 'panzeri_run' (valor unico, definido junto da escolha da observacao canonica)

export const RUN_RECORDING_CONSENT: ConsentCapability = {
  version: '1.0',
  dateLabel: '21/11/2026',
  title: 'Gravar seus treinos no Panzeri Run',
  intro: 'Com o Iniciar treino, o Panzeri Run grava a sua corrida pelo celular e guarda o resultado. Escolha o que você quer compartilhar.',
  sections: [
    {
      heading: null,
      paragraphs: [
        'Ao autorizar, você permite que o Panzeri Run guarde e use os treinos que você gravar no próprio Panzeri Run: data e horário, duração, distância, ritmo e velocidade, e, se você marcar “Percurso GPS”, o trajeto e a localização do treino, com a altitude. Usamos esses dados para acompanhar e gerenciar o seu treinamento, comparar o que você fez com o seu programa de treino, mostrar o mapa e os parciais do treino e gerar os cartões de compartilhamento que você escolher publicar. O seu treinador também pode ver esses treinos.',
        'Inteligência artificial: os dados que você autorizar, incluindo o percurso GPS, são enviados à Anthropic, fornecedora da tecnologia de inteligência artificial usada pelo Panzeri Run (o Atlas), o que pode envolver transferência internacional de dados, conforme a Política de Privacidade. Você pode desligar o uso dos treinos gravados no Panzeri Run pela inteligência artificial a qualquer momento.',
        'A localização só é gravada durante o treino: o Panzeri Run só começa a gravar depois que você toca em “Iniciar treino” e para quando você encerra. Enquanto o treino estiver em andamento, a gravação continua mesmo com a tela bloqueada ou com outro aplicativo aberto. Fora do treino, o Panzeri Run não coleta a sua localização. O iPhone e o Android também pedem, na primeira vez, a permissão de localização; esta tela é outra e registra o que você autoriza o Panzeri Run a guardar e usar.',
        'Você pode mudar ou retirar cada autorização quando quiser, nas configurações de privacidade do Panzeri Run. Ao retirar um grupo, os dados daquele grupo já guardados são apagados, e você também pode pedir a exclusão dos treinos gravados no Panzeri Run. Os detalhes estão na Política de Privacidade.',
      ],
    },
  ],
  groups: [
    { id: 'activity', label: 'Treinos gravados no Panzeri Run', description: 'Data e horário, duração (tempo da atividade, do cronômetro e em movimento), distância, ritmo e velocidade dos treinos que você gravar no Panzeri Run.', required: false, categories: ['activity'] },
    { id: 'route', label: 'Percurso GPS', description: 'Trajeto e localização do treino, com a altitude, gravados pelo GPS do celular só durante o treino. Dado sensível. Depende de “Treinos gravados no Panzeri Run”.', required: false, categories: ['activity_route'], requires: ['activity'] },
  ],
  // Finalidades OBRIGATORIAS descritas no texto (a lista e' o teto).
  purposes: ['history', 'tracking', 'plan_comparison', 'indicators', 'coach_view', 'map_and_terrain'],
  optionalPurposes: [
    {
      id: 'ai_external',
      label: 'Usar os treinos gravados no Panzeri Run nas análises com inteligência artificial (Atlas)',
      description: 'Permite usar os treinos que você gravar no Panzeri Run e autorizou, incluindo o percurso GPS quando autorizado, em análises personalizadas com o Atlas, o que envolve o envio dos dados necessários à Anthropic. Já faz parte desta autorização e pode ser desligada a qualquer momento.',
      external: true,
      changeableAfterConnect: true,
    },
  ],
  acknowledgementText: 'Autorizo o Panzeri Run a guardar e utilizar os treinos que eu gravar no Panzeri Run, para acompanhamento e gestão do meu treinamento, incluindo o mapa e a análise do meu percurso, os cartões de compartilhamento, as análises com inteligência artificial e o envio dos dados necessários à Anthropic, como descrito acima. Sei que a localização só é gravada durante o treino e que posso retirar esta autorização quando quiser.',
  confirmButtonLabel: 'Salvar minhas autorizações',
};

export const RUN_RECORDING_CATEGORIES = ['activity', 'activity_route'] as const;
