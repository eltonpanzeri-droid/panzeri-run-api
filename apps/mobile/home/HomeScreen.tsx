import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { saoPauloDateString } from '../src/weekWindow';
import { FeelingDomain, FEELING_DOMAINS, SnapshotLite, rangeChip, trendChip, trendSentence } from './insights';
import {
  HomeBorder,
  HomeColors,
  HomeRadius,
  HomeShadow,
  HomeSpace,
  HomeTypography,
  MedalGrauColors,
  formatMetric,
} from './homeTheme';
import {
  HomeAlternativeLite,
  HomeSessionLite,
  TodaySessionState,
  WeekCellTarget,
  buildTrajectoryEvents,
  buildWeekDayCells,
  daysUntil,
  formatShortDate,
  pickTodaySession,
  UnlockedMedalLite,
} from './homeLogic';

// Nova Home do aluno (30/09/2026, ordem fechada). Consumidora pura das fontes canônicas já
// existentes: GET /training-plans/current (sessão/semana), GET /me/evolution/overview (volume/
// aderência), GET /me/observations/:variableId (sono/fadiga/motivação/RPE — endpoint novo, mas
// mesma leitura canônica já usada pelo painel do treinador), GET /me/medals (medalhas), GET
// /me/target-races (prova-alvo). NENHUM cálculo é refeito aqui — só seleção/formatação.
//
// URL duplicada de propósito (não extraída de App.tsx pra evitar qualquer risco de import
// circular ou de mexer nos ~100 usos existentes de API_URL no arquivo principal).
const API_URL = Platform.OS === 'web' ? '/api' : 'https://agenteselton-panzeri-run-api.hbljgk.easypanel.host';

interface PlanLite {
  startDate: string;
  endDate: string | null;
  hasSubscriptionAccess?: boolean;
  locked?: boolean;
  sessions: HomeSessionLite[];
  alternativeActivities?: HomeAlternativeLite[];
}

interface WeeklyVolumeLite {
  weekStart: string;
  sessoesPrescritas: number;
  sessoesFeitas: number;
  sessoesNaoFeitas: number;
  adherencePercent: number | null;
  coveragePercent: number;
  kmPercorridos: number | null;
  kmPrescritos: number | null;
  kmExtras: number | null;
}

interface EvolutionOverviewLite {
  recentWeeks: WeeklyVolumeLite[];
  totalWeeksWithPlan: number;
}

// Mesmo shape do motor longitudinal (ver insights.ts) — um unico tipo para Home e telas de dominio.
type VariableSnapshotLite = SnapshotLite;

interface NextUpMedalLite {
  code: string;
  category: string;
  name: string;
  description: string;
  grau: string;
  threshold: number | null;
  unit: string | null;
  currentValue: number | null;
  recommendedAsNextGoal: boolean | null;
}

interface MedalsSummaryLite {
  unlocked: UnlockedMedalLite[];
  progress: NextUpMedalLite[];
}

interface TargetRaceLite {
  id: string;
  name: string;
  raceDate: string;
  distanceKm: number;
  status: string;
  priority: string;
}

async function fetchJson<T>(url: string, accessToken: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function HomeScreen({
  accessToken,
  userName,
  onOpenWeek,
  onOpenWeekTarget,
  onOpenHistory,
  onOpenProgress,
  onOpenFeeling,
  onOpenMedalsAll,
  onOpenTargetRace,
}: {
  accessToken: string;
  userName: string;
  onOpenWeek: () => void;
  // Bolinha = treino/atividade especifica daquele dia (abre a semana ja' expandida nele).
  onOpenWeekTarget: (target: NonNullable<WeekCellTarget>) => void;
  // Calendario completo ja' existente (aba 'history') — nunca substituido pelo toque na bolinha.
  onOpenHistory: () => void;
  onOpenProgress: () => void;
  // Tela de detalhe de cada dominio de "Como voce esta".
  onOpenFeeling: (domain: FeelingDomain) => void;
  onOpenMedalsAll: () => void;
  onOpenTargetRace: () => void;
}) {
  const todayIso = useMemo(() => saoPauloDateString(new Date()), []);

  const [plan, setPlan] = useState<PlanLite | null>(null);
  const [planLoading, setPlanLoading] = useState(true);
  const [planError, setPlanError] = useState(false);

  const [evolution, setEvolution] = useState<EvolutionOverviewLite | null>(null);
  const [evolutionLoading, setEvolutionLoading] = useState(true);
  const [evolutionError, setEvolutionError] = useState(false);

  const [feelings, setFeelings] = useState<Record<string, VariableSnapshotLite | null>>({});
  const [feelingsLoading, setFeelingsLoading] = useState(true);

  const [medals, setMedals] = useState<MedalsSummaryLite | null>(null);
  const [medalsLoading, setMedalsLoading] = useState(true);
  const [medalsError, setMedalsError] = useState(false);

  const [targetRaces, setTargetRaces] = useState<TargetRaceLite[] | null>(null);
  const [targetRacesLoading, setTargetRacesLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const data = await fetchJson<PlanLite>(`${API_URL}/training-plans/current`, accessToken);
      if (!alive) return;
      if (!data) setPlanError(true);
      setPlan(data);
      setPlanLoading(false);
    })();
    return () => { alive = false; };
  }, [accessToken]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const data = await fetchJson<EvolutionOverviewLite>(`${API_URL}/me/evolution/overview?recentWeeks=8`, accessToken);
      if (!alive) return;
      if (!data) setEvolutionError(true);
      setEvolution(data);
      setEvolutionLoading(false);
    })();
    return () => { alive = false; };
  }, [accessToken]);

  useEffect(() => {
    let alive = true;
    const variables = Object.values(FEELING_DOMAINS).map((d) => d.primary);
    (async () => {
      const results = await Promise.all(variables.map((v) => fetchJson<VariableSnapshotLite>(`${API_URL}/me/observations/${v}`, accessToken)));
      if (!alive) return;
      const map: Record<string, VariableSnapshotLite | null> = {};
      variables.forEach((v, i) => { map[v] = results[i]; });
      setFeelings(map);
      setFeelingsLoading(false);
    })();
    return () => { alive = false; };
  }, [accessToken]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const data = await fetchJson<MedalsSummaryLite>(`${API_URL}/me/medals`, accessToken);
      if (!alive) return;
      if (!data) setMedalsError(true);
      setMedals(data);
      setMedalsLoading(false);
    })();
    return () => { alive = false; };
  }, [accessToken]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const data = await fetchJson<TargetRaceLite[]>(`${API_URL}/me/target-races`, accessToken);
      if (!alive) return;
      setTargetRaces(data);
      setTargetRacesLoading(false);
    })();
    return () => { alive = false; };
  }, [accessToken]);

  const today = pickTodaySession(plan?.sessions ?? [], todayIso);

  const currentWeekVolume = useMemo(() => {
    if (!plan || !evolution) return null;
    const weekStartIso = plan.startDate.slice(0, 10);
    return evolution.recentWeeks.find((w) => w.weekStart === weekStartIso) ?? null;
  }, [plan, evolution]);

  const weekIsoDates = useMemo(() => {
    if (!plan) return [];
    const start = new Date(plan.startDate.slice(0, 10) + 'T00:00:00Z');
    return Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10));
  }, [plan]);

  const weekDayCells = useMemo(() => buildWeekDayCells(weekIsoDates, plan?.sessions ?? [], todayIso, plan?.alternativeActivities ?? []), [weekIsoDates, plan, todayIso]);

  const greeting = useMemo(() => {
    const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' }).format(new Date()));
    if (hour < 12) return 'Bom dia';
    if (hour < 18) return 'Boa tarde';
    return 'Boa noite';
  }, []);

  const firstName = userName?.split(' ')[0] ?? '';

  return (
    <View style={styles.container}>
      {/* Cabeçalho */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>{greeting}, {firstName || 'atleta'}</Text>
          <Text style={styles.greetingSubtitle}>Veja como está sua semana.</Text>
        </View>
      </View>

      {/* Bloco 1 — Hoje */}
      <HeroToday
        loading={planLoading}
        error={planError && !plan}
        state={today.state}
        session={today.session}
        nextSession={today.nextSession}
        onOpenWeek={onOpenWeek}
      />

      {/* Bloco 2 — Sua semana */}
      <WeekSection
        loading={planLoading}
        error={planError && !plan}
        cells={weekDayCells}
        volume={currentWeekVolume}
        onOpenWeek={onOpenWeek}
        onOpenWeekTarget={onOpenWeekTarget}
        onOpenHistory={onOpenHistory}
      />

      {/* Bloco 3 — Seu progresso */}
      <ProgressSection
        loading={evolutionLoading}
        error={evolutionError && !evolution}
        weeks={evolution?.recentWeeks ?? []}
        onOpenProgress={onOpenProgress}
      />

      {/* Bloco 4 — Como você está */}
      <FeelingsSection loading={feelingsLoading} feelings={feelings} onOpenFeeling={onOpenFeeling} />

      {/* Bloco 5 — Seu acompanhamento */}
      <AcompanhamentoSection
        firstName={firstName}
        currentWeekVolume={currentWeekVolume}
        feelings={feelings}
        loading={evolutionLoading || feelingsLoading}
      />

      {/* Bloco 6 — Conquistas */}
      <ConquistasSection loading={medalsLoading} error={medalsError && !medals} medals={medals} onOpenAll={onOpenMedalsAll} />

      {/* Bloco 7 — Sua trajetória */}
      <TrajectorySection loading={medalsLoading} unlocked={medals?.unlocked ?? []} />

      {/* Bloco 8 — Seu próximo passo */}
      <NextStepSection
        loading={targetRacesLoading}
        targetRaces={targetRaces}
        todayIso={todayIso}
        onOpenTargetRace={onOpenTargetRace}
      />

      <View style={{ height: HomeSpace.section }} />
    </View>
  );
}

// -----------------------------------------------------------------------------------------
// Skeletons
// -----------------------------------------------------------------------------------------

function SkeletonBlock({ height }: { height: number }) {
  return <View style={[styles.card, { height, backgroundColor: HomeColors.surfaceSecondary }]} />;
}

// -----------------------------------------------------------------------------------------
// Bloco 1 — Hoje
// -----------------------------------------------------------------------------------------

function HeroToday({
  loading,
  error,
  state,
  session,
  nextSession,
  onOpenWeek,
}: {
  loading: boolean;
  error: boolean;
  state: TodaySessionState;
  session: HomeSessionLite | null;
  nextSession: HomeSessionLite | null;
  onOpenWeek: () => void;
}) {
  if (loading) return <SkeletonBlock height={180} />;
  if (error) return null; // degrada graciosamente — resto da Home continua

  const isRestDay = state === 'rest_day';
  const isDoneOk = state === 'done_as_planned';
  const isDoneAdjusted = state === 'done_adjusted';

  return (
    <View style={[styles.heroCard, HomeShadow.card]}>
      <View style={styles.heroGradientBg} />
      <Text style={styles.heroLabel}>HOJE</Text>
      {isRestDay ? (
        <>
          <Text style={styles.heroTitle}>Hoje é dia de recuperação</Text>
          {nextSession && (
            <Text style={styles.heroDetail}>
              Próximo treino: {formatShortDate(nextSession.isoDate)} • {nextSession.title}
              {nextSession.distanceKm ? ` • ${formatMetric(nextSession.distanceKm)} km` : ''}
            </Text>
          )}
        </>
      ) : (
        <>
          {(isDoneOk || isDoneAdjusted) && (
            <View style={styles.heroDoneRow}>
              <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
              <Text style={styles.heroDoneText}>{isDoneAdjusted ? 'Treino concluído com alteração' : 'Treino concluído'}</Text>
            </View>
          )}
          <Text style={styles.heroTitle}>{session?.title ?? 'Seu treino de hoje'}</Text>
          <Text style={styles.heroDetail}>
            {[
              session?.distanceKm ? `${formatMetric(session.distanceKm)} km` : null,
              session?.detail || null,
            ].filter(Boolean).join(' • ')}
          </Text>
        </>
      )}
      {!isRestDay && (
        <Pressable style={({ pressed }) => [styles.heroCta, pressed && styles.pressedScale]} onPress={onOpenWeek}>
          <Text style={styles.heroCtaText}>{isDoneOk || isDoneAdjusted ? 'Ver treino' : 'Ver treino'}</Text>
        </Pressable>
      )}
    </View>
  );
}

// -----------------------------------------------------------------------------------------
// Bloco 2 — Sua semana
// -----------------------------------------------------------------------------------------

const DAY_CELL_STYLE: Record<string, { bg: string; fg: string; icon: keyof typeof Ionicons.glyphMap | null }> = {
  done: { bg: HomeColors.success, fg: '#FFFFFF', icon: 'checkmark' },
  adjusted: { bg: HomeColors.warning, fg: '#FFFFFF', icon: 'swap-horizontal' },
  extra: { bg: HomeColors.panzeriAccent, fg: '#FFFFFF', icon: 'add' },
  missed: { bg: HomeColors.surfaceSecondary, fg: HomeColors.textTertiary, icon: 'close' },
  today_pending: { bg: HomeColors.panzeriLight, fg: HomeColors.panzeriPrimary, icon: null },
  future: { bg: HomeColors.surfaceSecondary, fg: HomeColors.textTertiary, icon: null },
  rest: { bg: 'transparent', fg: HomeColors.textTertiary, icon: null },
};

function WeekSection({
  loading,
  error,
  cells,
  volume,
  onOpenWeek,
  onOpenWeekTarget,
  onOpenHistory,
}: {
  loading: boolean;
  error: boolean;
  cells: ReturnType<typeof buildWeekDayCells>;
  volume: WeeklyVolumeLite | null;
  onOpenWeek: () => void;
  onOpenWeekTarget: (target: NonNullable<WeekCellTarget>) => void;
  onOpenHistory: () => void;
}) {
  if (loading) return <SkeletonBlock height={160} />;
  if (error) return null;

  const km = volume?.kmPercorridos ?? 0;
  const kmPrescrito = volume?.kmPrescritos ?? 0;
  const barPercent = kmPrescrito > 0 ? Math.min((km / kmPrescrito) * 100, 100) : 0;
  const overPrescribed = kmPrescrito > 0 && km > kmPrescrito;

  return (
    <View style={[styles.card, HomeBorder.card]}>
      <Text style={styles.sectionTitle}>Sua semana</Text>
      <View style={styles.weekRow}>
        {cells.map((cell) => {
          const cellStyle = DAY_CELL_STYLE[cell.state];
          return (
            <Pressable
              key={cell.isoDate}
              style={styles.weekDayColumn}
              disabled={!cell.target}
              onPress={() => { if (cell.target) onOpenWeekTarget(cell.target); }}
              accessibilityRole="button"
              accessibilityLabel={`Abrir treino de ${formatShortDate(cell.isoDate)}`}
            >
              <View style={[styles.weekDayCircle, { backgroundColor: cellStyle.bg }]}>
                {cellStyle.icon ? (
                  <Ionicons name={cellStyle.icon} size={14} color={cellStyle.fg} />
                ) : (
                  <Text style={[styles.weekDayLetter, { color: cellStyle.fg }]}>{cell.weekdayLetter}</Text>
                )}
                {cell.count > 1 ? (
                  <View style={styles.weekDayBadge}><Text style={styles.weekDayBadgeText}>{cell.count}</Text></View>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      {volume && (
        <>
          <View style={styles.weekSummaryRow}>
            <Text style={styles.weekSummaryItem}>{volume.sessoesFeitas}/{volume.sessoesPrescritas} treinos</Text>
            <Text style={styles.weekSummaryDot}>•</Text>
            <Text style={styles.weekSummaryItem}>
              {formatMetric(km)}{overPrescribed ? ` / ${formatMetric(kmPrescrito)}` : ` / ${formatMetric(kmPrescrito)}`} km
            </Text>
            {volume.adherencePercent != null && (
              <>
                <Text style={styles.weekSummaryDot}>•</Text>
                <Text style={styles.weekSummaryItem}>{volume.adherencePercent}% aderência</Text>
              </>
            )}
          </View>
          <View style={styles.volumeBarTrack}>
            <View style={[styles.volumeBarFill, { width: `${barPercent}%` }]} />
          </View>
        </>
      )}
      <View style={styles.weekLinksRow}>
        <Pressable onPress={onOpenWeek} style={styles.linkRow}>
          <Text style={styles.linkText}>Ver semana</Text>
          <Ionicons name="chevron-forward" size={14} color={HomeColors.panzeriInteraction} />
        </Pressable>
        <Pressable onPress={onOpenHistory} style={styles.linkRow}>
          <Text style={styles.linkText}>Calendário completo</Text>
          <Ionicons name="chevron-forward" size={14} color={HomeColors.panzeriInteraction} />
        </Pressable>
      </View>
    </View>
  );
}

// -----------------------------------------------------------------------------------------
// Bloco 3 — Seu progresso (barra + linha)
// -----------------------------------------------------------------------------------------

function ProgressSection({
  loading,
  error,
  weeks,
  onOpenProgress,
}: {
  loading: boolean;
  error: boolean;
  weeks: WeeklyVolumeLite[];
  onOpenProgress: () => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  if (loading) return <SkeletonBlock height={260} />;
  if (error || weeks.length === 0) {
    return (
      <View style={[styles.card, HomeBorder.card]}>
        <Text style={styles.sectionTitle}>Seu progresso</Text>
        <Text style={styles.emptyStateText}>
          Seu progresso começa aqui. Conforme você realiza seus treinos e responde aos feedbacks, sua evolução começa a aparecer neste espaço.
        </Text>
      </View>
    );
  }

  // Grafico compacto (Bloco 3, 04/10/2026): barras = realizado, linha = prescrito, na MESMA unidade (km),
  // eixo Y comecando em zero (escala real, nunca esticada), grade discreta, datas no eixo X e legenda.
  // Toque em qualquer ponto da coluna da semana abre o tooltip (periodo, variavel, valor, unidade).
  const width = 320;
  const height = 190;
  const padding = { top: 14, right: 8, bottom: 26, left: 34 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxRaw = Math.max(...weeks.map((w) => Math.max(w.kmPercorridos ?? 0, w.kmPrescritos ?? 0)), 1);
  const yStep = maxRaw <= 10 ? 2 : maxRaw <= 30 ? 5 : maxRaw <= 60 ? 10 : 20;
  const maxValue = Math.ceil((maxRaw * 1.05) / yStep) * yStep;
  const yTicks = Array.from({ length: Math.floor(maxValue / yStep) + 1 }, (_, i) => i * yStep);
  const step = plotWidth / weeks.length;
  const barWidth = step * 0.5;
  const yOf = (km: number) => padding.top + plotHeight - (km / maxValue) * plotHeight;

  const linePoints = weeks.map((w, i) => ({ x: padding.left + step * i + step / 2, y: yOf(w.kmPrescritos ?? 0), has: w.kmPrescritos != null }));
  // Semana sem km prescrito = sem ponto (ausencia nunca vira zero na linha).
  let linePath = '';
  let lineOpen = false;
  for (const p of linePoints) {
    if (!p.has) { lineOpen = false; continue; }
    linePath += `${lineOpen ? 'L' : 'M'} ${p.x} ${p.y} `;
    lineOpen = true;
  }
  const selectedWeek = selected != null ? weeks[selected] : null;
  const showEvery = weeks.length > 8 ? 2 : 1;

  return (
    <View style={[styles.card, HomeBorder.card]}>
      <View style={styles.sectionHeaderRow}>
        <View>
          <Text style={styles.sectionTitle}>Seu progresso</Text>
          <Text style={styles.sectionSubtitle}>Veja como seu treinamento vem se construindo.</Text>
        </View>
      </View>
      <View style={styles.plotAreaWrap}>
        <Svg width={width} height={height}>
          <Rect x={0} y={0} width={width} height={height} rx={HomeRadius.plotArea} fill={HomeColors.plotArea} />
          {yTicks.map((t) => (
            <React.Fragment key={`y-${t}`}>
              <Line x1={padding.left} x2={width - padding.right} y1={yOf(t)} y2={yOf(t)} stroke={HomeColors.divider} strokeWidth={1} />
              <SvgText x={padding.left - 4} y={yOf(t) + 3} fontSize={9} fill={HomeColors.textTertiary} textAnchor="end">{t}</SvgText>
            </React.Fragment>
          ))}
          <SvgText x={4} y={10} fontSize={9} fill={HomeColors.textTertiary}>km</SvgText>
          {weeks.map((w, i) => {
            const cx = padding.left + step * i + step / 2;
            return (
              <React.Fragment key={`x-${w.weekStart}`}>
                <Line x1={cx} x2={cx} y1={padding.top} y2={padding.top + plotHeight} stroke={HomeColors.divider} strokeWidth={0.5} strokeDasharray="2,3" />
                {i % showEvery === 0 ? (
                  <SvgText x={cx} y={height - 9} fontSize={8.5} fill={HomeColors.textTertiary} textAnchor="middle">{formatShortDate(w.weekStart)}</SvgText>
                ) : null}
              </React.Fragment>
            );
          })}
          {weeks.map((w, i) => {
            if (w.kmPercorridos == null) return null; // sem dado de km: ausencia, nunca barra de zero
            const km = w.kmPercorridos;
            const barHeight = (km / maxValue) * plotHeight;
            const x = padding.left + step * i + (step - barWidth) / 2;
            const isSelected = selected === i;
            return (
              <Rect
                key={w.weekStart}
                x={x}
                y={padding.top + plotHeight - barHeight}
                width={barWidth}
                height={Math.max(barHeight, 1)}
                rx={4}
                fill={isSelected ? HomeColors.panzeriInteraction : HomeColors.panzeriAccent}
                opacity={isSelected ? 1 : 0.85}
              />
            );
          })}
          {linePath ? <Path d={linePath} stroke={HomeColors.panzeriPrimary} strokeWidth={2} fill="none" /> : null}
          {linePoints.map((p, i) => (p.has ? <Circle key={i} cx={p.x} cy={p.y} r={3} fill={HomeColors.panzeriPrimary} /> : null))}
          {/* Alvo de toque: coluna inteira de cada semana (nao so a barra, que pode ser minuscula). */}
          {weeks.map((w, i) => (
            <Rect
              key={`hit-${w.weekStart}`}
              x={padding.left + step * i}
              y={padding.top}
              width={step}
              height={plotHeight}
              fill="transparent"
              onPress={() => setSelected(i)}
            />
          ))}
        </Svg>
      </View>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: HomeColors.panzeriAccent }]} /><Text style={styles.legendText}>Realizado (km)</Text></View>
        <View style={styles.legendItem}><View style={[styles.legendLine, { backgroundColor: HomeColors.panzeriPrimary }]} /><Text style={styles.legendText}>Prescrito (km)</Text></View>
      </View>
      {selectedWeek ? (
        <View style={styles.tooltipPanel}>
          <Text style={styles.tooltipTitle}>Semana de {formatShortDate(selectedWeek.weekStart)}</Text>
          <Text style={styles.tooltipLine}>Prescrito: {formatMetric(selectedWeek.kmPrescritos)} km</Text>
          <Text style={styles.tooltipLine}>Realizado: {formatMetric(selectedWeek.kmPercorridos)} km</Text>
          {selectedWeek.kmExtras != null && selectedWeek.kmExtras > 0 ? <Text style={styles.tooltipLine}>Extra (incluído no realizado): {formatMetric(selectedWeek.kmExtras)} km</Text> : null}
          {selectedWeek.adherencePercent != null && <Text style={styles.tooltipLine}>Aderência: {selectedWeek.adherencePercent}%</Text>}
          <Text style={styles.tooltipLine}>Treinos: {selectedWeek.sessoesFeitas}/{selectedWeek.sessoesPrescritas}</Text>
        </View>
      ) : (
        <Text style={styles.chartHint}>Toque numa semana para ver os detalhes.</Text>
      )}
      <Pressable onPress={onOpenProgress} style={styles.linkRow}>
        <Text style={styles.linkText}>Ver evolução</Text>
        <Ionicons name="chevron-forward" size={14} color={HomeColors.panzeriInteraction} />
      </Pressable>
    </View>
  );
}

// -----------------------------------------------------------------------------------------
// Bloco 4 — Como você está
// -----------------------------------------------------------------------------------------

// Quatro blocos tematicos (Sono, Prontidao pre-treino, Percepcao de esforco, Resposta pos-treino).
// Cada card mostra o valor recente da variavel PRINCIPAL do dominio, contexto (tendencia/faixa
// habitual — mesmas regras de evidencia das frases das telas de detalhe) e uma mini visualizacao
// na ESCALA ORIGINAL da variavel (1-5 ou RPE 1-10), nunca esticada ao min/max dos dados. Toque abre o
// detalhamento do dominio.
const DOMAIN_ORDER: FeelingDomain[] = ['sleep', 'readiness', 'effort', 'response'];

function Sparkline({ values, scale }: { values: number[]; scale?: { min: number; max: number } }) {
  if (values.length < 2) return <View style={{ height: 24 }} />;
  const width = 80;
  const height = 24;
  const max = scale ? scale.max : Math.max(...values);
  const min = scale ? scale.min : Math.min(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const points = values.map((v, i) => ({ x: i * step, y: height - ((v - min) / range) * height }));
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  return (
    <Svg width={width} height={height}>
      <Path d={path} stroke={HomeColors.panzeriAccent} strokeWidth={1.5} fill="none" />
    </Svg>
  );
}

function FeelingCard({ domain, snapshot, onOpen }: { domain: FeelingDomain; snapshot: VariableSnapshotLite | null | undefined; onOpen: () => void }) {
  const cfg = FEELING_DOMAINS[domain];
  const primaryLabel = cfg.variables.find((v) => v.id === cfg.primary)?.label ?? cfg.title;
  if (!snapshot || snapshot.evidence.n === 0) {
    return (
      <Pressable onPress={onOpen} style={[styles.feelingCard, HomeBorder.card]}>
        <Text style={styles.feelingLabel}>{cfg.title}</Text>
        <Text style={styles.feelingEmpty}>Sem dados ainda</Text>
      </Pressable>
    );
  }
  const scale = snapshot.variable.scale;
  const scaleMax = scale?.max ?? 5;
  const values = snapshot.observations.slice(-7).map((o) => Number(o.value)).filter((v) => !Number.isNaN(v));
  const chips = [trendChip(snapshot), rangeChip(snapshot)].filter((c): c is string => c != null);

  return (
    <Pressable onPress={onOpen} style={({ pressed }) => [styles.feelingCard, HomeBorder.card, pressed && styles.pressedScale]}>
      <Text style={styles.feelingLabel}>{cfg.title}</Text>
      <Text style={styles.feelingValue}>{formatMetric(snapshot.current)} / {scaleMax}</Text>
      <Text style={styles.feelingTrend}>{primaryLabel}</Text>
      {chips.length > 0 ? <Text style={styles.feelingTrend}>{chips.join(' · ')}</Text> : null}
      <Sparkline values={values} scale={scale ? { min: scale.min, max: scale.max } : undefined} />
      <Text style={styles.feelingMore}>Ver detalhes ›</Text>
    </Pressable>
  );
}

function FeelingsSection({ loading, feelings, onOpenFeeling }: { loading: boolean; feelings: Record<string, VariableSnapshotLite | null>; onOpenFeeling: (domain: FeelingDomain) => void }) {
  if (loading) return <SkeletonBlock height={220} />;
  const anyData = DOMAIN_ORDER.some((d) => feelings[FEELING_DOMAINS[d].primary] && feelings[FEELING_DOMAINS[d].primary]!.evidence.n > 0);

  return (
    <View style={[styles.card, HomeBorder.card]}>
      <Text style={styles.sectionTitle}>Como você está</Text>
      <Text style={styles.sectionSubtitle}>O que seus feedbacks vêm mostrando.</Text>
      {anyData ? (
        <View style={styles.feelingsGrid}>
          {DOMAIN_ORDER.map((d) => (
            <FeelingCard key={d} domain={d} snapshot={feelings[FEELING_DOMAINS[d].primary]} onOpen={() => onOpenFeeling(d)} />
          ))}
        </View>
      ) : (
        <Text style={styles.emptyStateText}>
          Conte como foi seu treino. Seus feedbacks ajudam a construir sua visão de sono, prontidão, esforço e resposta aos treinos ao longo do tempo.
        </Text>
      )}
    </View>
  );
}

// -----------------------------------------------------------------------------------------
// Bloco 5 — Seu acompanhamento (texto determinístico, sem chamada de IA nova)
// -----------------------------------------------------------------------------------------

function AcompanhamentoSection({
  firstName,
  currentWeekVolume,
  feelings,
  loading,
}: {
  firstName: string;
  currentWeekVolume: WeeklyVolumeLite | null;
  feelings: Record<string, VariableSnapshotLite | null>;
  loading: boolean;
}) {
  if (loading) return <SkeletonBlock height={140} />;

  const parts: string[] = [];
  if (currentWeekVolume) {
    parts.push(
      `${firstName ? `${firstName}, nesta` : 'Nesta'} semana você realizou ${currentWeekVolume.sessoesFeitas} de ${currentWeekVolume.sessoesPrescritas} treinos planejados` +
      (currentWeekVolume.kmPercorridos ? ` e acumulou ${formatMetric(currentWeekVolume.kmPercorridos)} km` : '') + '.',
    );
  }
  const sleep = feelings['workout.preSleepQuality'];
  const fatigue = feelings['workout.prePhysicalFatigue'];
  // Mesmas frases das telas de detalhe (trendSentence): Home e dominios nunca se contradizem.
  const sleepLine = trendSentence(sleep, { label: 'A qualidade do sono', fmt: (v) => String(v) });
  if (sleepLine) parts.push(sleepLine);
  const fatigueLine = trendSentence(fatigue, { label: 'O cansaço físico antes do treino', fmt: (v) => String(v) });
  if (fatigueLine) parts.push(fatigueLine);
  if (parts.length === 0) {
    parts.push('Continue registrando seus feedbacks para que possamos acompanhar sua trajetória com você.');
  } else {
    parts.push('Seu treinamento continua avançando. Continue registrando seus feedbacks para que possamos acompanhar essas mudanças com você.');
  }

  return (
    <View style={[styles.card, styles.acompanhamentoCard]}>
      <View style={styles.acompanhamentoHeader}>
        <Ionicons name="analytics-outline" size={18} color={HomeColors.panzeriPrimary} />
        <Text style={styles.sectionTitle}>Seu acompanhamento</Text>
      </View>
      <Text style={styles.acompanhamentoText}>{parts.join(' ')}</Text>
    </View>
  );
}

// -----------------------------------------------------------------------------------------
// Bloco 6 — Conquistas
// -----------------------------------------------------------------------------------------

function MedalBadge({ grau, size = 40 }: { grau: string; size?: number }) {
  const color = MedalGrauColors[grau] ?? MedalGrauColors.bronze;
  return (
    <View style={[styles.medalBadge, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
      <Ionicons name="ribbon" size={size * 0.5} color="#FFFFFF" />
    </View>
  );
}

function ConquistasSection({
  loading,
  error,
  medals,
  onOpenAll,
}: {
  loading: boolean;
  error: boolean;
  medals: MedalsSummaryLite | null;
  onOpenAll: () => void;
}) {
  if (loading) return <SkeletonBlock height={220} />;
  if (error) return null;

  const next = medals?.progress?.filter((p) => p.recommendedAsNextGoal !== false)[0] ?? medals?.progress?.[0] ?? null;
  const recent = (medals?.unlocked ?? []).slice(0, 4);

  return (
    <View style={[styles.card, HomeBorder.card]}>
      <Text style={styles.sectionTitle}>Conquistas</Text>
      <Text style={styles.sectionSubtitle}>Cada treino deixa uma marca na sua trajetória.</Text>

      {next ? (
        <View style={styles.nextMedalCard}>
          <MedalBadge grau={next.grau} />
          <View style={{ flex: 1 }}>
            <Text style={styles.nextMedalName}>{next.name}</Text>
            {next.threshold != null && (
              <>
                <Text style={styles.nextMedalProgress}>
                  {formatMetric(next.currentValue)} / {formatMetric(next.threshold)} {next.unit ?? ''}
                </Text>
                <View style={styles.progressBarTrack}>
                  <View style={[styles.progressBarFill, { width: `${Math.min(((next.currentValue ?? 0) / next.threshold) * 100, 100)}%` }]} />
                </View>
                {next.currentValue != null && next.currentValue < next.threshold && (() => {
                  const remaining = next.threshold - next.currentValue;
                  const verb = Math.abs(remaining - 1) < 0.05 ? 'Falta' : 'Faltam';
                  return (
                    <Text style={styles.nextMedalHint}>
                      {verb} {formatMetric(remaining)} {next.unit ?? ''} para esta conquista.
                    </Text>
                  );
                })()}
              </>
            )}
          </View>
        </View>
      ) : recent.length === 0 ? (
        <Text style={styles.emptyStateText}>Sua primeira conquista está começando.</Text>
      ) : null}

      {recent.length > 0 && (
        <View style={styles.recentMedalsRow}>
          {recent.map((m) => (
            <View key={m.code} style={styles.recentMedalItem}>
              <MedalBadge grau={m.grau} size={48} />
              <Text style={styles.recentMedalName} numberOfLines={1}>{m.name}</Text>
              <Text style={styles.recentMedalDate}>{formatShortDate(m.unlockedAt)}</Text>
            </View>
          ))}
        </View>
      )}

      <Pressable onPress={onOpenAll} style={styles.linkRow}>
        <Text style={styles.linkText}>Ver todas as conquistas</Text>
        <Ionicons name="chevron-forward" size={14} color={HomeColors.panzeriInteraction} />
      </Pressable>
    </View>
  );
}

// -----------------------------------------------------------------------------------------
// Bloco 7 — Sua trajetória
// -----------------------------------------------------------------------------------------

function TrajectorySection({ loading, unlocked }: { loading: boolean; unlocked: UnlockedMedalLite[] }) {
  if (loading) return <SkeletonBlock height={140} />;
  // Linha do tempo arrastavel na horizontal: mostra mais marcos (ate' 20), do mais recente ao mais antigo.
  const events = buildTrajectoryEvents(unlocked, 20);
  if (events.length === 0) return null;

  return (
    <View style={[styles.card, HomeBorder.card]}>
      <Text style={styles.sectionTitle}>Sua trajetória</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.timelineRow}>
        {events.map((e, i) => (
          <View key={e.code} style={styles.timelineItem}>
            <View style={styles.timelineDot} />
            <Text style={styles.timelineLabel} numberOfLines={2}>{e.label}</Text>
            <Text style={styles.timelineDate}>{formatShortDate(e.dateIso)}</Text>
            {i < events.length - 1 && <View style={styles.timelineLine} />}
          </View>
        ))}
      </ScrollView>
      {events.length > 3 ? <Text style={styles.chartHint}>Arraste para o lado para ver mais da sua trajetória.</Text> : null}
    </View>
  );
}

// -----------------------------------------------------------------------------------------
// Bloco 8 — Seu próximo passo
// -----------------------------------------------------------------------------------------

function NextStepSection({
  loading,
  targetRaces,
  todayIso,
  onOpenTargetRace,
}: {
  loading: boolean;
  targetRaces: TargetRaceLite[] | null;
  todayIso: string;
  onOpenTargetRace: () => void;
}) {
  if (loading) return <SkeletonBlock height={120} />;

  const activeRace = (targetRaces ?? [])
    .filter((r) => r.status === 'em_andamento')
    .sort((a, b) => a.raceDate.localeCompare(b.raceDate))[0];

  return (
    <Pressable onPress={onOpenTargetRace} style={[styles.card, HomeBorder.card]}>
      <Text style={styles.sectionTitle}>Seu próximo passo</Text>
      {activeRace ? (
        <>
          <Text style={styles.nextStepRaceName}>{activeRace.name}</Text>
          <Text style={styles.nextStepRaceDate}>{formatShortDate(activeRace.raceDate)} • {daysUntil(activeRace.raceDate, todayIso)} dias</Text>
          <Text style={styles.acompanhamentoText}>Seu treinamento está sendo organizado para este objetivo.</Text>
        </>
      ) : (
        <>
          <Text style={styles.nextStepRaceName}>Continue construindo sua próxima etapa</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: HomeSpace.block,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: HomeSpace.small,
  },
  greeting: { ...HomeTypography.greeting, color: HomeColors.textPrimary },
  greetingSubtitle: { ...HomeTypography.body, color: HomeColors.textSecondary, marginTop: 2 },

  card: {
    backgroundColor: HomeColors.surface,
    borderRadius: HomeRadius.cardLarge,
    padding: HomeSpace.component,
  },

  sectionTitle: { ...HomeTypography.sectionTitle, color: HomeColors.textPrimary },
  sectionSubtitle: { ...HomeTypography.body, color: HomeColors.textSecondary, marginTop: 2, marginBottom: HomeSpace.related },
  sectionHeaderRow: { marginBottom: HomeSpace.small },
  emptyStateText: { ...HomeTypography.body, color: HomeColors.textSecondary, lineHeight: 21 },

  // Hero Hoje
  heroCard: {
    borderRadius: HomeRadius.cardLarge,
    padding: HomeSpace.component,
    backgroundColor: HomeColors.panzeriPrimary,
    overflow: 'hidden',
  },
  heroGradientBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: HomeColors.panzeriInteraction,
    opacity: 0.001, // placeholder — gradiente real via backgroundImage no web abaixo
    ...(Platform.OS === 'web' ? { backgroundImage: `linear-gradient(135deg, ${HomeColors.panzeriPrimary} 0%, ${HomeColors.panzeriInteraction} 55%, ${HomeColors.panzeriAccent} 100%)`, opacity: 1 } as never : {}),
  },
  heroLabel: { ...HomeTypography.label, color: 'rgba(255,255,255,0.75)', letterSpacing: 1 },
  heroDoneRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: HomeSpace.small },
  heroDoneText: { ...HomeTypography.bodyMedium, color: '#FFFFFF' },
  heroTitle: { fontSize: 24, fontWeight: '700', color: '#FFFFFF', marginTop: HomeSpace.small },
  heroDetail: { ...HomeTypography.body, color: 'rgba(255,255,255,0.85)', marginTop: 4 },
  heroCta: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderRadius: HomeRadius.pill,
    paddingVertical: 10,
    paddingHorizontal: 20,
    marginTop: HomeSpace.component,
  },
  heroCtaText: { ...HomeTypography.bodyMedium, color: HomeColors.panzeriPrimary, fontWeight: '700' },
  pressedScale: { transform: [{ scale: 0.985 }] },

  // Semana
  weekRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: HomeSpace.component, marginBottom: HomeSpace.component },
  weekDayColumn: { alignItems: 'center' },
  weekDayCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  weekDayLetter: { fontSize: 13, fontWeight: '700' },
  weekDayBadge: { position: 'absolute', top: -4, right: -4, minWidth: 14, height: 14, borderRadius: 7, backgroundColor: HomeColors.textPrimary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  weekDayBadgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
  weekLinksRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: HomeSpace.small },
  weekSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: HomeSpace.small },
  weekSummaryItem: { ...HomeTypography.bodyMedium, color: HomeColors.textPrimary },
  weekSummaryDot: { color: HomeColors.textTertiary },
  volumeBarTrack: { height: 6, borderRadius: 3, backgroundColor: HomeColors.divider, overflow: 'hidden' },
  volumeBarFill: { height: 6, backgroundColor: HomeColors.panzeriAccent, borderRadius: 3 },

  // Progresso
  plotAreaWrap: { alignItems: 'center', marginBottom: HomeSpace.small },
  chartHint: { ...HomeTypography.tertiary, color: HomeColors.textTertiary, textAlign: 'center', marginBottom: HomeSpace.small },
  tooltipPanel: { backgroundColor: HomeColors.surfaceSecondary, borderRadius: HomeRadius.small, padding: HomeSpace.related, marginBottom: HomeSpace.small },
  tooltipTitle: { ...HomeTypography.bodyMedium, color: HomeColors.textPrimary, marginBottom: 4 },
  tooltipLine: { ...HomeTypography.body, color: HomeColors.textSecondary },
  legendRow: { flexDirection: 'row', gap: HomeSpace.component, justifyContent: 'center', marginBottom: HomeSpace.small },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 10, height: 10, borderRadius: 2 },
  legendLine: { width: 14, height: 3, borderRadius: 2 },
  legendText: { ...HomeTypography.tertiary, color: HomeColors.textSecondary },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: HomeSpace.small },
  linkText: { ...HomeTypography.bodyMedium, color: HomeColors.panzeriInteraction },

  // Como você está
  feelingsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: HomeSpace.related },
  feelingCard: {
    width: '47%',
    backgroundColor: HomeColors.surfaceSecondary,
    borderRadius: HomeRadius.small,
    padding: HomeSpace.related,
    gap: 4,
  },
  feelingLabel: { ...HomeTypography.label, color: HomeColors.textSecondary },
  feelingValue: { ...HomeTypography.numberSecondary, color: HomeColors.textPrimary },
  feelingTrend: { ...HomeTypography.tertiary, color: HomeColors.textTertiary },
  feelingMore: { ...HomeTypography.tertiary, color: HomeColors.panzeriInteraction, marginTop: 4 },
  feelingEmpty: { ...HomeTypography.tertiary, color: HomeColors.textTertiary, marginTop: 8 },

  // Acompanhamento
  acompanhamentoCard: { backgroundColor: HomeColors.surfaceHighlight },
  acompanhamentoHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: HomeSpace.small },
  acompanhamentoText: { ...HomeTypography.body, color: HomeColors.textPrimary, lineHeight: 22, marginTop: 4 },

  // Conquistas
  medalBadge: { alignItems: 'center', justifyContent: 'center' },
  nextMedalCard: { flexDirection: 'row', gap: HomeSpace.related, alignItems: 'center', marginBottom: HomeSpace.component },
  nextMedalName: { ...HomeTypography.bodyMedium, color: HomeColors.textPrimary },
  nextMedalProgress: { ...HomeTypography.numberSecondary, color: HomeColors.textPrimary, marginTop: 2 },
  nextMedalHint: { ...HomeTypography.tertiary, color: HomeColors.textSecondary, marginTop: 4 },
  progressBarTrack: { height: 6, borderRadius: 3, backgroundColor: HomeColors.divider, overflow: 'hidden', marginTop: 6, width: '100%' },
  progressBarFill: { height: 6, backgroundColor: HomeColors.panzeriAccent, borderRadius: 3 },
  recentMedalsRow: { flexDirection: 'row', gap: HomeSpace.related, marginBottom: HomeSpace.small },
  recentMedalItem: { alignItems: 'center', width: 70 },
  recentMedalName: { ...HomeTypography.tertiary, color: HomeColors.textPrimary, marginTop: 4, textAlign: 'center' },
  recentMedalDate: { ...HomeTypography.tertiary, color: HomeColors.textTertiary },

  // Trajetória
  timelineRow: { flexDirection: 'row', gap: HomeSpace.related },
  timelineItem: { width: 90, alignItems: 'center' },
  timelineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: HomeColors.panzeriAccent, marginBottom: 6 },
  timelineLabel: { ...HomeTypography.tertiary, color: HomeColors.textPrimary, textAlign: 'center' },
  timelineDate: { ...HomeTypography.tertiary, color: HomeColors.textTertiary, marginTop: 2 },
  timelineLine: { position: 'absolute', top: 5, left: '60%', width: '80%', height: 1, backgroundColor: HomeColors.divider },

  // Próximo passo
  nextStepRaceName: { ...HomeTypography.bodyMedium, color: HomeColors.textPrimary, marginTop: 4 },
  nextStepRaceDate: { ...HomeTypography.body, color: HomeColors.textSecondary, marginTop: 2 },
});
