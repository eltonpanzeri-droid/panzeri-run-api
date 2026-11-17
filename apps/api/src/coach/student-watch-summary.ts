// Resumo "o que a aluna recebe no relogio e o que ela devolve" para a tela Treino da semana do painel (17/11/2026, pedido de Elton, caso Volnei). Independe do relogio: cada integracao conectada
// diz o que faz. Quem NAO recebe treino por esse caminho (Polar, Wahoo, Strava, Health Connect) so' devolve atividades ao Panzeri Run; quem recebe (Apple Watch, Zepp, COROS, Garmin) mostra quantos
// dos treinos de corrida da semana ja' foram enviados. Funcao pura sobre dados ja' lidos (testavel sem banco).

export interface WatchProviderInfo { name: string; deliveryProvider: string | null; how: string; explain: string }

// deliveryProvider = valor gravado em WorkoutDelivery.provider; null = o Panzeri Run nao envia treino por esse caminho.
export const WATCH_PROVIDERS: Record<string, WatchProviderInfo> = {
  polar: { name: 'Polar', deliveryProvider: null, how: 'não recebe treino no relógio', explain: 'A Polar não aceita receber treino do Panzeri Run. A aluna vê o treino no Panzeri Run, treina com o relógio normalmente e a Polar devolve a atividade depois, que o Panzeri Run usa para conferir o que foi feito.' },
  wahoo: { name: 'Wahoo', deliveryProvider: null, how: 'não recebe treino no relógio', explain: 'A Wahoo não aceita receber treino do Panzeri Run. A aluna vê o treino no Panzeri Run, grava a atividade com o computador de bordo ou relógio e a Wahoo devolve a atividade depois.' },
  strava: { name: 'Strava', deliveryProvider: null, how: 'só devolve as atividades; não recebe treino', explain: 'O Strava só devolve as atividades que a aluna grava (por qualquer relógio). Não recebe treino e não mostra de qual aparelho veio o treino.' },
  health_connect: { name: 'Health Connect (Android)', deliveryProvider: null, how: 'só lê dados de saúde e atividades; não recebe treino no relógio', explain: 'O Health Connect (Android) é um depósito de dados do celular: o Panzeri Run lê as atividades e os dados de saúde que o relógio dela gravou lá. Não envia treino ao relógio; a aluna vê o treino no Panzeri Run.' },
  apple_health: { name: 'Apple Watch / Apple Saúde', deliveryProvider: 'apple_workoutkit', how: 'recebe treino no relógio, enviado pelo iPhone com o Panzeri Run aberto', explain: 'O treino é enviado pelo iPhone da aluna, direto para o Apple Watch, e só segue quando ela abre o Panzeri Run no iPhone (depois de autorizar uma vez o envio no cartão Apple Watch). As atividades voltam pelo app Saúde.' },
  zepp: { name: 'Zepp / Amazfit', deliveryProvider: 'zepp_workout_v2', how: 'recebe treino no relógio, enviado pelo servidor', explain: 'O servidor do Panzeri Run publica os treinos na conta Zepp da aluna e eles aparecem no relógio Amazfit depois que o aplicativo Zepp sincroniza. A aluna precisa ter autorizado o envio de treinos. As atividades voltam pela Zepp.' },
  coros: { name: 'COROS', deliveryProvider: 'coros_mcp', how: 'recebe treino no relógio, enviado pelo servidor', explain: 'O servidor do Panzeri Run envia os treinos para o calendário COROS da aluna, e eles aparecem no relógio depois que o aplicativo COROS sincroniza. A aluna precisa ter autorizado o envio de treinos. As atividades voltam pela COROS.' },
  garmin: { name: 'Garmin', deliveryProvider: 'garmin_training', how: 'recebe treino no relógio, enviado pelo servidor', explain: 'O servidor do Panzeri Run envia os treinos para a conta Garmin da aluna, e eles aparecem no relógio depois que o Garmin Connect sincroniza. A aluna precisa ter autorizado o envio de treinos. As atividades voltam pela Garmin.' },
};

export interface WatchSummaryRaw {
  // integracoes com conexao ativa (ou com dados recebidos mesmo sem registro de conexao)
  connected: string[];
  // atividades recebidas por provedor: nesta semana, no total e a data da ultima
  received: Record<string, { week: number; total: number; lastAt: Date | null }>;
  // programa ativo da semana: treinos de corrida prescritos
  weekRuns: number;
  // envios por WorkoutDelivery.provider: concluidos para os treinos desta semana, ultimo envio e falhas dos ultimos 7 dias
  deliveries: Record<string, { sentWeek: number; lastSentAt: Date | null; failures7d: number }>;
}

export interface WatchDeviceLine {
  provider: string;
  name: string;
  receivesWorkouts: boolean;
  // enviados / total (so' quando recebe treino)
  sent: number | null;
  failures7d: number;
  explain: string;
  receivedWeek: number;
  receivedTotal: number;
  text: string;
}

export interface WatchSummaryResult { weekRuns: number; devices: WatchDeviceLine[]; headline: string }

const dmy = (date: Date) => `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function buildWatchSummary(raw: WatchSummaryRaw): WatchSummaryResult {
  const order = Object.keys(WATCH_PROVIDERS);
  const devices: WatchDeviceLine[] = order.filter((id) => raw.connected.includes(id)).map((id) => {
    const info = WATCH_PROVIDERS[id];
    const received = raw.received[id] ?? { week: 0, total: 0, lastAt: null };
    const back = received.total === 0
      ? 'Ainda não enviou nenhuma atividade ao Panzeri Run.'
      : `Já enviou ao Panzeri Run ${received.week} ${plural(received.week, 'treino', 'treinos')} nesta semana (${received.total} no total${received.lastAt ? `, o último em ${dmy(received.lastAt)}` : ''}).`;
    if (!info.deliveryProvider) {
      return { provider: id, name: info.name, receivesWorkouts: false, sent: null, failures7d: 0, explain: info.explain, receivedWeek: received.week, receivedTotal: received.total, text: `Usa ${info.name}: ${info.how}. ${back}` };
    }
    const delivery = raw.deliveries[info.deliveryProvider] ?? { sentWeek: 0, lastSentAt: null, failures7d: 0 };
    const sentPart = raw.weekRuns === 0
      ? 'Não há treino de corrida nesta semana para enviar.'
      : `${Math.min(delivery.sentWeek, raw.weekRuns)} de ${raw.weekRuns} ${plural(raw.weekRuns, 'treino de corrida da semana foi enviado', 'treinos de corrida da semana foram enviados')} ao relógio${delivery.lastSentAt ? ` (último envio em ${dmy(delivery.lastSentAt)})` : ''}.`;
    const failPart = delivery.failures7d > 0 ? ` ${delivery.failures7d} ${plural(delivery.failures7d, 'falha', 'falhas')} de envio nos últimos 7 dias: veja Integrações.` : '';
    return { provider: id, name: info.name, receivesWorkouts: true, sent: delivery.sentWeek, failures7d: delivery.failures7d, explain: info.explain, receivedWeek: received.week, receivedTotal: received.total, text: `Usa ${info.name}: ${info.how}. ${sentPart}${failPart} ${back}` };
  });
  const headline = devices.length === 0
    ? 'Nenhuma integração conectada: a aluna registra os treinos à mão e não recebe treino no relógio pelo Panzeri Run.'
    : devices.some((d) => d.receivesWorkouts)
      ? 'A aluna tem integração que recebe treino no relógio.'
      : 'Nenhuma das integrações conectadas recebe treino no relógio: ela vê o treino no Panzeri Run e o relógio só devolve as atividades.';
  return { weekRuns: raw.weekRuns, devices, headline };
}
