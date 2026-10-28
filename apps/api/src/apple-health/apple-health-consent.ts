import { ConsentCapability } from '../provider-hub/provider-connector';

// Autorizacoes do Apple Saude (iPhone) — versao 1.0 (28/10/2026). Mesmo modelo do Health Connect (grupos independentes, nada marcado, texto versionado com hash, revogacao na hora e auditada),
// adaptado ao que a integracao HealthKit REALMENTE faz hoje: treinos de corrida e as medidas guardadas junto deles. NAO ha dados diarios (sono, HRV, FC de repouso, passos do dia...): estes
// grupos so' existirao quando forem implementados e exigirao nova versao. A autorizacao do iOS (folha do HealthKit, no aparelho) e este consentimento (registrado no servidor) sao coisas
// DIFERENTES: o primeiro permite ao app LER o dado no aparelho; este autoriza o Panzeri Run a GUARDAR e USAR o dado que chega. O servidor so' guarda o que este registro autoriza.
// ATENCAO: o documento COMPLETO (Politica de Privacidade e Termos) continua pendente de revisao por advogado; estes textos NAO substituem essa revisao. Qualquer alteracao de texto, grupo ou
// finalidade muda o hash e EXIGE nova versao.
//
// Compatibilidade (aplicativo ja publicado): o app antigo importa treinos basicos (inicio, fim, duracao, distancia) sem este fluxo. Enquanto NAO existir registro de consentimento da aluna,
// a importacao basica continua aceita como antes; FC, passos, potencia, elevacao e percurso so' sao aceitos com o grupo correspondente autorizado AQUI. Quem retirar a autorizacao deixa de poder importar.
export const APPLE_HEALTH_PROVIDER_ID = 'apple_health';

export const APPLE_HEALTH_CONSENT: ConsentCapability = {
  version: '1.0',
  dateLabel: '28/10/2026',
  title: 'Compartilhe seus treinos do app Saúde (iPhone)',
  intro: 'O app Saúde do iPhone guarda os treinos registrados pelo Apple Watch e por outros aplicativos. Escolha o que você quer compartilhar com o Panzeri Run.',
  sections: [
    {
      heading: null,
      paragraphs: [
        'Com sua autorização, o Panzeri Run poderá receber os seus treinos de corrida do app Saúde (até os 200 mais recentes a cada sincronização): tipo, data e horário, duração, distância, velocidade média, calorias ativas, se foi em ambiente fechado e o nome do aplicativo e do aparelho que registraram o treino, e, se você marcar, também as medidas guardadas junto do treino e o percurso GPS.',
        'Essas informações serão utilizadas para mostrar suas atividades, comparar os treinos planejados com os realizados, acompanhar sua evolução e personalizar seu treinamento. Seu treinador também verá esses dados. As atividades importadas seguem o mesmo uso das demais atividades de serviços conectados, inclusive o contexto de inteligência artificial descrito na Política de Privacidade; o percurso GPS não é enviado à inteligência artificial.',
      ],
    },
    {
      heading: 'Duas autorizações diferentes',
      paragraphs: [
        'O iPhone pede, em uma tela própria, permissão para o aplicativo LER esses dados no aparelho. Esta tela é outra: ela registra, no Panzeri Run, o que você autoriza guardar e usar. O Panzeri Run só guarda o que você marcar aqui, mesmo que o iPhone permita ler mais.',
        'O iPhone não informa ao aplicativo o que foi negado: se um dado não aparece, pode ser que ele não exista no seu treino ou que a leitura não tenha sido permitida.',
      ],
    },
    {
      heading: 'O que esta autorização não inclui',
      paragraphs: [
        'Esta versão não importa sono, variabilidade da frequência cardíaca (HRV), frequência cardíaca de repouso, passos do dia, peso nem outros dados do app Saúde que não estejam ligados a um treino de corrida. O Panzeri Run não grava nada no app Saúde.',
        'A sincronização acontece quando você toca em “Continuar e sincronizar”. Não há envio automático em segundo plano.',
      ],
    },
    {
      heading: 'Como você controla',
      paragraphs: [
        'Você pode consultar e retirar cada autorização quando quiser, no Panzeri Run (Dispositivos e integrações → Apple Watch) e também nos Ajustes do iPhone (Saúde → Acesso a dados e dispositivos → Panzeri Run). Ao retirar o grupo de percurso, os percursos já guardados são apagados; ao retirar o grupo de medidas, as medidas já guardadas são apagadas. Os detalhes estão na Política de Privacidade.',
      ],
    },
  ],
  groups: [
    { id: 'workouts', label: 'Treinos de corrida', description: 'Tipo, data e horário, duração, distância, velocidade média, calorias ativas, ambiente (fechado ou aberto) e origem do registro, dos treinos de corrida do app Saúde.', required: false, categories: ['activity'] },
    { id: 'sensors', label: 'Frequência cardíaca, passos, potência e elevação', description: 'Medidas guardadas junto do treino quando o seu relógio ou aplicativo as registrou: frequência cardíaca média e máxima, passos (base da cadência), potência, passada, tempo de contato com o solo, oscilação vertical e ganho de elevação. Depende de “Treinos de corrida”.', required: false, categories: ['activity_sensors'], requires: ['workouts'] },
    { id: 'route', label: 'Percurso GPS', description: 'Trajeto e localização do treino, quando o treino tiver percurso. Dado sensível. Depende de “Treinos de corrida”.', required: false, categories: ['activity_route'], requires: ['workouts'] },
  ],
  // Finalidades OBRIGATORIAS descritas no texto (a lista e' o teto).
  purposes: ['history', 'tracking', 'plan_comparison', 'indicators', 'coach_view'],
  // Nenhuma finalidade opcional nesta versao (a analise por IA dos dados do Apple Saude nao tem autorizacao propria: segue o uso das demais atividades, conforme o texto).
  optionalPurposes: [],
  acknowledgementText: 'Autorizo o Panzeri Run a guardar e utilizar os dados do app Saúde que eu selecionar, para acompanhamento e gestão do meu treinamento.',
  confirmButtonLabel: 'Salvar minhas autorizações',
};

export const APPLE_HEALTH_CATEGORIES: readonly string[] = [...new Set(APPLE_HEALTH_CONSENT.groups.flatMap((g) => g.categories as readonly string[]))];
