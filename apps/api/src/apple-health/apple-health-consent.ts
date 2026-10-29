import { ConsentCapability } from '../provider-hub/provider-connector';

// Autorizacoes do Apple Saude (iPhone) — versao 2.1 (29/10/2026; a 2.0 ainda nao tinha chegado a nenhum aluno em aplicativo publicado). A 2.1 passou a NOMEAR o fornecedor externo de IA e a transferencia
// internacional na propria tela de autorizacao (exigencia de transparencia da App Store para dados compartilhados com IA de terceiros), sem criar uma autorizacao de IA separada. Mesmo modelo do Health Connect (grupos independentes, nada marcado, texto versionado com hash, revogacao na hora e auditada).
// A 1.0 (28/10) cobria so' treinos de corrida, medidas do treino e percurso; a 2.0 acrescenta TODA a saude do dia a dia que o HealthKit entrega (decisao do Elton: coletar tudo o que o aluno
// autorizar). A autorizacao do iOS (folha do HealthKit, no aparelho) e este consentimento (registrado no servidor) sao coisas DIFERENTES: o primeiro permite ao app LER o dado no aparelho; este
// autoriza o Panzeri Run a GUARDAR e USAR o dado que chega. O servidor so' guarda o que este registro autoriza.
// ATENCAO: o documento COMPLETO (Politica de Privacidade e Termos) continua pendente de revisao por advogado; estes textos NAO substituem essa revisao. Qualquer alteracao de texto, grupo ou
// finalidade muda o hash e EXIGE nova versao.
//
// Compatibilidade (aplicativo ja publicado): o app antigo importa treinos basicos (inicio, fim, duracao, distancia) sem este fluxo. Enquanto NAO existir registro de consentimento da aluna,
// a importacao basica continua aceita como antes; tudo o mais (medidas de sensor, percurso e saude do dia a dia) so' e' aceito com o grupo correspondente autorizado AQUI. Quem retirar a autorizacao deixa de poder importar.
//
// IA: nao ha finalidade propria de IA (decisao de produto de 28/10). Os dados de saude autorizados podem compor o contexto das analises como os das demais fontes; o percurso GPS, a pressao arterial,
// a glicemia e o ciclo menstrual NAO sao enviados a IA (ver ai-data-eligibility.service.ts: nao fazem parte das categorias de IA). Nenhuma analise automatica substitui avaliacao medica.
export const APPLE_HEALTH_PROVIDER_ID = 'apple_health';

export const APPLE_HEALTH_CONSENT: ConsentCapability = {
  version: '2.1',
  dateLabel: '29/10/2026',
  title: 'Compartilhe seus dados do app Saúde (iPhone)',
  intro: 'O app Saúde do iPhone guarda os treinos e as medições do Apple Watch, do iPhone e de outros aplicativos. Escolha o que você quer compartilhar com o Panzeri Run.',
  sections: [
    {
      heading: null,
      paragraphs: [
        'Com sua autorização, o Panzeri Run poderá receber do app Saúde, dos últimos 3 anos e depois a cada sincronização: os seus treinos (tipo, data e horário, duração, distância, velocidade, calorias, ambiente e o aplicativo e o aparelho que registraram), as medidas guardadas junto do treino e o percurso GPS, e a sua saúde do dia a dia — atividade (passos, distância, escadas, calorias, minutos de exercício e de pé), sono, frequência cardíaca, variabilidade da frequência cardíaca (HRV), VO₂ máximo, peso e composição corporal, oxigenação, temperatura, respiração, mobilidade, hábitos (luz do dia, atenção plena, ruído), nutrição e hidratação, pressão arterial, glicemia e ciclo menstrual.',
        'Essas informações serão utilizadas para mostrar sua evolução, comparar os treinos planejados com os realizados, entender como você se recupera e personalizar seu treinamento. Seu treinador também verá esses dados. Com sua autorização, o Panzeri Run poderá usar os dados de atividade física, saúde e recuperação que você escolher compartilhar para acompanhar sua evolução, analisar seus treinos e oferecer orientações personalizadas com auxílio de inteligência artificial. Seus dados individuais não serão vendidos nem divulgados publicamente, e não são usados para publicidade. Nada disso substitui avaliação médica.',
        'Sobre a inteligência artificial: para gerar essas análises, os dados necessários dos grupos que você autorizar são enviados à Anthropic, empresa fornecedora da tecnologia de inteligência artificial usada pelo Panzeri Run, o que pode envolver transferência internacional de dados, conforme a Política de Privacidade. O percurso GPS, a pressão arterial, a glicemia e o ciclo menstrual não são enviados à inteligência artificial. Se você retirar um grupo, os dados dele deixam de ser usados nas análises seguintes. As análises automáticas podem apresentar limitações.',
      ],
    },
    {
      heading: 'Duas autorizações diferentes',
      paragraphs: [
        'O iPhone pede, em uma tela própria, permissão para o aplicativo LER esses dados no aparelho. Esta tela é outra: ela registra, no Panzeri Run, o que você autoriza guardar e usar. O Panzeri Run só guarda o que você marcar aqui, mesmo que o iPhone permita ler mais.',
        'O iPhone não informa ao aplicativo o que foi negado: se um dado não aparece, pode ser que ele não exista no seu app Saúde ou que a leitura não tenha sido permitida. Nem todo dado existe para todo aparelho: depende do seu Apple Watch, do iPhone e dos aplicativos que você usa. A origem de cada dado é preservada.',
      ],
    },
    {
      heading: 'O que esta autorização não inclui',
      paragraphs: [
        'O Panzeri Run não grava nada no app Saúde e não lê dados de outras pessoas. Esta versão também não lê dados cadastrais do app Saúde (como data de nascimento, sexo biológico e tipo sanguíneo), registros clínicos importados de hospitais, eletrocardiograma completo, medicamentos nem receitas de óculos.',
        'A sincronização acontece quando você toca em “Continuar e sincronizar”. Não há envio automático em segundo plano.',
      ],
    },
    {
      heading: 'Como você controla',
      paragraphs: [
        'Você pode consultar e retirar cada autorização quando quiser, no Panzeri Run (Dispositivos e integrações → Apple Watch) e também nos Ajustes do iPhone (Saúde → Acesso a dados e dispositivos → Panzeri Run). Ao retirar um grupo, os dados daquele grupo já guardados são apagados (percursos, medidas do treino e dados de saúde do dia a dia); os treinos importados continuam. Os detalhes estão na Política de Privacidade.',
      ],
    },
  ],
  groups: [
    { id: 'workouts', label: 'Treinos', description: 'Todos os seus treinos do app Saúde (corrida, caminhada, ciclismo, musculação, natação e demais): tipo, data e horário, duração, distância, velocidade média, calorias ativas, ambiente (fechado ou aberto) e origem do registro.', required: false, categories: ['activity'] },
    { id: 'sensors', label: 'Frequência cardíaca, passos, potência e elevação do treino', description: 'Medidas guardadas junto do treino quando o seu relógio ou aplicativo as registrou: frequência cardíaca média e máxima, passos (base da cadência), potência, passada, tempo de contato com o solo, oscilação vertical e ganho de elevação. Depende de “Treinos”.', required: false, categories: ['activity_sensors'], requires: ['workouts'] },
    { id: 'route', label: 'Percurso GPS', description: 'Trajeto e localização do treino, quando o treino tiver percurso. Dado sensível. Depende de “Treinos”.', required: false, categories: ['activity_route'], requires: ['workouts'] },
    { id: 'daily', label: 'Atividade do dia', description: 'Passos, distância, escadas subidas, calorias ativas e basais, minutos de exercício e minutos de pé, dia a dia.', required: false, categories: ['daily_activity'] },
    { id: 'sleep', label: 'Sono', description: 'Duração, etapas (acordado, REM, básico, profundo) e horários do sono.', required: false, categories: ['sleep'] },
    { id: 'heart', label: 'Frequência cardíaca do dia', description: 'Frequência cardíaca de repouso, média, mínima e máxima do dia, média caminhando, recuperação após o exercício e avisos de frequência alta, baixa ou ritmo irregular.', required: false, categories: ['resting_heart_rate', 'heart_rate'] },
    { id: 'hrv', label: 'Variabilidade da frequência cardíaca (HRV)', description: 'HRV medida pelo Apple Watch (SDNN, em milissegundos), dia a dia.', required: false, categories: ['hrv'] },
    { id: 'fitness', label: 'VO₂ máximo', description: 'Estimativa de capacidade aeróbica feita pelo Apple Watch ou aplicativo.', required: false, categories: ['vo2_max'] },
    { id: 'body', label: 'Peso e composição corporal', description: 'Peso, altura, IMC, percentual de gordura, massa magra e circunferência da cintura, quando registrados.', required: false, categories: ['body_composition'] },
    { id: 'vitals', label: 'Oxigenação, temperatura e respiração', description: 'Saturação de oxigênio, temperatura corporal e do pulso durante o sono e frequência respiratória, quando medidas.', required: false, categories: ['pulse_ox', 'skin_temperature', 'respiratory_rate'] },
    { id: 'mobility', label: 'Mobilidade', description: 'Velocidade e comprimento do passo ao caminhar, assimetria, apoio duplo, velocidade em escadas, estabilidade ao caminhar e teste de caminhada de 6 minutos.', required: false, categories: ['mobility'] },
    { id: 'lifestyle', label: 'Hábitos do dia', description: 'Tempo à luz do dia, minutos de atenção plena e exposição a ruído do ambiente e de fones.', required: false, categories: ['lifestyle_load'] },
    { id: 'nutrition', label: 'Nutrição e hidratação', description: 'Calorias consumidas, proteínas, carboidratos, gorduras, fibras, açúcares, sódio, cafeína e água, quando registrados em algum aplicativo.', required: false, categories: ['nutrition'] },
    { id: 'clinical', label: 'Pressão arterial e glicemia', description: 'Pressão arterial e glicose no sangue, quando registradas. Dado sensível; não é enviado à inteligência artificial.', required: false, categories: ['clinical_vitals'] },
    { id: 'cycle', label: 'Ciclo menstrual', description: 'Fluxo menstrual, sangramentos fora do período, teste de ovulação, muco cervical e temperatura basal, quando registrados. Dado sensível; não é enviado à inteligência artificial.', required: false, categories: ['menstrual_cycle'] },
  ],
  // Finalidades OBRIGATORIAS descritas no texto (a lista e' o teto).
  purposes: ['history', 'tracking', 'plan_comparison', 'indicators', 'coach_view'],
  // Nenhuma finalidade opcional (a analise por IA dos dados do Apple Saude nao tem autorizacao propria: segue o uso das demais fontes, conforme o texto).
  optionalPurposes: [],
  acknowledgementText: 'Autorizo o Panzeri Run a guardar e utilizar os dados do app Saúde que eu selecionar, para acompanhamento e gestão do meu treinamento e da minha recuperação, incluindo análises com inteligência artificial e o envio dos dados necessários à Anthropic, como descrito acima.',
  confirmButtonLabel: 'Salvar minhas autorizações',
};

export const APPLE_HEALTH_CATEGORIES: readonly string[] = [...new Set(APPLE_HEALTH_CONSENT.groups.flatMap((g) => g.categories as readonly string[]))];
