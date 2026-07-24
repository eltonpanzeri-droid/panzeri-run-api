import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  Linking,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

type Screen = 'login' | 'app';
type Tab = 'week' | 'interview' | 'anamnese' | 'test' | 'progress' | 'strava' | 'billing' | 'profile' | 'reassessment' | 'targetRace' | 'painReport' | 'fixAnswers';
type AuthMode = 'login' | 'register';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('Panzeri Run crashed:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.loadingState}>
            <Text style={styles.sectionLabel}>Panzeri Run</Text>
            <Text style={styles.statusMessage}>Algo deu errado ao abrir esta tela.</Text>
            <Text style={styles.statusMessage}>{this.state.error.message}</Text>
            <Pressable style={styles.primaryButton} onPress={() => this.setState({ error: null })}>
              <Text style={styles.primaryButtonText}>Tentar novamente</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

function initialAuthMode(): AuthMode {
  if (typeof window === 'undefined') {
    return 'login';
  }

  const params = new URLSearchParams(window.location.search);
  return params.get('cadastro') === '1' ? 'register' : 'login';
}

interface RoutineDay {
  weekday: number;
  day: string;
  label: string;
  modalities: string[];
  minutesByModality: Record<string, string>;
}

interface AuthSession {
  email: string;
  name: string;
  accessToken: string;
  refreshToken: string;
}

interface AuthResponse {
  user?: {
    email?: string;
    name?: string;
    role?: string;
  };
  tokens?: {
    accessToken?: string;
    refreshToken?: string;
  };
}

interface WeekPlanSession {
  id: string;
  day: string;
  date: string;
  title: string;
  detail: string;
  modality: string;
  zone: string;
  durationMin?: number | null;
  distanceKm?: number | null;
  structure?: SessionStructure;
  notes?: string;
  completion?: {
    status: CompletionDraft['status'];
    completedAt?: string | null;
    durationMin?: number | null;
    distanceKm?: number | null;
    avgPaceSecondsKm?: number | null;
    perceivedEffort?: number | null;
    satisfaction?: string | null;
    painFlag?: string | null;
    notes?: string | null;
    details?: { loadsText?: string } | null;
  } | null;
}

type SessionStructure =
  | {
      type: 'run';
      distanceKm?: number;
      durationMin?: number;
      durationRange?: string;
      speedKmh?: number;
      speedRange?: string | null;
      zone?: string;
      paceRange?: string | null;
      blocks?: Array<{
        label: string;
        durationMin?: number;
        durationRange?: string;
        durationType?: string;
        distanceValue?: string | number;
        distanceUnit?: string;
        intensityMode?: string;
        zone?: string;
        rpe?: string;
        paceRange?: string | null;
        speedKmh?: number;
        speedRange?: string | null;
        guidance?: string;
        repeatCount?: number;
        steps?: Array<{
          label: string;
          distanceValue?: string | number;
          distanceUnit?: string;
          durationRange?: string;
          paceRange?: string | null;
          speedRange?: string | null;
        }>;
      }>;
    }
  | {
      type: 'aerobic';
      modality?: string;
      durationMin?: number;
      zone?: string;
      guidance?: string;
      blocks?: Array<{ label: string; durationMin: number; zone?: string; guidance?: string }>;
    }
  | {
      type: 'strength';
      category?: string;
      exercises?: Array<{
        id?: string;
        category?: string;
        name: string;
        description?: string;
        videoUrl?: string | null;
        sets: number;
        reps: string;
        intensity?: string;
        restSeconds: number;
        cadence?: string | null;
        loadField: boolean;
      }>;
    };

interface WeekPlan {
  id: string;
  name: string;
  startDate?: string;
  endDate?: string;
  recommendation?: string;
  locked?: boolean;
  checkoutUrl?: string;
  priceLabel?: string;
  requiresOnboarding?: boolean;
  requiresTest?: boolean;
  sessions: WeekPlanSession[];
}

type InterviewAnswer = string | number | string[] | boolean;
type InterviewAnswers = Record<string, InterviewAnswer>;

interface InterviewState {
  answers: InterviewAnswers;
  currentStep: number;
  completedAt?: string | null;
}

interface InterviewOption {
  label: string;
  value: string;
}

interface InterviewQuestion {
  key: string;
  module: string;
  prompt: string;
  type: 'single' | 'multi' | 'scale' | 'text' | 'number' | 'number_or_unknown' | 'date' | 'cpf' | 'phone' | 'cep' | 'notice' | 'wheel_number' | 'wheel_pace' | 'wheel_duration_hms' | 'wheel_date' | 'dropdown_single' | 'dropdown_multi';
  options?: InterviewOption[];
  optional?: boolean;
  help?: string;
  condition?: (answers: InterviewAnswers) => boolean;
  wheelDigits?: number;
  wheelMin?: number;
  wheelMax?: number;
  wheelUnit?: string;
}

interface CompletionDraft {
  status: 'done' | 'missed' | 'adjusted';
  completedDate: string;
  perceivedEffort: string;
  satisfaction: string;
  painFlag: string;
  durationMin: string;
  distanceKm: string;
  avgPace: string;
  notes: string;
  loadsText: string;
}

interface StravaReport {
  summary?: {
    prescribedSessions: number;
    eligibleSessions?: number;
    asPrescribedSessions?: number;
    sameModalityChangedSessions?: number;
    differentSessions?: number;
    missedSessions?: number;
    futureSessions?: number;
    executedSessions?: number;
    executionPercent?: number;
    adherencePercent: number;
    prescribedKm: number;
    actualKm: number;
    kmDiff: number;
    prescribedMinutes: number;
    actualMinutes: number;
    minutesDiff: number;
    coachAnalysis?: {
      title: string;
      text: string;
    };
  } | null;
  items: Array<{
    date: string;
    title: string;
    modality?: string | null;
    status: string;
    prescribedDistance?: number | null;
    actualDistance?: number | null;
    distanceDiff?: number | null;
    prescribedDuration?: number | null;
    actualDuration?: number | null;
    durationDiff?: number | null;
    pace?: string | null;
    activityName?: string | null;
    activityType?: string | null;
    actualModality?: string | null;
    source?: string | null;
    completionStatus?: string | null;
    perceivedEffort?: number | null;
  }>;
}

interface StravaConnectionStatus {
  connected: boolean;
  automaticSync: boolean;
  connectedAt?: string | null;
  lastCheckedAt?: string | null;
  lastActivityAt?: string | null;
  lastActivityName?: string | null;
}

interface SavedAvailabilityDay {
  weekday: number;
  noTraining: boolean;
  modalities: string[];
  availableMin?: number | null;
  modalityDurations?: Record<string, number> | null;
}

interface MeResponse {
  email?: string;
  name?: string;
  birthDate?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
  acceptedExerciseResponsibilityAt?: string | null;
  healthProfile?: {
    averageSleep?: string | null;
    stressLevel?: string | null;
    anxietyLevel?: string | null;
    previousInjuries?: string | null;
    healthProblems?: string | null;
    medications?: string | null;
  } | null;
  preferences?: {
    preferredModalities?: string[];
    otherModalities?: string[];
    trainingLocations?: string[];
    mainGoal?: string | null;
  } | null;
  availability?: SavedAvailabilityDay[];
  weeklyAvailability?: SavedAvailabilityDay[];
  tests?: Array<{ id?: string; totalSeconds?: number | null; createdAt?: string | null }>;
  fitnessTests?: Array<{ id?: string; totalSeconds?: number | null; createdAt?: string | null }>;
}

interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
}

// Na web, chamamos pelo mesmo dominio do app (repassado pelo nginx em /api) em vez do
// subdominio separado "-api.". Alguns bloqueadores de anuncio/DNS tratam qualquer host
// contendo "api" como rastreador e derrubam a chamada antes dela sair do aparelho, mesmo
// com internet normal — isso nunca aparecia nos logs do backend porque a chamada nunca
// chegava la. Numa build nativa futura (sem dominio proprio para repassar) mantemos a URL
// absoluta.
const API_URL = Platform.OS === 'web' ? '/api' : 'https://agenteselton-panzeri-run-api.hbljgk.easypanel.host';
const AUTH_SESSION_KEY = 'panzeri-run-auth-session';
const DISMISSED_NOTIFICATIONS_KEY = 'panzeri-run-dismissed-notifications';

type AuthPopup = {
  document?: { write: (html: string) => void };
  location?: { href: string };
  close?: () => void;
} | null;

function openAuthPopup(): AuthPopup {
  const browserWindow = (globalThis as unknown as {
    window?: { open?: (url?: string, target?: string, features?: string) => AuthPopup };
  }).window;

  return browserWindow?.open?.(
    '',
    'panzeri_strava',
    'width=520,height=760,menubar=no,toolbar=no,location=yes,status=no',
  ) ?? null;
}

// Conexoes moveis tem quedas curtas e passageiras (troca de torre, wifi instavel). Sem isso,
// uma unica falha de rede de meio segundo em uma tela critica (pagamento, conclusao da
// entrevista) obriga o aluno a repetir a acao manualmente. Uma tentativa extra silenciosa
// resolve a maioria dos casos sem o aluno perceber que algo falhou.
async function fetchWithRetry(url: string, options: RequestInit, retries = 1, retryDelayMs = 1200): Promise<Response> {
  try {
    return await fetch(url, options);
  } catch (error) {
    if (retries <= 0) throw error;
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    return fetchWithRetry(url, options, retries - 1, retryDelayMs);
  }
}

async function extractErrorMessage(response: Response): Promise<string | null> {
  try {
    const data = (await response.json()) as { message?: string | string[] };
    if (Array.isArray(data.message)) return data.message[0] ?? null;
    return data.message ?? null;
  } catch {
    return null;
  }
}

const modalityOptions = [
  'Musculacao',
  'Fortalecimento para corredores',
  'CrossFit',
  'Natacao',
  'Corrida',
  'Bike',
  'Beach Tenis',
  'Futebol',
  'Pilates',
  'Outra',
];
const locationOptions = ['Academia de musculacao', 'Academia de funcional', 'Esteira', 'Treino em casa', 'Corrida na rua'];
const dayTrainingOptions = [
  'Sem treinos',
  'Musculacao',
  'Fortalecimento para corredores',
  'Treino de forca em casa',
  'Corrida na rua',
  'Corrida na esteira',
  'Bike ou outro aparelho aerobico',
];
const timeOptions = ['30', '45', '60', '75', '90', '120'];
const goalOptions = [
  'Comecar a correr',
  'Completar 5 km',
  'Melhorar meu tempo nos 5 km',
  'Completar 10 km',
  'Melhorar meu tempo nos 10 km',
  'Completar 21 km',
  'Melhorar meu tempo nos 21 km',
  'Completar 42 km',
  'Melhorar meu tempo nos 42 km',
];

const defaultRoutineDays: RoutineDay[] = [
  { weekday: 1, day: 'Seg', label: 'Segunda-feira', modalities: ['Musculacao'], minutesByModality: { Musculacao: '60' } },
  { weekday: 2, day: 'Ter', label: 'Terca-feira', modalities: ['Corrida na rua'], minutesByModality: { 'Corrida na rua': '45' } },
  { weekday: 3, day: 'Qua', label: 'Quarta-feira', modalities: ['Sem treinos'], minutesByModality: {} },
  { weekday: 4, day: 'Qui', label: 'Quinta-feira', modalities: ['Corrida na rua'], minutesByModality: { 'Corrida na rua': '60' } },
  { weekday: 5, day: 'Sex', label: 'Sexta-feira', modalities: ['Sem treinos'], minutesByModality: {} },
  { weekday: 6, day: 'Sab', label: 'Sabado', modalities: ['Corrida na rua'], minutesByModality: { 'Corrida na rua': '75' } },
  { weekday: 0, day: 'Dom', label: 'Domingo', modalities: ['Sem treinos'], minutesByModality: {} },
];

const option = (label: string, value = label) => ({ label, value });
const activityOptions = ['Corrida', 'Caminhada', 'Musculacao', 'Ciclismo', 'Natacao', 'Funcional', 'CrossFit', 'Lutas', 'Pilates', 'Yoga', 'Spinning', 'Beach Tenis', 'Esportes coletivos', 'Outra'];
const interviewTimeOptions = [
  option('Nao posso treinar', 'none'), option('Ate 30 minutos', 'up_to_30'), option('30 a 45 minutos', 'from_30_to_45'),
  option('45 a 60 minutos', 'from_45_to_60'), option('60 a 90 minutos', 'from_60_to_90'), option('Mais de 90 minutos', 'over_90'),
];
const CURRENTLY_RUNNING_VALUES = new Set(['currently_lt_3m', 'currently_lt_6m', 'currently_lt_1y', 'currently_gt_1y']);
function isCurrentlyRunning(answers: InterviewAnswers) {
  return CURRENTLY_RUNNING_VALUES.has(String(answers.running_experience ?? ''));
}
function numberAnswerRank(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function padWheelNumber(value: number, digits: number) {
  return String(Math.max(0, value)).padStart(digits, '0');
}
function wheelNumberValues(min: number, max: number, digits: number) {
  const values: string[] = [];
  for (let i = min; i <= max; i += 1) values.push(padWheelNumber(i, digits));
  return values;
}
function parseHmsToSeconds(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (minutes >= 60 || seconds >= 60) return null;
  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? total : null;
}
function formatPaceMinSec(secondsPerKm: number) {
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = Math.round(secondsPerKm % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
const HEALTH_CONDITIONS_TRACKED = [
  ['hipertensao', 'Hipertensao'], ['diabetes', 'Diabetes'], ['colesterol', 'Colesterol elevado'], ['obesidade', 'Obesidade'],
  ['asma', 'Asma'], ['cardiaco', 'Problemas cardiacos'], ['artrose', 'Artrose'], ['artrite', 'Artrite'], ['hernia_disco', 'Hernia de disco'],
];
const ratingPrompts = [
  ['rating_energy', 'Energia no dia a dia'], ['rating_training_readiness', 'Disposicao para treinar'], ['rating_fitness', 'Condicionamento fisico'],
  ['rating_strength', 'Forca fisica'], ['rating_sleep', 'Qualidade do sono'], ['rating_recovery', 'Recuperacao apos os treinos'],
  ['rating_stress', 'Nivel de estresse'], ['rating_anxiety', 'Nivel de ansiedade'], ['rating_motivation', 'Motivacao para treinar'],
  ['rating_nutrition', 'Qualidade da alimentacao'], ['rating_hydration', 'Hidratacao'], ['rating_health', 'Saude geral'],
  ['rating_pain_free', 'Quanto seu corpo esta livre de dores'], ['rating_body_satisfaction', 'Satisfacao com seu corpo'],
  ['rating_quality_of_life', 'Qualidade de vida'], ['rating_goal_confidence', 'Confianca de que conseguira atingir seu objetivo'],
  ['rating_routine_support', 'Quanto sua rotina atual favorece seu objetivo'],
];
const weekInterviewDays = [
  ['monday', 'Segunda-feira'], ['tuesday', 'Terca-feira'], ['wednesday', 'Quarta-feira'], ['thursday', 'Quinta-feira'],
  ['friday', 'Sexta-feira'], ['saturday', 'Sabado'], ['sunday', 'Domingo'],
];

const interviewQuestions: InterviewQuestion[] = [
  { key: 'objective', module: 'Objetivo', prompt: 'Qual e seu principal objetivo?', type: 'dropdown_single', options: [
    option('Comecar a correr'), option('Completar 5 km'), option('Melhorar meu tempo nos 5 km'), option('Completar 10 km'),
    option('Melhorar meu tempo nos 10 km'), option('Completar 21 km'), option('Melhorar meu tempo nos 21 km'),
    option('Completar 42 km'), option('Melhorar meu tempo nos 42 km'),
  ] },
  { key: 'running_experience', module: 'Experiencia com corrida', prompt: 'Qual opcao melhor descreve sua experiencia com corrida?', type: 'single', help: 'Preste atencao no tempo verbal: "corria" = voce parou; "corro" = voce ainda esta correndo hoje.', options: [
    option('Nunca tentei correr.'), option('Ja tentei correr, mas nunca consegui manter uma rotina.'),
    option('Corria regularmente, mas parei ha mais de 2 anos.'), option('Corria regularmente, mas parei entre 1 e 2 anos atras.'),
    option('Corria regularmente, mas parei entre 6 meses e 1 ano atras.'), option('Corria regularmente, mas parei ha menos de 6 meses.'),
    option('Corro atualmente, comecei ha menos de 3 meses.', 'currently_lt_3m'),
    option('Corro atualmente, comecei ha menos de 6 meses.', 'currently_lt_6m'),
    option('Corro atualmente, comecei ha menos de 1 ano.', 'currently_lt_1y'),
    option('Corro atualmente, comecei ha mais de 1 ano.', 'currently_gt_1y'),
  ] },
  { key: 'longest_distance', module: 'Experiencia com corrida', prompt: 'Qual a maior distancia que voce corre atualmente sem precisar parar ou caminhar, somente correndo, nos ultimos 6 meses?', type: 'wheel_number', wheelDigits: 3, wheelMin: 1, wheelMax: 300, wheelUnit: 'km', help: 'Nao vale treino com corrida alternada com caminhada.', condition: (a) => isCurrentlyRunning(a) },
  { key: 'longest_distance_recent_count', module: 'Experiencia com corrida', prompt: 'Quantas vezes voce correu essa distancia nos ultimos 6 meses?', type: 'wheel_number', wheelDigits: 2, wheelMin: 1, wheelMax: 99, wheelUnit: 'vezes', condition: (a) => isCurrentlyRunning(a) },
  { key: 'longest_distance_recent_time', module: 'Experiencia com corrida', prompt: 'Qual foi o seu tempo nessa distancia?', type: 'wheel_duration_hms', help: 'Vamos calcular seu pace medio automaticamente com esse tempo, para ajudar (nao definir sozinho) a escolher seus ritmos de treino ate voce fazer o teste oficial de 3 km.', condition: (a) => isCurrentlyRunning(a) },
  { key: 'second_longest_distance_recent', module: 'Experiencia com corrida', prompt: 'Qual a segunda maior distancia que voce corre atualmente sem precisar parar ou caminhar, somente correndo, nos ultimos 6 meses?', type: 'wheel_number', optional: true, wheelDigits: 3, wheelMin: 1, wheelMax: 300, wheelUnit: 'km', help: 'Nao vale treino com corrida alternada com caminhada.', condition: (a) => isCurrentlyRunning(a) },
  { key: 'second_longest_distance_recent_count', module: 'Experiencia com corrida', prompt: 'Quantas vezes voce correu essa distancia nos ultimos 6 meses?', type: 'wheel_number', optional: true, wheelDigits: 2, wheelMin: 1, wheelMax: 99, wheelUnit: 'vezes', condition: (a) => isCurrentlyRunning(a) },
  { key: 'third_longest_distance_recent', module: 'Experiencia com corrida', prompt: 'Qual a terceira maior distancia que voce corre atualmente sem precisar parar ou caminhar, somente correndo, nos ultimos 6 meses?', type: 'wheel_number', optional: true, wheelDigits: 3, wheelMin: 1, wheelMax: 300, wheelUnit: 'km', help: 'Nao vale treino com corrida alternada com caminhada.', condition: (a) => isCurrentlyRunning(a) },
  { key: 'third_longest_distance_recent_count', module: 'Experiencia com corrida', prompt: 'Quantas vezes voce correu essa distancia nos ultimos 6 meses?', type: 'wheel_number', optional: true, wheelDigits: 2, wheelMin: 1, wheelMax: 99, wheelUnit: 'vezes', condition: (a) => isCurrentlyRunning(a) },
  { key: 'weekly_running_km', module: 'Experiencia com corrida', prompt: 'Em media, somando todos os treinos de corrida da semana, quantos quilometros voce corre por semana atualmente?', type: 'wheel_number', wheelDigits: 3, wheelMin: 1, wheelMax: 300, wheelUnit: 'km', help: 'Soma aproximada de uma semana normal recente. Isso ajuda o treinador a calibrar o volume dos seus treinos.', condition: (a) => isCurrentlyRunning(a) },
  { key: 'best_comfortable_pace', module: 'Experiencia com corrida', prompt: 'Qual seu pace confortavel atualmente?', type: 'wheel_pace', help: 'O ritmo que voce consegue manter com folga, numa corrida leve.', condition: (a) => isCurrentlyRunning(a) },
  { key: 'recent_running_feeling', module: 'Experiencia com corrida', prompt: 'Como voce se sentiu nessas corridas?', type: 'single', options: [option('Tranquila, consegui manter o ritmo com folga', 'tranquila'), option('Moderada, exigiu esforco mas terminei bem', 'moderada'), option('Dificil, precisei desacelerar ou parar algumas vezes', 'dificil'), option('Muito dificil, quase nao consegui terminar', 'muito_dificil')], condition: (a) => isCurrentlyRunning(a) },
  { key: 'fitness_self_rating', module: 'Experiencia com corrida', prompt: 'Como voce classificaria seu condicionamento para corrida hoje?', type: 'single', options: [option('Muito leve', 'muito_leve'), option('Leve', 'leve'), option('Moderado', 'moderado'), option('Forte', 'forte'), option('Muito forte', 'muito_forte')], condition: (a) => !isCurrentlyRunning(a) },
  { key: 'races_last_12_months', module: 'Experiencia com corrida', prompt: 'Nos ultimos 6 meses, quantas provas voce participou?', type: 'wheel_number', wheelDigits: 2, wheelMin: 0, wheelMax: 50, wheelUnit: 'provas', condition: (a) => isCurrentlyRunning(a) },
  { key: 'current_activities', module: 'Experiencia com corrida', prompt: 'Quais atividades fisicas voce pratica atualmente?', type: 'dropdown_multi', options: [...activityOptions, 'Nenhuma'].map((v) => option(v)) },
  { key: 'favorite_activities', module: 'Experiencia com corrida', prompt: 'Quais atividades fisicas voce mais gosta de praticar?', type: 'dropdown_multi', options: activityOptions.map((v) => option(v)) },
  { key: 'strength_experience', module: 'Treinamento de forca', prompt: 'Qual sua experiencia com musculacao?', type: 'dropdown_single', options: ['Nunca fiz.', 'Ja fiz poucas vezes.', 'Ja treinei no passado, mas parei.', 'Estou voltando agora.', 'Treino ha menos de 1 ano.', 'Treino entre 1 e 3 anos.', 'Treino ha mais de 3 anos.'].map((v) => option(v)) },
  { key: 'training_consistency', module: 'Treinamento de forca', prompt: 'Como costuma ser sua frequencia nos treinos?', type: 'dropdown_single', options: ['Sempre comeco e abandono.', 'Costumo faltar bastante.', 'Oscilo durante o ano.', 'Sou relativamente consistente.', 'Raramente deixo de treinar.'].map((v) => option(v)) },
  { key: 'pushups', module: 'Treinamento de forca', prompt: 'Quantas flexoes de braco voce consegue fazer continuamente?', type: 'wheel_number', wheelDigits: 3, wheelMin: 0, wheelMax: 200, wheelUnit: 'flexoes' },
  { key: 'squat_experience', module: 'Treinamento de forca', prompt: 'Em relacao ao agachamento, qual opcao melhor descreve voce?', type: 'dropdown_single', options: ['Nunca fiz agachamento.', 'Faco apenas com o peso do corpo.', 'Faco com halteres leves.', 'Faco com barra e carga moderada.', 'Faco com cargas elevadas.', 'Nao sei responder.'].map((v) => option(v)) },
  { key: 'perceived_strength', module: 'Treinamento de forca', prompt: 'Como voce considera sua forca atualmente?', type: 'dropdown_single', options: ['Muito abaixo da media.', 'Abaixo da media.', 'Na media.', 'Acima da media.', 'Muito acima da media.', 'Nao sei responder.'].map((v) => option(v)) },
  { key: 'rating_intro', module: 'Autoavaliacao', prompt: 'Nas proximas perguntas, de uma nota de 1 a 10.\n\n1 representa uma condicao muito ruim.\n10 representa uma condicao excelente.', type: 'notice' },
  ...ratingPrompts.map(([key, prompt]) => ({ key, module: 'Autoavaliacao', prompt, type: 'scale' as const })),
  { key: 'current_pain', module: 'Saude', prompt: 'Voce sente alguma dor atualmente?', type: 'single', options: [option('Nao', 'no'), option('Sim', 'yes')] },
  { key: 'pain_regions', module: 'Saude', prompt: 'Em quais regioes voce sente dor? Pode marcar mais de uma.', type: 'multi', condition: (a) => a.current_pain === 'yes', options: [
    'Joelho direito', 'Joelho esquerdo', 'Tornozelo direito', 'Tornozelo esquerdo', 'Pe direito', 'Pe esquerdo',
    'Canela direita', 'Canela esquerda', 'Panturrilha direita', 'Panturrilha esquerda', 'Coxa direita', 'Coxa esquerda',
    'Quadril direito', 'Quadril esquerdo', 'Gluteo direito', 'Gluteo esquerdo', 'Lombar/coluna', 'Nao sei responder',
  ].map((v) => option(v)) },
  { key: 'pain_detail_knee', module: 'Saude', prompt: 'Sobre a dor no joelho: em qual parte especificamente?', type: 'multi', optional: true, condition: (a) => Array.isArray(a.pain_regions) && (a.pain_regions.includes('Joelho direito') || a.pain_regions.includes('Joelho esquerdo')), options: ['Lado externo', 'Lado interno', 'Abaixo da patela (tendao patelar)', 'Na frente da patela', 'Atras do joelho', 'Nao sei especificar'].map((v) => option(v)) },
  { key: 'pain_detail_ankle', module: 'Saude', prompt: 'Sobre a dor no tornozelo: em qual parte especificamente?', type: 'multi', optional: true, condition: (a) => Array.isArray(a.pain_regions) && (a.pain_regions.includes('Tornozelo direito') || a.pain_regions.includes('Tornozelo esquerdo')), options: ['Lado externo', 'Lado interno', 'Atras (tendao de Aquiles)', 'Na frente', 'Nao sei especificar'].map((v) => option(v)) },
  { key: 'pain_detail_foot', module: 'Saude', prompt: 'Sobre a dor no pe: em qual parte especificamente?', type: 'multi', optional: true, condition: (a) => Array.isArray(a.pain_regions) && (a.pain_regions.includes('Pe direito') || a.pain_regions.includes('Pe esquerdo')), options: ['Sola - meio do pe (arco)', 'Sola - perto do calcanhar', 'Lado externo do pe', 'Lado interno do pe', 'Dedos', 'Parte de cima do pe', 'Nao sei especificar'].map((v) => option(v)) },
  { key: 'pain_detail_shin', module: 'Saude', prompt: 'Sobre a dor na canela: em qual parte especificamente?', type: 'multi', optional: true, condition: (a) => Array.isArray(a.pain_regions) && (a.pain_regions.includes('Canela direita') || a.pain_regions.includes('Canela esquerda')), options: ['Parte interna da canela', 'Parte da frente da canela', 'Ao longo de toda a canela', 'Nao sei especificar'].map((v) => option(v)) },
  { key: 'pain_detail_calf', module: 'Saude', prompt: 'Sobre a dor na panturrilha: em qual parte especificamente?', type: 'multi', optional: true, condition: (a) => Array.isArray(a.pain_regions) && (a.pain_regions.includes('Panturrilha direita') || a.pain_regions.includes('Panturrilha esquerda')), options: ['Parte de cima', 'Parte de baixo (perto do tendao)', 'Lado interno', 'Lado externo', 'Nao sei especificar'].map((v) => option(v)) },
  { key: 'pain_detail_thigh', module: 'Saude', prompt: 'Sobre a dor na coxa: em qual parte especificamente?', type: 'multi', optional: true, condition: (a) => Array.isArray(a.pain_regions) && (a.pain_regions.includes('Coxa direita') || a.pain_regions.includes('Coxa esquerda')), options: ['Frente da coxa (quadriceps)', 'Atras da coxa (posterior)', 'Lado externo (banda iliotibial)', 'Lado interno (adutores)', 'Nao sei especificar'].map((v) => option(v)) },
  { key: 'pain_detail_hip', module: 'Saude', prompt: 'Sobre a dor no quadril: em qual parte especificamente?', type: 'multi', optional: true, condition: (a) => Array.isArray(a.pain_regions) && (a.pain_regions.includes('Quadril direito') || a.pain_regions.includes('Quadril esquerdo')), options: ['Lado externo do quadril', 'Virilha', 'Na frente do quadril', 'Nao sei especificar'].map((v) => option(v)) },
  { key: 'pain_detail_glute', module: 'Saude', prompt: 'Sobre a dor no gluteo: em qual parte especificamente?', type: 'multi', optional: true, condition: (a) => Array.isArray(a.pain_regions) && (a.pain_regions.includes('Gluteo direito') || a.pain_regions.includes('Gluteo esquerdo')), options: ['Fundo do gluteo', 'Lateral do gluteo', 'Perto do osso do quadril', 'Nao sei especificar'].map((v) => option(v)) },
  { key: 'pain_detail_lower_back', module: 'Saude', prompt: 'Sobre a dor lombar: em qual parte especificamente?', type: 'multi', optional: true, condition: (a) => Array.isArray(a.pain_regions) && a.pain_regions.includes('Lombar/coluna'), options: ['Lado direito', 'Lado esquerdo', 'Centro', 'Irradia para a perna', 'Nao sei especificar'].map((v) => option(v)) },
  { key: 'pain_other_location', module: 'Saude', prompt: 'Sente dor em algum outro local que nao esta na lista acima?', type: 'text', optional: true, condition: (a) => a.current_pain === 'yes' },
  { key: 'diagnosed_running_conditions', module: 'Saude', prompt: 'Voce ja recebeu diagnostico de alguma dessas condicoes comuns em corredores? Pode marcar mais de uma.', type: 'multi', optional: true, options: [
    'Sindrome da banda iliotibial (joelho do corredor)', 'Sindrome da dor patelofemoral', 'Condromalacia patelar', 'Tendinopatia patelar (joelho do saltador)',
    'Tendinopatia do quadriceps', 'Sindrome da pata de ganso (bursite pes anserino)', 'Bursite pre-patelar', 'Fascite plantar', 'Esporao de calcaneo',
    'Tendinopatia de Aquiles', 'Tendinopatia do tibial posterior', 'Canelite (sindrome do estresse tibial medial)', 'Sindrome do compartimento tibial anterior',
    'Fratura por estresse', 'Neuroma de Morton', 'Metatarsalgia', 'Entorse de tornozelo (ligamentos)', 'Instabilidade cronica de tornozelo',
    'Sindrome do tunel do tarso', 'Bursite trocanterica', 'Sindrome do piriforme', 'Tendinopatia dos isquiotibiais', 'Distensao muscular (estiramento)',
    'Ruptura ou lesao de menisco', 'Ruptura de ligamento do joelho (LCA/LCM/LCL)', 'Artrose de joelho', 'Artrose de quadril', 'Bursite isquiatica',
    'Distensao do adutor (virilha)', 'Lombalgia mecanica', 'Hernia de disco', 'Protrusao discal', 'Dor ciatica (ciatalgia)',
    'Nenhuma', 'Nao sei responder',
  ].map((v) => option(v)) },
  { key: 'diagnosed_running_conditions_other', module: 'Saude', prompt: 'Algum outro diagnostico que nao esta na lista acima?', type: 'text', optional: true },
  { key: 'important_injury', module: 'Saude', prompt: 'Voce ja teve alguma lesao importante?', type: 'dropdown_single', options: ['Nunca.', 'Sim, totalmente recuperado.', 'Sim, ainda tenho limitacoes.'].map((v) => option(v)) },
  { key: 'injury_description', module: 'Saude', prompt: 'Descreva brevemente a lesao e suas limitacoes (comentario opcional).', type: 'text', optional: true, condition: (a) => a.important_injury !== 'Nunca.' },
  { key: 'health_conditions', module: 'Saude', prompt: 'Voce possui alguma destas condicoes?', type: 'multi', help: 'Voce pode marcar mais de uma opcao.', options: ['Hipertensao', 'Diabetes', 'Colesterol elevado', 'Obesidade', 'Asma', 'Problemas cardiacos', 'Artrose', 'Artrite', 'Hernia de disco', 'Nenhuma', 'Outra'].map((v) => option(v)) },
  { key: 'health_conditions_other', module: 'Saude', prompt: 'Qual outra condicao?', type: 'text', optional: true, condition: (a) => Array.isArray(a.health_conditions) && a.health_conditions.includes('Outra') },
  ...HEALTH_CONDITIONS_TRACKED.map(([slug, label]) => ({
    key: `health_condition_status_${slug}`,
    module: 'Saude',
    prompt: `Sobre ${label.toLowerCase()}: voce esta com isso atualmente ou foi diagnosticado no passado e nao tem mais?`,
    type: 'dropdown_single' as const,
    options: [option('Tenho atualmente', 'current'), option('Tive no passado, nao tenho mais', 'past')],
    condition: (a: InterviewAnswers) => Array.isArray(a.health_conditions) && a.health_conditions.includes(label),
  })),
  { key: 'continuous_medications', module: 'Saude', prompt: 'Faz uso continuo de medicamentos?', type: 'text', optional: true },
  { key: 'medical_recommendation', module: 'Saude', prompt: 'Existe alguma recomendacao medica para seus treinos?', type: 'text', optional: true },
  { key: 'personal_height', module: 'Avaliacao fisica recente', prompt: 'Qual e sua altura em centimetros?', type: 'wheel_number', wheelDigits: 3, wheelMin: 100, wheelMax: 220, wheelUnit: 'cm' },
  { key: 'personal_weight', module: 'Avaliacao fisica recente', prompt: 'Qual e seu peso atual em quilogramas? Use virgula para decimais. Exemplo: 82,5.', type: 'number' },
  { key: 'body_fat_percentage', module: 'Avaliacao fisica recente', prompt: 'Percentual de gordura corporal (se souber)', type: 'number_or_unknown', optional: true },
  ...[
    ['waist_circumference', 'Circunferencia da cintura'], ['abdomen_circumference', 'Circunferencia do abdomen'], ['hip_circumference', 'Circunferencia do quadril'],
    ['arm_circumference', 'Circunferencia do braco'], ['thigh_circumference', 'Circunferencia da coxa'], ['calf_circumference', 'Circunferencia da panturrilha'],
  ].map(([key, prompt]) => ({
    key,
    module: 'Avaliacao fisica recente',
    prompt,
    type: 'wheel_number' as const,
    wheelDigits: 3,
    wheelMin: 30,
    wheelMax: 200,
    wheelUnit: 'cm',
    optional: true,
    help: 'Use uma fita metrica, sem apertar a pele, mantendo-a paralela ao chao e sem prender a respiracao. Registre em centimetros. Se preferir nao medir agora, pode deixar em branco e continuar.',
  })),
  {
    key: 'training_modality_preference',
    module: 'Rotina semanal',
    prompt: 'Alem da corrida, voce quer que a gente monte tambem treinos de fortalecimento para corredores e/ou musculacao?',
    type: 'dropdown_single',
    help: 'Voce pode treinar so corrida com a gente, ou incluir tambem fortalecimento para corredores e/ou musculacao na sua semana. Muitos alunos ja fazem musculacao ou treino de forca em outro lugar (academia, personal trainer) e preferem que a Panzeri Run cuide so da parte de corrida — sem problema nenhum escolher assim. Queremos montar exatamente o que faz sentido pra sua rotina.',
    options: [
      option('Somente corrida', 'somente_corrida'),
      option('Corrida + fortalecimento para corredores', 'corrida_fortalecimento'),
      option('Corrida + musculacao', 'corrida_musculacao'),
      option('Corrida + fortalecimento para corredores + musculacao', 'corrida_fortalecimento_musculacao'),
    ],
  },
  ...weekInterviewDays.flatMap(([key, label]) => [
    { key: `${key}_run_time`, module: 'Rotina semanal', prompt: `${label}: quanto tempo voce tem disponivel para corrida?`, type: 'single' as const, options: interviewTimeOptions },
    { key: `${key}_fortalecimento_time`, module: 'Rotina semanal', prompt: `${label}: quanto tempo voce tem para fortalecimento para corredores?`, type: 'single' as const, options: interviewTimeOptions, condition: (a: InterviewAnswers) => a.training_modality_preference === 'corrida_fortalecimento' || a.training_modality_preference === 'corrida_fortalecimento_musculacao' },
    { key: `${key}_musculacao_time`, module: 'Rotina semanal', prompt: `${label}: quanto tempo voce tem para musculacao?`, type: 'single' as const, options: interviewTimeOptions, condition: (a: InterviewAnswers) => a.training_modality_preference === 'corrida_musculacao' || a.training_modality_preference === 'corrida_fortalecimento_musculacao' },
    { key: `${key}_available_time`, module: 'Rotina semanal', prompt: `${label}: qual horario costuma estar disponivel?`, type: 'dropdown_single' as const, options: ['Antes das 6h', 'Entre 6h e 9h', 'Entre 9h e 12h', 'Entre 12h e 15h', 'Entre 15h e 18h', 'Apos 18h'].map((v) => option(v)), condition: (a: InterviewAnswers) => a[`${key}_run_time`] !== 'none' || a[`${key}_fortalecimento_time`] !== undefined && a[`${key}_fortalecimento_time`] !== 'none' || a[`${key}_musculacao_time`] !== undefined && a[`${key}_musculacao_time`] !== 'none' },
  ]),
  { key: 'sleep_hours', module: 'Habitos', prompt: 'Em media, quantas horas voce dorme?', type: 'single', options: ['Menos de 5 horas', 'Entre 5 e 6 horas', 'Entre 6 e 7 horas', 'Entre 7 e 8 horas', 'Mais de 8 horas'].map((v) => option(v)) },
  { key: 'smoking', module: 'Habitos', prompt: 'Voce fuma?', type: 'dropdown_single', options: [option('Nao'), option('Sim')] },
  { key: 'alcohol_frequency', module: 'Habitos', prompt: 'Com que frequencia voce consome bebida alcoolica?', type: 'dropdown_single', options: ['Nunca', 'Raramente', 'Semanalmente', 'Algumas vezes por semana', 'Quase todos os dias'].map((v) => option(v)) },
  { key: 'work_routine', module: 'Habitos', prompt: 'Como e sua rotina de trabalho?', type: 'dropdown_single', options: ['Predominantemente sentado', 'Predominantemente em pe', 'Trabalho fisico moderado', 'Trabalho fisico intenso', 'Aposentado', 'Outro'].map((v) => option(v)) },
  { key: 'daily_steps', module: 'Habitos', prompt: 'Em media, quantos passos voce da por dia?', type: 'wheel_number', wheelDigits: 5, wheelMin: 0, wheelMax: 99999, wheelUnit: 'passos' },
  { key: 'personal_name', module: 'Dados pessoais', prompt: 'Qual e seu nome completo?', type: 'text' },
  { key: 'personal_nickname', module: 'Dados pessoais', prompt: 'Como voce gostaria de ser chamado?', type: 'text', optional: true },
  { key: 'personal_phone', module: 'Dados pessoais', prompt: 'Qual e o seu WhatsApp (com DDD)?', type: 'phone', help: 'Usamos para avisos importantes sobre pagamento, treino e acompanhamento.' },
  { key: 'personal_birth_date', module: 'Dados pessoais', prompt: 'Qual e sua data de nascimento?', type: 'wheel_date' },
  { key: 'personal_sex', module: 'Dados pessoais', prompt: 'Como voce prefere informar seu sexo?', type: 'single', options: [option('Feminino'), option('Masculino'), option('Prefiro nao informar')] },
  { key: 'personal_cpf', module: 'Dados pessoais', prompt: 'Qual e o seu CPF?', type: 'cpf', help: 'Usamos para gerar a cobranca da assinatura com seguranca.' },
  { key: 'personal_education', module: 'Dados pessoais', prompt: 'Qual e a sua escolaridade?', type: 'dropdown_single', options: ['Fundamental incompleto', 'Fundamental completo', 'Medio incompleto', 'Medio completo', 'Superior incompleto', 'Superior completo', 'Pos-graduacao', 'Mestrado', 'Doutorado', 'PhD'].map((v) => option(v)) },
  { key: 'personal_cep', module: 'Dados pessoais', prompt: 'Qual e o seu CEP?', type: 'cep', help: 'Vamos buscar automaticamente rua, bairro, cidade e estado a partir do seu CEP.' },
  { key: 'personal_address_number', module: 'Dados pessoais', prompt: 'Qual e o numero da sua residencia?', type: 'text', condition: (a) => Boolean(a.personal_address_city) },
  { key: 'personal_address_complement', module: 'Dados pessoais', prompt: 'Complemento (apartamento, bloco, casa, etc)', type: 'text', optional: true, condition: (a) => Boolean(a.personal_address_city) },
  { key: 'additional_info', module: 'Informacoes adicionais', prompt: 'Escreva no campo abaixo todas as informacoes sobre voce que acredite ser relevante sabermos e que ainda nao perguntamos nessa entrevista.', type: 'text', optional: true },
];

const reassessmentQuestions: InterviewQuestion[] = [
  { key: 'reassessment_goal_change', module: 'Reavaliacao', prompt: 'Seu objetivo com a corrida continua o mesmo de antes?', type: 'single', options: [option('Sim, continua o mesmo', 'same'), option('Mudou', 'changed')] },
  { key: 'reassessment_goal_new', module: 'Reavaliacao', prompt: 'Qual e o seu objetivo agora?', type: 'text', condition: (a) => a.reassessment_goal_change === 'changed' },
  { key: 'reassessment_routine_change', module: 'Reavaliacao', prompt: 'Sua rotina (trabalho, tempo disponivel, dias livres) mudou desde a ultima avaliacao?', type: 'single', options: [option('Nao mudou', 'no'), option('Mudou um pouco', 'a_little'), option('Mudou bastante', 'a_lot')] },
  { key: 'reassessment_weekly_km_now', module: 'Reavaliacao', prompt: 'Em media, quantos quilometros voce corre por semana atualmente?', type: 'number', help: 'Some aproximadamente todos os treinos de corrida de uma semana normal recente.' },
  { key: 'reassessment_perceived_evolution', module: 'Reavaliacao', prompt: 'Comparando com a ultima avaliacao, como voce sente sua evolucao na corrida?', type: 'single', options: [option('Piorou', 'piorou'), option('Continua igual', 'igual'), option('Melhorou um pouco', 'melhorou_pouco'), option('Melhorou bastante', 'melhorou_muito')] },
  { key: 'reassessment_satisfaction', module: 'Reavaliacao', prompt: 'Como voce avalia sua satisfacao com os treinos neste periodo?', type: 'single', options: [option('Muito insatisfeito', 'muito_insatisfeito'), option('Insatisfeito', 'insatisfeito'), option('Neutro', 'neutro'), option('Satisfeito', 'satisfeito'), option('Muito satisfeito', 'muito_satisfeito')] },
  { key: 'reassessment_new_pain', module: 'Reavaliacao', prompt: 'Voce sentiu alguma dor ou teve alguma lesao nova desde a ultima avaliacao?', type: 'single', options: [option('Nao', 'no'), option('Sim', 'yes')] },
  { key: 'reassessment_new_pain_detail', module: 'Reavaliacao', prompt: 'Descreva a dor ou limitacao que voce sentiu.', type: 'text', condition: (a) => a.reassessment_new_pain === 'yes' },
  { key: 'reassessment_weight', module: 'Reavaliacao', prompt: 'Qual e o seu peso atual em quilogramas? Use virgula para decimais. Exemplo: 82,5.', type: 'number', optional: true },
  { key: 'reassessment_notes', module: 'Reavaliacao', prompt: 'Quer contar mais alguma coisa para o seu treinador?', type: 'text', optional: true },
];

const weekSessions = [
  {
    day: 'Seg',
    date: '22/06',
    title: 'Forca geral',
    detail: '45 min - RPE 7',
    icon: 'barbell' as const,
    modality: 'forca',
    zone: 'Base',
  },
  {
    day: 'Ter',
    date: '23/06',
    title: 'Corrida leve',
    detail: '35 min - Z2',
    icon: 'walk' as const,
    modality: 'corrida',
    zone: 'Z2',
  },
  {
    day: 'Qua',
    date: '24/06',
    title: 'Sem treino',
    detail: 'Recuperacao',
    icon: 'moon' as const,
    modality: 'descanso',
    zone: 'Off',
  },
  {
    day: 'Qui',
    date: '25/06',
    title: 'Intervalado curto',
    detail: '42 min - Z4/Z5',
    icon: 'flash' as const,
    modality: 'corrida',
    zone: 'Z4',
  },
  {
    day: 'Sab',
    date: '27/06',
    title: 'Longao leve',
    detail: '55 min - Z2',
    icon: 'trail-sign' as const,
    modality: 'corrida',
    zone: 'Z2',
  },
];

function AppInner() {
  const [screen, setScreen] = useState<Screen>('login');
  const [isRestoringSession, setIsRestoringSession] = useState(true);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedExerciseResponsibility, setAcceptedExerciseResponsibility] = useState(false);
  const [exerciseResponsibilityRequired, setExerciseResponsibilityRequired] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('week');
  const [menuOpen, setMenuOpen] = useState(false);
  const [restartInterviewFromStart, setRestartInterviewFromStart] = useState(false);
  const [completedToday, setCompletedToday] = useState(false);
  const [threeKmSeconds, setThreeKmSeconds] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [anamneseRoutine, setAnamneseRoutine] = useState<RoutineDay[]>(cloneRoutine(defaultRoutineDays));
  const [savedMe, setSavedMe] = useState<MeResponse | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [hideWeekNotifications, setHideWeekNotifications] = useState(false);

  const metrics = useMemo(() => calculateThreeKmMetrics(Number(threeKmSeconds)), [threeKmSeconds]);

  // A tela Semana usa anamneseRoutine (carregado uma vez por sessao) como estado inicial da
  // rotina. Se a entrevista/reavaliacao for concluida no meio da sessao e essa copia local nao
  // for atualizada, a proxima vez que a aba Semana ou Perfil salvar a rotina, ela reenvia os
  // dados antigos e apaga silenciosamente a disponibilidade recem-informada na entrevista.
  async function refreshRoutineFromServer() {
    const me = await loadSavedMe(accessToken);
    if (!me) return;
    setSavedMe(me);
    const savedRoutine = routineFromSavedAvailability(me.availability ?? me.weeklyAvailability ?? []);
    if (savedRoutine.length) setAnamneseRoutine(savedRoutine);
  }

  useEffect(() => {
    registerWebApp();
  }, []);

  useEffect(() => {
    restoreAuthSession().then((session) => {
      if (session) {
        applyAuthSession(session);
      }
      setIsRestoringSession(false);
    });
  }, []);

  useEffect(() => {
    if (!refreshToken) {
      return;
    }

    const timer = setInterval(() => {
      refreshAuthSession(refreshToken, { email: userEmail, name: userName, accessToken, refreshToken }).then((session) => {
        if (session) {
          applyAuthSession(session);
        }
      });
    }, 12 * 60 * 1000);

    return () => clearInterval(timer);
  }, [refreshToken, userEmail, userName]);

  function applyAuthSession(session: AuthSession) {
    setUserEmail(session.email);
    setUserName(session.name);
    setAccessToken(session.accessToken);
    setRefreshToken(session.refreshToken);
    setActiveTab('week');
    setScreen('app');
    void AsyncStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
  }

  function logout() {
    setAccessToken('');
    setRefreshToken('');
    setUserEmail('');
    setUserName('');
    setExerciseResponsibilityRequired(false);
    setMenuOpen(false);
    setScreen('login');
    void AsyncStorage.removeItem(AUTH_SESSION_KEY);
  }

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    loadSavedMe(accessToken).then((me) => {
      if (!me) {
        return;
      }

      setSavedMe(me);
      setExerciseResponsibilityRequired(!me.acceptedExerciseResponsibilityAt);
      if (me.name) {
        setUserName(me.name);
      }
      if (me.email) {
        setUserEmail(me.email);
      }
      const latestTestSeconds = me.tests?.[0]?.totalSeconds ?? me.fitnessTests?.[0]?.totalSeconds;
      if (latestTestSeconds) {
        setThreeKmSeconds(String(latestTestSeconds));
      }
      const savedRoutine = routineFromSavedAvailability(me.availability ?? me.weeklyAvailability ?? []);
      if (savedRoutine.length) {
        setAnamneseRoutine(savedRoutine);
      }
    });
    Promise.all([loadNotifications(accessToken), loadDismissedNotifications()]).then(([items, dismissed]) => {
      setNotifications(items.filter((item) => !dismissed.includes(item.id)));
    });
    loadInterviewState(`${API_URL}/me/onboarding`, accessToken).then((interview) => {
      if (interview && !interview.completedAt) {
        setActiveTab('interview');
      }
    });
  }, [accessToken]);

  async function dismissNotification(id: string) {
    setNotifications((items) => items.filter((item) => item.id !== id));
    const dismissed = await loadDismissedNotifications();
    await AsyncStorage.setItem(DISMISSED_NOTIFICATIONS_KEY, JSON.stringify({ date: localDateKey(), ids: Array.from(new Set([...dismissed, id])) }));
  }

  if (isRestoringSession) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingState}>
          <Text style={styles.sectionLabel}>Panzeri Run</Text>
          <Text style={styles.statusMessage}>Abrindo aplicativo...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      {screen === 'login' && (
        <Login
          acceptedTerms={acceptedTerms}
          onTermsChange={setAcceptedTerms}
          acceptedExerciseResponsibility={acceptedExerciseResponsibility}
          onExerciseResponsibilityChange={setAcceptedExerciseResponsibility}
          onEnter={applyAuthSession}
        />
      )}
      {screen === 'app' && (
        <View style={styles.appShell}>
          <AppHeader userEmail={userEmail} userName={userName} objective={savedMe?.preferences?.mainGoal} onOpenMenu={() => setMenuOpen((open) => !open)} />
          {menuOpen ? (
            <AppMenu
              activeTab={activeTab}
              onLogout={logout}
              onChange={(tab) => {
                setActiveTab(tab);
                setMenuOpen(false);
              }}
            />
          ) : null}
          <ScrollView contentContainerStyle={styles.appContent}>
            {exerciseResponsibilityRequired ? (
              <ExerciseResponsibility
                accessToken={accessToken}
                onAccepted={() => setExerciseResponsibilityRequired(false)}
              />
            ) : (
              <>
            {activeTab === 'interview' && (
              <GuidedInterview
                accessToken={accessToken}
                userName={userName}
                onLater={() => setActiveTab('week')}
                onComplete={() => { setRestartInterviewFromStart(false); void refreshRoutineFromServer(); setActiveTab('test'); }}
                restartFromStart={restartInterviewFromStart}
              />
            )}
            {activeTab === 'reassessment' && (
              <GuidedInterview
                accessToken={accessToken}
                userName={userName}
                onLater={() => setActiveTab('week')}
                onComplete={() => { setRestartInterviewFromStart(false); void refreshRoutineFromServer(); setActiveTab('week'); }}
                questions={reassessmentQuestions}
                mode="reassessment"
                restartFromStart={restartInterviewFromStart}
              />
            )}
            {activeTab === 'fixAnswers' && (
              <FixAnswersMenu
                accessToken={accessToken}
                onOpenOnboarding={() => { setRestartInterviewFromStart(true); setActiveTab('interview'); }}
                onOpenReassessment={() => { setRestartInterviewFromStart(true); setActiveTab('reassessment'); }}
              />
            )}
            {activeTab === 'anamnese' && (
              <Anamnese
                accessToken={accessToken}
                userEmail={userEmail}
                userName={userName}
                savedMe={savedMe}
                onSavedMeChange={setSavedMe}
                onNameChange={setUserName}
                routineDays={anamneseRoutine}
                onRoutineChange={setAnamneseRoutine}
              />
            )}
            {activeTab === 'test' && (
              <ThreeKmTest
                threeKmSeconds={threeKmSeconds}
                onChangeSeconds={setThreeKmSeconds}
                metrics={metrics}
                accessToken={accessToken}
                latestTest={savedMe?.tests?.[0] ?? savedMe?.fitnessTests?.[0] ?? null}
                onLater={() => setActiveTab('week')}
                onSaved={() => {
                  setHideWeekNotifications(true);
                  setActiveTab('week');
                }}
              />
            )}
            {activeTab === 'week' && (
              <>
                {!hideWeekNotifications ? <NotificationList notifications={notifications} accessToken={accessToken} onDismiss={dismissNotification} /> : null}
                <Week
                  accessToken={accessToken}
                  baseRoutineDays={anamneseRoutine}
                  metrics={metrics}
                  onOpenInterview={() => setActiveTab('interview')}
                  onOpenTest={() => setActiveTab('test')}
                  onPlanStateChange={(state) => setHideWeekNotifications(state.locked || state.requiresTest || state.requiresOnboarding)}
                />
              </>
            )}
            {activeTab === 'progress' && <Progress completedToday={completedToday} metrics={metrics} accessToken={accessToken} />}
            {activeTab === 'targetRace' && <TargetRaceScreen accessToken={accessToken} />}
            {activeTab === 'painReport' && <PainReportScreen accessToken={accessToken} />}
            {activeTab === 'strava' && <StravaSync accessToken={accessToken} />}
            {activeTab === 'billing' && <Billing accessToken={accessToken} />}
            {activeTab === 'profile' && (
              <Anamnese
                accessToken={accessToken}
                userEmail={userEmail}
                userName={userName}
                savedMe={savedMe}
                onSavedMeChange={setSavedMe}
                onNameChange={setUserName}
                routineDays={anamneseRoutine}
                onRoutineChange={setAnamneseRoutine}
              />
            )}
              </>
            )}
          </ScrollView>
        </View>
      )}
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}

function registerWebApp() {
  const browser = globalThis as unknown as {
    document?: {
      head?: { appendChild: (element: unknown) => void };
      querySelector: (selector: string) => unknown;
      createElement: (tag: string) => {
        rel?: string;
        href?: string;
        sizes?: string;
        name?: string;
        content?: string;
      };
    };
    navigator?: {
      serviceWorker?: {
        register: (path: string, options?: { updateViaCache?: 'none' }) => Promise<{ update?: () => Promise<void> }>;
      };
    };
  };

  if (browser.document && !browser.document.querySelector('link[rel="manifest"]')) {
    const manifest = browser.document.createElement('link');
    manifest.rel = 'manifest';
    manifest.href = '/manifest.json';
    browser.document.head?.appendChild(manifest);

    const theme = browser.document.createElement('meta');
    theme.name = 'theme-color';
    theme.content = '#0f766e';
    browser.document.head?.appendChild(theme);

    const iosCapable = browser.document.createElement('meta');
    iosCapable.name = 'apple-mobile-web-app-capable';
    iosCapable.content = 'yes';
    browser.document.head?.appendChild(iosCapable);

    const iosStatusBar = browser.document.createElement('meta');
    iosStatusBar.name = 'apple-mobile-web-app-status-bar-style';
    iosStatusBar.content = 'default';
    browser.document.head?.appendChild(iosStatusBar);

    const iosTitle = browser.document.createElement('meta');
    iosTitle.name = 'apple-mobile-web-app-title';
    iosTitle.content = 'Panzeri Run';
    browser.document.head?.appendChild(iosTitle);

    const iosIcon = browser.document.createElement('link');
    iosIcon.rel = 'apple-touch-icon';
    iosIcon.href = '/icon.svg';
    iosIcon.sizes = '512x512';
    browser.document.head?.appendChild(iosIcon);
  }

  browser.navigator?.serviceWorker
    ?.register('/sw.js', { updateViaCache: 'none' })
    .then((registration) => registration.update?.())
    .catch(() => undefined);
}

function Onboarding({ onStart }: { onStart: () => void }) {
  return (
    <View style={[styles.screen, styles.onboardingScreen]}>
      <View style={styles.brandRow}>
        <View style={styles.logoMark}>
          <Ionicons name="pulse" size={24} color="#ffffff" />
        </View>
        <Text style={styles.brand}>Panzeri Run</Text>
      </View>

      <View style={styles.heroBlock}>
        <Text style={styles.heroEyebrow}>Corrida, forca e evolucao</Text>
        <Text style={styles.title}>Seu treino da semana, ajustado ao seu momento.</Text>
        <Text style={styles.heroCopy}>Entre, registre seus dados e acompanhe um plano simples de executar.</Text>
      </View>

      <View style={styles.startGrid}>
        <View style={styles.startItem}>
          <Ionicons name="calendar" size={22} color="#0f766e" />
          <Text style={styles.startTitle}>Semana pronta</Text>
          <Text style={styles.startText}>Treinos claros para cada dia disponivel.</Text>
        </View>
        <View style={styles.startItem}>
          <Ionicons name="stopwatch" size={22} color="#0f766e" />
          <Text style={styles.startTitle}>Ritmos por teste</Text>
          <Text style={styles.startText}>Zonas calculadas pelo teste de 3 km.</Text>
        </View>
        <View style={styles.startItem}>
          <Ionicons name="stats-chart" size={22} color="#0f766e" />
          <Text style={styles.startTitle}>Evolucao visivel</Text>
          <Text style={styles.startText}>Acompanhe consistencia, treinos e marcas.</Text>
        </View>
      </View>

      <Pressable style={styles.heroButton} onPress={onStart}>
        <Text style={styles.primaryButtonText}>Entrar no app</Text>
        <Ionicons name="arrow-forward" size={18} color="#ffffff" />
      </Pressable>

      <Text style={styles.safetyFootnote}>Treine com seguranca. Em caso de dor ou sintomas, procure avaliacao profissional.</Text>
    </View>
  );
}

function SecureTextInput({ placeholder, value, onChangeText }: { placeholder: string; value: string; onChangeText: (value: string) => void }) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={styles.secureInputWrap}>
      <TextInput style={[styles.input, styles.secureInput]} placeholder={placeholder} value={value} onChangeText={onChangeText} secureTextEntry={!visible} />
      <Pressable style={styles.showPasswordButton} onPress={() => setVisible((current) => !current)}>
        <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={18} color="#0f766e" />
        <Text style={styles.showPasswordText}>{visible ? 'Ocultar' : 'Ver'}</Text>
      </Pressable>
    </View>
  );
}
function Login({
  acceptedTerms,
  onTermsChange,
  acceptedExerciseResponsibility,
  onExerciseResponsibilityChange,
  onEnter,
}: {
  acceptedTerms: boolean;
  onTermsChange: (value: boolean) => void;
  acceptedExerciseResponsibility: boolean;
  onExerciseResponsibilityChange: (value: boolean) => void;
  onEnter: (session: AuthSession) => void;
}) {
  const [mode, setMode] = useState<AuthMode>(initialAuthMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [status, setStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function forgotPassword() {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setStatus('Informe seu e-mail primeiro.');
      return;
    }

    setStatus('Solicitando recuperacao...');
    try {
      const response = await fetch(`${API_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail }),
      });

      if (!response.ok) {
        setStatus('Nao consegui solicitar recuperacao.');
        return;
      }

      setStatus('Solicite ao treinador um link seguro para criar uma nova senha.');
    } catch {
      setStatus('Nao consegui conectar com a API agora.');
    }
  }

  async function submit(mode: AuthMode) {
    const cleanEmail = email.trim().toLowerCase();
    setStatus('');

    if (!cleanEmail || password.length < 8) {
      setStatus('Preencha e-mail e uma senha com pelo menos 8 caracteres.');
      return;
    }

    if (mode === 'register' && !name.trim()) {
      setStatus('Preencha seu nome para criar a conta.');
      return;
    }

    if (mode === 'register' && password !== passwordConfirm) {
      setStatus('A confirmacao de senha precisa ser igual a senha.');
      return;
    }

    if (mode === 'register' && !acceptedTerms) {
      setStatus('Aceite os termos para criar a conta.');
      return;
    }

    if (mode === 'register' && !acceptedExerciseResponsibility) {
      setStatus('Confirme a declaracao de aptidao e responsabilidade.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'login') {
        const loginResponse = await fetch(`${API_URL}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: cleanEmail,
            password,
          }),
        });

        if (!loginResponse.ok) {
          setStatus((await extractErrorMessage(loginResponse)) ?? 'Nao consegui entrar. Confira e-mail e senha.');
          return;
        }

        const data = (await loginResponse.json()) as AuthResponse;
        if (data.user?.role && data.user.role !== 'student') {
          setStatus('Este acesso e do treinador. Use o painel web.');
          return;
        }

        const accessToken = data.tokens?.accessToken;
        if (!accessToken) {
          setStatus('Login feito, mas nao recebi a liberacao de acesso.');
          return;
        }

        setStatus('Login realizado.');
        const refreshToken = data.tokens?.refreshToken;
        if (!refreshToken) {
          setStatus('Login feito, mas nao recebi a renovacao de acesso.');
          return;
        }
        onEnter({ email: data.user?.email ?? cleanEmail, name: data.user?.name ?? '', accessToken, refreshToken });
        return;
      }

      const registerResponse = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: cleanEmail,
          password,
          acceptedTerms,
          acceptedExerciseResponsibility,
        }),
      });

      if (!registerResponse.ok) {
        const message = await extractErrorMessage(registerResponse);
        setStatus(
          message === 'E-mail ja cadastrado.'
            ? 'Este e-mail ja tem uma conta. Toque em "Entrar" e use sua senha, ou em "Esqueci minha senha" se nao lembrar.'
            : message ?? 'Nao consegui criar a conta.',
        );
        return;
      }

      const data = (await registerResponse.json()) as AuthResponse;
      if (data.user?.role && data.user.role !== 'student') {
        setStatus('Este acesso e do treinador. Use o painel web.');
        return;
      }

      const accessToken = data.tokens?.accessToken;
      if (!accessToken) {
        setStatus('Conta criada, mas nao recebi a liberacao de acesso.');
        return;
      }

      setStatus('Conta criada com sucesso.');
      const refreshToken = data.tokens?.refreshToken;
      if (!refreshToken) {
        setStatus('Conta criada, mas nao recebi a renovacao de acesso.');
        return;
      }
      onEnter({ email: data.user?.email ?? cleanEmail, name: data.user?.name ?? name.trim(), accessToken, refreshToken });
    } catch {
      setStatus('Nao consegui conectar com a API agora.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.brandRow}>
        <View style={styles.logoMark}>
          <Ionicons name="pulse" size={24} color="#ffffff" />
        </View>
        <Text style={styles.brand}>Panzeri Run</Text>
      </View>

      <Text style={styles.sectionLabel}>Conta</Text>
      <Text style={styles.titleSmall}>{mode === 'login' ? 'Entrar' : 'Criar conta'}</Text>

      {mode === 'register' && (
        <View style={styles.earlyStudentNotice}>
          <Text style={styles.earlyStudentNoticeTitle}>Bem-vindo ao Panzeri Run</Text>
          <Text style={styles.earlyStudentNoticeText}>
            Parabéns por entrar para o Panzeri Run. Você é um de nossos primeiros alunos e isso é uma honra. Caso tenha algum problema de acesso, pode chamar diretamente pelo WhatsApp do Elton (31) 99253-8375. Ele responderá o mais breve possível.
          </Text>
          <Pressable style={styles.whatsAppButton} onPress={() => Linking.openURL('https://wa.me/5531992538375')}>
            <Ionicons name="logo-whatsapp" size={18} color="#0f766e" />
            <Text style={styles.whatsAppButtonText}>Falar com Elton pelo WhatsApp</Text>
          </Pressable>
        </View>
      )}

      {mode === 'register' && (
        <TextInput style={styles.input} placeholder="Nome completo" value={name} onChangeText={setName} />
      )}
      <TextInput
        style={styles.input}
        placeholder="E-mail"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <SecureTextInput placeholder="Senha" value={password} onChangeText={setPassword} />

      {mode === 'register' && (
        <>
          <SecureTextInput placeholder="Confirmacao de senha" value={passwordConfirm} onChangeText={setPasswordConfirm} />

          <View style={styles.termsRow}>
            <Switch value={acceptedTerms} onValueChange={onTermsChange} />
            <Text style={styles.termsText}>
              Aceito os termos de uso, a politica de privacidade e autorizo o uso dos meus dados de saude e treino para prescricao e acompanhamento.
            </Text>
          </View>
          <View style={styles.termsRow}>
            <Switch value={acceptedExerciseResponsibility} onValueChange={onExerciseResponsibilityChange} />
            <Text style={styles.termsText}>
              Declaro que as informacoes fornecidas sao verdadeiras, que estou apto a praticar exercicios fisicos sem comprometer minha saude e que devo interromper o treino e buscar avaliacao profissional diante de dor, mal-estar ou qualquer sinal de risco.
            </Text>
          </View>
        </>
      )}

      <View style={styles.authActions}>
        <Pressable
          style={[styles.primaryButton, styles.authButton, isSubmitting && styles.disabledButton]}
          disabled={isSubmitting}
          onPress={() => submit(mode)}
        >
          <Text style={styles.primaryButtonText}>{isSubmitting ? 'Conectando...' : mode === 'login' ? 'Entrar' : 'Criar conta'}</Text>
          <Ionicons name={mode === 'login' ? 'log-in-outline' : 'person-add'} size={18} color="#ffffff" />
        </Pressable>

        <Pressable
          style={[styles.secondaryOutlineButton, styles.authButton, isSubmitting && styles.disabledButton]}
          disabled={isSubmitting}
          onPress={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          <Text style={styles.secondaryOutlineButtonText}>{mode === 'login' ? 'Criar conta' : 'Ja tenho conta'}</Text>
          <Ionicons name={mode === 'login' ? 'person-add' : 'log-in-outline'} size={18} color="#0f766e" />
        </Pressable>
      </View>

      {status ? <Text style={styles.statusMessage}>{status}</Text> : null}

      <Pressable style={styles.secondaryButton} onPress={forgotPassword}>
        <Text style={styles.secondaryButtonText}>Esqueci minha senha</Text>
      </Pressable>
    </ScrollView>
  );
}

function ExerciseResponsibility({ accessToken, onAccepted }: { accessToken: string; onAccepted: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  async function accept() {
    if (!confirmed) {
      setStatus('Marque a declaracao para continuar.');
      return;
    }
    setSaving(true);
    setStatus('');
    try {
      const response = await fetch(`${API_URL}/me/exercise-responsibility`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        setStatus(`Nao consegui registrar o aceite: ${await readApiError(response)}`);
        return;
      }
      onAccepted();
    } catch {
      setStatus('Sem conexao. Tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Saude e seguranca</Text>
      <Text style={styles.titleSmall}>Termo de responsabilidade</Text>
      <View style={styles.coachBox}>
        <Text style={styles.coachTitle}>Antes de iniciar seus treinos</Text>
        <Text style={styles.coachText}>Os treinos sao preparados com base nas informacoes fornecidas por voce. Respostas incompletas ou incorretas podem comprometer a seguranca e a adequacao do plano.</Text>
      </View>
      <View style={styles.termsRow}>
        <Switch value={confirmed} onValueChange={setConfirmed} />
        <Text style={styles.termsText}>Declaro que minhas informacoes sao verdadeiras, que estou apto a praticar exercicios fisicos sem comprometer minha saude e que interromperei a atividade e procurarei avaliacao profissional se sentir dor, tontura, falta de ar anormal, mal-estar ou outro sinal de risco.</Text>
      </View>
      <Pressable style={[styles.primaryButton, (!confirmed || saving) && styles.disabledButton]} disabled={!confirmed || saving} onPress={accept}>
        <Text style={styles.primaryButtonText}>{saving ? 'Registrando...' : 'Confirmar e continuar'}</Text>
        <Ionicons name="shield-checkmark" size={18} color="#fff" />
      </Pressable>
      {status ? <Text style={styles.statusMessage}>{status}</Text> : null}
    </View>
  );
}

function AppHeader({ userEmail, userName, objective, onOpenMenu }: { userEmail: string; userName: string; objective?: string | null; onOpenMenu: () => void }) {
  return (
    <View style={styles.appHeader}>
      <View>
        <Text style={styles.headerOverline}>Panzeri Run</Text>
        <Text style={styles.headerTitle}>{userName || 'Plano inicial 10 km'}</Text>
        {userEmail ? <Text style={styles.headerEmail}>{userEmail}</Text> : null}
        <Text style={styles.headerObjective}>Objetivo: {objective ? shortGoalLabel(objective) : 'ainda nao foi assinalado'}</Text>
      </View>
      <Pressable style={styles.menuButton} onPress={onOpenMenu}>
        <Ionicons name="menu" size={24} color="#ffffff" />
      </Pressable>
    </View>
  );
}

function NotificationList({ notifications, accessToken, onDismiss }: { notifications: AppNotification[]; accessToken: string; onDismiss: (id: string) => void }) {
  const visible = notifications.slice(0, 3);
  if (!visible.length) {
    return null;
  }

  return (
    <View style={styles.alertBox}>
      <Text style={styles.formSectionTitle}>Avisos</Text>
      <Text style={styles.formHint}>Arraste um aviso para o lado para remove-lo.</Text>
      {visible.map((notification) => (
        <DismissibleNotification notification={notification} accessToken={accessToken} onDismiss={onDismiss} key={notification.id} />
      ))}
    </View>
  );
}

function DismissibleNotification({ notification, accessToken, onDismiss }: { notification: AppNotification; accessToken: string; onDismiss: (id: string) => void }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const dismiss = () => {
    Animated.timing(translateX, { toValue: 500, duration: 180, useNativeDriver: true }).start(() => onDismiss(notification.id));
    void fetch(`${API_URL}/notifications/${notification.id}/read`, { method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}` } });
  };
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 8,
    onPanResponderMove: (_, gesture) => translateX.setValue(gesture.dx),
    onPanResponderRelease: (_, gesture) => {
      if (Math.abs(gesture.dx) > 80) dismiss();
      else Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
    },
  }), [notification.id]);
  return (
    <Animated.View style={[styles.alertItem, { transform: [{ translateX }] }]} {...panResponder.panHandlers}>
      <Text style={styles.alertTitle}>{notification.title}</Text>
      <Text style={styles.alertText}>{notification.message}</Text>
    </Animated.View>
  );
}

function Today({
  completedToday,
  onComplete,
}: {
  completedToday: boolean;
  onComplete: () => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.headerLine}>
        <View>
          <Text style={styles.sectionLabel}>Hoje</Text>
          <Text style={styles.titleSmall}>Treino do dia</Text>
        </View>
        <View style={[styles.statusPill, completedToday && styles.donePill]}>
          <Text style={[styles.statusText, completedToday && styles.doneText]}>
            {completedToday ? 'Feito' : 'Pendente'}
          </Text>
        </View>
      </View>

      <SessionCard
        icon="walk"
        title="Corrida leve com caminhada"
        detail="35 min - Z2 - conforto respiratorio"
        note="Aquecimento 8 min, bloco principal 22 min, desaquecimento 5 min. Se precisar, alternar 3 min correndo e 1 min caminhando."
      />
      <SessionCard
        icon="barbell"
        title="Forca geral"
        detail="3 series - RPE 7 - pausa 90s"
        note="Agachamento livre, ponte de gluteo, remada, prancha e panturrilha. Priorizar tecnica limpa."
      />

      <View style={styles.coachBox}>
        <Text style={styles.coachTitle}>Recomendacao do motor</Text>
        <Text style={styles.coachText}>
          Semana de adaptacao. Manter conforto respiratorio e registrar sensacao apos o treino.
        </Text>
      </View>

      <Pressable style={[styles.primaryButton, completedToday && styles.disabledButton]} onPress={onComplete}>
        <Text style={styles.primaryButtonText}>{completedToday ? 'Treino registrado' : 'Marcar como feito'}</Text>
        <Ionicons name="checkmark-circle" size={18} color="#ffffff" />
      </Pressable>
    </View>
  );
}

const WHEEL_ITEM_HEIGHT = 44;
const WHEEL_VISIBLE_ITEMS = 5;

function WheelColumn({ values, selectedIndex, onChangeIndex }: { values: string[]; selectedIndex: number; onChangeIndex: (index: number) => void }) {
  const scrollRef = useRef<ScrollView>(null);
  const paddingVertical = WHEEL_ITEM_HEIGHT * Math.floor(WHEEL_VISIBLE_ITEMS / 2);

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: selectedIndex * WHEEL_ITEM_HEIGHT, animated: false });
  }, [selectedIndex, values.length]);

  return (
    <View style={styles.wheelColumn}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM_HEIGHT}
        decelerationRate="fast"
        contentContainerStyle={{ paddingVertical }}
        onMomentumScrollEnd={(event) => {
          const index = Math.round(event.nativeEvent.contentOffset.y / WHEEL_ITEM_HEIGHT);
          onChangeIndex(Math.max(0, Math.min(values.length - 1, index)));
        }}
      >
        {values.map((label, index) => (
          <View key={`${label}-${index}`} style={styles.wheelItem}>
            <Text style={index === selectedIndex ? styles.wheelValueActive : styles.wheelValue}>{label}</Text>
          </View>
        ))}
      </ScrollView>
      <View pointerEvents="none" style={[styles.wheelHighlight, { top: paddingVertical }]} />
    </View>
  );
}

function WheelPicker({ columns }: { columns: Array<{ label?: string; values: string[]; selectedIndex: number; onChangeIndex: (index: number) => void }> }) {
  return (
    <View style={styles.wheelPickerRow}>
      {columns.map((column, index) => (
        <View key={index} style={styles.wheelColumnWrap}>
          <WheelColumn values={column.values} selectedIndex={column.selectedIndex} onChangeIndex={column.onChangeIndex} />
          {column.label ? <Text style={styles.wheelColumnLabel}>{column.label}</Text> : null}
        </View>
      ))}
    </View>
  );
}

function Dropdown({ options, value, onChange, placeholder = 'Selecione uma opcao' }: { options: InterviewOption[]; value: unknown; onChange: (value: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((item) => item.value === value);
  return (
    <View>
      <Pressable style={styles.dropdownField} onPress={() => setOpen(true)}>
        <Text style={selected ? styles.dropdownFieldText : styles.dropdownFieldPlaceholder}>{selected ? selected.label : placeholder}</Text>
        <Ionicons name="chevron-down" size={18} color="#6b7280" />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.dropdownOverlay} onPress={() => setOpen(false)}>
          <View style={styles.dropdownSheet}>
            <ScrollView>
              {options.map((item) => (
                <Pressable key={item.value} style={styles.interviewDropdownOption} onPress={() => { onChange(item.value); setOpen(false); }}>
                  <Text style={item.value === value ? styles.interviewDropdownOptionTextActive : styles.interviewDropdownOptionText}>{item.label}</Text>
                  {item.value === value ? <Ionicons name="checkmark" size={18} color="#0f766e" /> : null}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function MultiDropdown({ options, value, onChange, placeholder = 'Selecione uma ou mais opcoes' }: { options: InterviewOption[]; value: unknown; onChange: (value: string[]) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const selectedValues = Array.isArray(value) ? value : [];
  const selectedLabels = options.filter((item) => selectedValues.includes(item.value)).map((item) => item.label);
  function toggle(optionValue: string) {
    onChange(selectedValues.includes(optionValue) ? selectedValues.filter((entry) => entry !== optionValue) : [...selectedValues, optionValue]);
  }
  return (
    <View>
      <Pressable style={styles.dropdownField} onPress={() => setOpen(true)}>
        <Text style={selectedLabels.length ? styles.dropdownFieldText : styles.dropdownFieldPlaceholder} numberOfLines={2}>{selectedLabels.length ? selectedLabels.join(', ') : placeholder}</Text>
        <Ionicons name="chevron-down" size={18} color="#6b7280" />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.dropdownOverlay} onPress={() => setOpen(false)}>
          <View style={styles.dropdownSheet}>
            <ScrollView>
              {options.map((item) => {
                const checked = selectedValues.includes(item.value);
                return (
                  <Pressable key={item.value} style={styles.interviewDropdownOption} onPress={() => toggle(item.value)}>
                    <Text style={checked ? styles.interviewDropdownOptionTextActive : styles.interviewDropdownOptionText}>{item.label}</Text>
                    <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={18} color={checked ? '#0f766e' : '#9ca3af'} />
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable style={styles.dropdownDoneButton} onPress={() => setOpen(false)}><Text style={styles.dropdownDoneButtonText}>Pronto</Text></Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function GuidedInterview({ accessToken, userName, onLater, onComplete, questions = interviewQuestions, mode = 'onboarding', restartFromStart = false }: { accessToken: string; userName: string; onLater: () => void; onComplete: () => void; questions?: InterviewQuestion[]; mode?: 'onboarding' | 'reassessment'; restartFromStart?: boolean }) {
  const [answers, setAnswers] = useState<InterviewAnswers>({});
  const [step, setStep] = useState(0);
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [cepStatus, setCepStatus] = useState('');

  const loadUrl = mode === 'reassessment' ? `${API_URL}/me/reassessment` : `${API_URL}/me/onboarding`;
  const answerUrl = mode === 'reassessment' ? `${API_URL}/me/reassessment/answer` : `${API_URL}/me/onboarding/answer`;
  const completeUrl = mode === 'reassessment' ? `${API_URL}/me/reassessment/complete` : `${API_URL}/me/onboarding/complete`;

  const visibleQuestions = useMemo(() => questions.filter((question) => !question.condition || question.condition(answers)), [answers, questions]);
  const question = visibleQuestions[Math.min(step, Math.max(visibleQuestions.length - 1, 0))];
  const value = question ? answers[question.key] : undefined;

  useEffect(() => {
    const maxStep = Math.max(visibleQuestions.length - 1, 0);
    if (step > maxStep) setStep(maxStep);
  }, [visibleQuestions.length, step]);

  // Um seletor de roda sempre mostra algum valor destacado (nao existe estado "vazio" visual),
  // entao assim que a pergunta aparece ja fixamos um valor de partida sensato na resposta —
  // sem isso, hasAnswer() nunca veria uma resposta valida ate a pessoa rolar a roda. Perguntas
  // opcionais ficam de fora: fixar um valor ali salvaria uma medida fake so por ela ter passado
  // pela pergunta sem tocar na roda.
  useEffect(() => {
    if (!question || value !== undefined || question.optional) return;
    if (question.type === 'wheel_number') setAnswers((current) => ({ ...current, [question.key]: String(question.wheelMin ?? 0) }));
    else if (question.type === 'wheel_pace') setAnswers((current) => ({ ...current, [question.key]: '6:00' }));
    else if (question.type === 'wheel_duration_hms') setAnswers((current) => ({ ...current, [question.key]: '0:30:00' }));
    else if (question.type === 'wheel_date') setAnswers((current) => ({ ...current, [question.key]: `01/01/${new Date().getFullYear() - 30}` }));
  }, [question, value]);
  const assessedWeight = interviewDecimal(answers.personal_weight);
  const assessedBodyFat = interviewDecimal(answers.body_fat_percentage);
  const calculatedFatMass = assessedWeight !== null && assessedBodyFat !== null ? Math.round(assessedWeight * assessedBodyFat) / 100 : null;
  const calculatedLeanMass = assessedWeight !== null && calculatedFatMass !== null ? Math.round((assessedWeight - calculatedFatMass) * 10) / 10 : null;

  useEffect(() => {
    loadInterviewState(loadUrl, accessToken).then((state) => {
      const loadedAnswers = state?.answers ?? {};
      if (mode === 'onboarding' && !loadedAnswers.personal_name && userName) loadedAnswers.personal_name = userName;
      setAnswers(loadedAnswers);
      setFinished(Boolean(state?.completedAt));
      if (restartFromStart) {
        setStep(0);
        setStarted(true);
      } else if ((state?.currentStep ?? 0) > 0 && !state?.completedAt) {
        setStep(state?.currentStep ?? 0);
        setStarted(true);
      }
      setLoading(false);
    });
  }, [accessToken, userName, loadUrl, mode, restartFromStart]);

  async function persist(key: string, nextValue: InterviewAnswer, nextStep = step) {
    setSaving(true);
    setStatus('');
    try {
      const response = await fetch(answerUrl, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: nextValue, currentStep: nextStep }),
      });
      if (!response.ok) throw new Error('save');
      return true;
    } catch {
      setStatus('Nao consegui salvar esta resposta. Tente novamente.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function choose(nextValue: InterviewAnswer) {
    if (!question) return;
    const nextAnswers = { ...answers, [question.key]: nextValue };
    setAnswers(nextAnswers);
    await persist(question.key, nextValue, step);
  }

  async function lookupCep(rawDigits: string) {
    setCepStatus('Buscando endereco...');
    try {
      const response = await fetch(`https://viacep.com.br/ws/${rawDigits}/json/`);
      const data = await response.json();
      if (!response.ok || data.erro) {
        setCepStatus('CEP nao encontrado. Confira os numeros e tente novamente.');
        setAnswers((current) => {
          const next = { ...current };
          delete next.personal_address_street;
          delete next.personal_address_neighborhood;
          delete next.personal_address_city;
          delete next.personal_address_state;
          return next;
        });
        return;
      }
      const street = String(data.logradouro ?? '');
      const neighborhood = String(data.bairro ?? '');
      const city = String(data.localidade ?? '');
      const state = String(data.uf ?? '');
      setAnswers((current) => ({
        ...current,
        personal_address_street: street,
        personal_address_neighborhood: neighborhood,
        personal_address_city: city,
        personal_address_state: state,
      }));
      setCepStatus(`Endereco encontrado: ${[street, neighborhood].filter(Boolean).join(', ')}${street || neighborhood ? ' - ' : ''}${city}/${state}`);
    } catch {
      setCepStatus('Nao consegui buscar o CEP agora. Verifique sua internet e tente novamente.');
    }
  }

  function hasAnswer() {
    if (!question || question.optional || question.type === 'notice') return true;
    if (question.type === 'wheel_number' || question.type === 'wheel_pace' || question.type === 'wheel_duration_hms') return value !== undefined;
    if (Array.isArray(value)) return value.length > 0;
    if (question.type === 'date' || question.type === 'wheel_date') return dateInputValueToIso(String(value ?? '')) !== null;
    if (question.type === 'cpf') return isValidCpf(String(value ?? ''));
    if (question.type === 'phone') return String(value ?? '').replace(/\D/g, '').length === 11;
    if (question.type === 'cep') return String(value ?? '').replace(/\D/g, '').length === 8 && Boolean(answers.personal_address_city);
    return value !== undefined && value !== null && String(value).trim() !== '';
  }

  async function next() {
    if (!question || !hasAnswer()) {
      setStatus(question?.type === 'date' || question?.type === 'wheel_date' ? 'Selecione uma data valida.' : question?.type === 'cpf' ? 'Digite um CPF valido. Confira se os numeros estao corretos.' : question?.type === 'phone' ? 'Digite um numero de WhatsApp valido, com DDD (11 numeros).' : question?.type === 'cep' ? 'Digite um CEP valido e aguarde o endereco ser encontrado.' : 'Responda para continuar.');
      return;
    }
    // A segunda e a terceira maior distancia tem que ser menores ou iguais a distancia anterior
    // (maior <= maior, segunda <= primeira, terceira <= segunda) — sem isso, respostas fora de
    // ordem confundem o treinador ao ler a entrevista.
    if (question.key === 'second_longest_distance_recent' || question.key === 'third_longest_distance_recent') {
      const baselineKey = question.key === 'second_longest_distance_recent' ? 'longest_distance' : 'second_longest_distance_recent';
      const baselineRank = numberAnswerRank(answers[baselineKey]);
      const currentRank = numberAnswerRank(value);
      if (baselineRank !== null && currentRank !== null && currentRank > baselineRank) {
        setStatus('Essa distancia nao pode ser maior que a anterior. Revise sua resposta.');
        return;
      }
    }
    if (!(await persist(question.key, question.type === 'notice' ? true : value ?? '', step + 1))) return;
    if (step < visibleQuestions.length - 1) {
      setStep(step + 1);
      setHelpOpen(false);
      setStatus('');
      return;
    }
    setSaving(true);
    let response: Response;
    try {
      response = await fetchWithRetry(completeUrl, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
    } catch {
      setStatus('Nao consegui conectar ao servidor. Verifique sua internet e tente novamente.');
      setSaving(false);
      return;
    }
    try {
      if (!response.ok) {
        const data = await response.json().catch(() => ({} as { message?: string }));
        setStatus(typeof data.message === 'string' ? data.message : 'Nao consegui concluir. Revise as respostas e tente novamente.');
        return;
      }
      setFinished(true);
    } catch {
      setStatus('Nao consegui concluir. Revise as respostas e tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  async function reviewInterview() {
    setSaving(true);
    setStatus('');
    try {
      const response = await fetch(`${API_URL}/me/onboarding/reopen`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error('reopen');
      setFinished(false);
      setStarted(true);
      setStep(0);
    } catch {
      setStatus('Nao consegui abrir a entrevista para revisao.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <View style={styles.section}><Text style={styles.statusMessage}>{mode === 'reassessment' ? 'Abrindo sua reavaliacao...' : 'Abrindo sua entrevista...'}</Text></View>;
  if (finished) return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{mode === 'reassessment' ? 'Reavaliacao concluida' : 'Entrevista concluida'}</Text>
      <Text style={styles.titleSmall}>{mode === 'reassessment' ? 'Obrigado por atualizar seus dados' : 'Agora vamos medir seu condicionamento'}</Text>
      <Text style={styles.copyTight}>{mode === 'reassessment' ? 'Suas respostas foram salvas. Seu treinador vai revisar sua evolucao e ajustar seu treino conforme necessario.' : 'Suas respostas foram salvas. Faca o teste de corrida de 3 km para gerar seu plano inicial.'}</Text>
      <Pressable style={styles.primaryButton} onPress={onComplete}><Text style={styles.primaryButtonText}>{mode === 'reassessment' ? 'Voltar ao treino' : 'Ir para o teste de 3 km'}</Text><Ionicons name="arrow-forward" size={18} color="#fff" /></Pressable>
      {mode === 'onboarding' ? <Pressable style={styles.secondaryButton} onPress={reviewInterview} disabled={saving}><Text style={styles.secondaryButtonText}>Revisar minhas respostas</Text></Pressable> : null}
      {status ? <Text style={styles.statusMessage}>{status}</Text> : null}
    </View>
  );
  if (!started) return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{mode === 'reassessment' ? 'Reavaliacao periodica' : 'Primeiro acesso'}</Text>
      <Text style={styles.titleSmall}>{mode === 'reassessment' ? 'Vamos atualizar seus dados' : 'Vamos conhecer voce'}</Text>
      <Text style={styles.copyTight}>
        {mode === 'reassessment'
          ? 'De tempos em tempos pedimos para voce responder algumas perguntas rapidas, para atualizarmos seu treino e acompanharmos sua evolucao ao longo do tempo.'
          : 'Para criar seu treino de forma personalizada e individualizada para voce, precisamos conhecer mais sobre sua rotina, seu historico e seu condicionamento atual.\n\nDepois da entrevista, tambem vamos te convidar a fazer o teste de 3 km. Ele e opcional, mas e o que deixa o treino ainda mais preciso e individualizado para voce.\n\nEsta pronto para realizar nossa entrevista?'}
      </Text>
      <Pressable style={styles.primaryButton} onPress={() => setStarted(true)}><Text style={styles.primaryButtonText}>Sim, comecar agora</Text><Ionicons name="chatbubbles" size={18} color="#fff" /></Pressable>
      <Pressable style={styles.secondaryButton} onPress={onLater}><Text style={styles.secondaryButtonText}>Fazer depois</Text></Pressable>
    </View>
  );

  const progress = visibleQuestions.length ? ((step + 1) / visibleQuestions.length) * 100 : 0;
  return (
    <View style={styles.section}>
      <View style={styles.interviewTop}><Text style={styles.sectionLabel}>{question?.module}</Text><Text style={styles.interviewCounter}>{step + 1} de {visibleQuestions.length}</Text></View>
      <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
      <Text style={styles.interviewQuestion}>{question?.prompt}{question && !question.optional && question.type !== 'notice' ? <Text style={styles.requiredMark}> *</Text> : null}</Text>
      {question?.help ? <Pressable style={styles.helpButton} onPress={() => setHelpOpen(!helpOpen)}><Ionicons name="information-circle-outline" size={18} color="#0f766e" /><Text style={styles.helpButtonText}>Entenda</Text></Pressable> : null}
      {helpOpen ? <Text style={styles.formHint}>{question?.help}</Text> : null}

      {(question?.type === 'single' || question?.type === 'scale') ? <View style={question.type === 'scale' ? styles.scaleGrid : styles.answerList}>{(question.type === 'scale' ? Array.from({ length: 10 }, (_, i) => option(String(i + 1))) : question.options ?? []).map((item) => { const selected = value === item.value || (question.type === 'scale' && value === Number(item.value)); return <Pressable key={item.value} style={[styles.answerButton, selected && styles.answerButtonActive, question.type === 'scale' && styles.scaleButton]} onPress={() => choose(question.type === 'scale' ? Number(item.value) : item.value)}><Text style={[styles.answerButtonText, selected && styles.answerButtonTextActive]}>{item.label}</Text></Pressable>; })}</View> : null}
      {question?.type === 'dropdown_single' ? <Dropdown options={question.options ?? []} value={value} onChange={(nextValue) => choose(nextValue)} /> : null}
      {question?.type === 'dropdown_multi' ? <MultiDropdown options={question.options ?? []} value={value} onChange={(nextValue) => choose(nextValue)} /> : null}
      {question?.type === 'multi' ? <View style={styles.answerList}>{question.options?.map((item) => { const selected = Array.isArray(value) && value.includes(item.value); return <Pressable key={item.value} style={[styles.answerButton, selected && styles.answerButtonActive]} onPress={() => choose(selected ? (value as string[]).filter((entry) => entry !== item.value) : [...(Array.isArray(value) ? value : []), item.value])}><Text style={[styles.answerButtonText, selected && styles.answerButtonTextActive]}>{item.label}</Text></Pressable>; })}</View> : null}
      {(question?.type === 'text' || question?.type === 'number' || question?.type === 'number_or_unknown') ? <TextInput style={styles.input} value={value === 'unknown' || value === 'automatic' ? '' : String(value ?? '')} keyboardType={question.type === 'text' ? 'default' : 'decimal-pad'} placeholder={question.optional ? 'Opcional' : 'Digite sua resposta'} onChangeText={(text) => setAnswers({ ...answers, [question.key]: text })} /> : null}
      {question?.type === 'date' ? <TextInput style={styles.input} value={String(value ?? '')} keyboardType="number-pad" maxLength={10} placeholder="dd/mm/aaaa" onChangeText={(text) => setAnswers({ ...answers, [question.key]: formatDateInputText(text) })} /> : null}
      {question?.type === 'cpf' ? <TextInput style={styles.input} value={String(value ?? '')} keyboardType="number-pad" maxLength={14} placeholder="Somente numeros" onChangeText={(text) => setAnswers({ ...answers, [question.key]: formatCpfInputText(text) })} /> : null}
      {question?.type === 'phone' ? <TextInput style={styles.input} value={String(value ?? '')} keyboardType="number-pad" maxLength={15} placeholder="(11) 98765-4321" onChangeText={(text) => setAnswers({ ...answers, [question.key]: formatPhoneInputText(text) })} /> : null}
      {question?.type === 'cep' ? (() => {
        const questionKey = question.key;
        return (
          <View>
            <TextInput
              style={styles.input}
              value={String(value ?? '')}
              keyboardType="number-pad"
              maxLength={9}
              placeholder="00000-000"
              onChangeText={(text) => {
                const formatted = formatCepInputText(text);
                setAnswers((current) => ({ ...current, [questionKey]: formatted }));
                const digits = formatted.replace(/\D/g, '');
                if (digits.length === 8) void lookupCep(digits);
                else setCepStatus('');
              }}
            />
            {cepStatus ? <Text style={styles.formHint}>{cepStatus}</Text> : null}
          </View>
        );
      })() : null}
      {question?.key === 'personal_address_number' && answers.personal_address_city ? <Text style={styles.formHint}>{[answers.personal_address_street, answers.personal_address_neighborhood].filter(Boolean).join(', ')} - {answers.personal_address_city}/{answers.personal_address_state}</Text> : null}
      {(question?.type === 'number' || question?.type === 'number_or_unknown') ? <Pressable style={styles.decimalButton} onPress={() => { const current = String(value === 'unknown' || value === 'automatic' ? '' : value ?? ''); if (!current.includes(',') && !current.includes('.')) setAnswers({ ...answers, [question.key]: `${current},` }); }}><Text style={styles.decimalButtonText}>Inserir virgula</Text></Pressable> : null}
      {question?.type === 'wheel_number' ? (() => {
        const digits = question.wheelDigits ?? 2;
        const min = question.wheelMin ?? 0;
        const max = question.wheelMax ?? 10 ** digits - 1;
        const values = wheelNumberValues(min, max, digits);
        const current = Math.max(min, Math.min(max, Number(value ?? min) || min));
        return <WheelPicker columns={[{ label: question.wheelUnit, values, selectedIndex: current - min, onChangeIndex: (index) => choose(String(min + index)) }]} />;
      })() : null}
      {question?.type === 'wheel_pace' ? (() => {
        const raw = typeof value === 'string' ? value : '6:00';
        const [rawMinStr, rawSecStr] = raw.split(':');
        const minValues = wheelNumberValues(3, 14, 1);
        const secValues = wheelNumberValues(0, 59, 2);
        const minCurrent = Math.max(3, Math.min(14, Number(rawMinStr) || 6));
        const secCurrent = Math.max(0, Math.min(59, Number(rawSecStr) || 0));
        return (
          <WheelPicker columns={[
            { label: 'min', values: minValues, selectedIndex: minCurrent - 3, onChangeIndex: (index) => choose(`${3 + index}:${String(secCurrent).padStart(2, '0')}`) },
            { label: 'seg/km', values: secValues, selectedIndex: secCurrent, onChangeIndex: (index) => choose(`${minCurrent}:${String(index).padStart(2, '0')}`) },
          ]} />
        );
      })() : null}
      {question?.type === 'wheel_duration_hms' ? (() => {
        const raw = typeof value === 'string' ? value : '0:30:00';
        const [rawHStr, rawMStr, rawSStr] = raw.split(':');
        const hValues = wheelNumberValues(0, 9, 1);
        const mValues = wheelNumberValues(0, 59, 2);
        const sValues = wheelNumberValues(0, 59, 2);
        const hCurrent = Math.max(0, Math.min(9, Number(rawHStr) || 0));
        const mCurrent = Math.max(0, Math.min(59, Number(rawMStr) || 0));
        const sCurrent = Math.max(0, Math.min(59, Number(rawSStr) || 0));
        return (
          <WheelPicker columns={[
            { label: 'h', values: hValues, selectedIndex: hCurrent, onChangeIndex: (index) => choose(`${index}:${String(mCurrent).padStart(2, '0')}:${String(sCurrent).padStart(2, '0')}`) },
            { label: 'min', values: mValues, selectedIndex: mCurrent, onChangeIndex: (index) => choose(`${hCurrent}:${String(index).padStart(2, '0')}:${String(sCurrent).padStart(2, '0')}`) },
            { label: 'seg', values: sValues, selectedIndex: sCurrent, onChangeIndex: (index) => choose(`${hCurrent}:${String(mCurrent).padStart(2, '0')}:${String(index).padStart(2, '0')}`) },
          ]} />
        );
      })() : null}
      {question?.type === 'wheel_date' ? (() => {
        const currentYear = new Date().getFullYear();
        const raw = typeof value === 'string' ? value : `01/01/${currentYear - 30}`;
        const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        const dayValues = wheelNumberValues(1, 31, 2);
        const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        const yearValues = Array.from({ length: 90 }, (_, i) => String(currentYear - 10 - i));
        const dayCurrent = match ? Math.max(1, Math.min(31, Number(match[1]))) : 1;
        const monthCurrent = match ? Math.max(1, Math.min(12, Number(match[2]))) : 1;
        const yearCurrent = match ? match[3] : String(currentYear - 30);
        const yearIndex = Math.max(0, yearValues.indexOf(yearCurrent));
        return (
          <WheelPicker columns={[
            { label: 'dia', values: dayValues, selectedIndex: dayCurrent - 1, onChangeIndex: (index) => choose(`${String(index + 1).padStart(2, '0')}/${String(monthCurrent).padStart(2, '0')}/${yearCurrent}`) },
            { label: 'mes', values: monthNames, selectedIndex: monthCurrent - 1, onChangeIndex: (index) => choose(`${String(dayCurrent).padStart(2, '0')}/${String(index + 1).padStart(2, '0')}/${yearCurrent}`) },
            { label: 'ano', values: yearValues, selectedIndex: yearIndex, onChangeIndex: (index) => choose(`${String(dayCurrent).padStart(2, '0')}/${String(monthCurrent).padStart(2, '0')}/${yearValues[index]}`) },
          ]} />
        );
      })() : null}
      {question?.key === 'longest_distance_recent_time' ? (() => {
        const km = numberAnswerRank(answers.longest_distance);
        const totalSeconds = parseHmsToSeconds(value);
        if (!km || !totalSeconds) return null;
        return <View style={styles.calculationBox}><Text style={styles.calculationTitle}>Pace medio calculado</Text><Text style={styles.calculationText}>{formatPaceMinSec(totalSeconds / km)} min/km</Text></View>;
      })() : null}
      {question?.key === 'body_fat_percentage' && calculatedLeanMass !== null && calculatedFatMass !== null ? <View style={styles.calculationBox}><Text style={styles.calculationTitle}>Composicao calculada</Text><Text style={styles.calculationText}>Massa magra: {calculatedLeanMass.toFixed(1).replace('.', ',')} kg</Text><Text style={styles.calculationText}>Massa de gordura: {calculatedFatMass.toFixed(1).replace('.', ',')} kg</Text></View> : null}
      {question?.type === 'number_or_unknown' ? <Pressable style={[styles.answerButton, value === 'unknown' && styles.answerButtonActive]} onPress={() => choose('unknown')}><Text style={[styles.answerButtonText, value === 'unknown' && styles.answerButtonTextActive]}>Nao sei</Text></Pressable> : null}
      {question?.key === 'basal_metabolism' ? <Pressable style={[styles.answerButton, value === 'automatic' && styles.answerButtonActive]} onPress={() => choose('automatic')}><Text style={[styles.answerButtonText, value === 'automatic' && styles.answerButtonTextActive]}>Calcular automaticamente</Text></Pressable> : null}

      {status ? <Text style={styles.statusMessage}>{status}</Text> : null}
      <View style={styles.interviewActions}><Pressable style={[styles.secondaryButton, step === 0 && styles.disabledButton]} disabled={step === 0} onPress={() => { setStep(Math.max(0, step - 1)); setStatus(''); }}><Text style={styles.secondaryButtonText}>Voltar</Text></Pressable><Pressable style={[styles.primaryButton, saving && styles.disabledButton]} disabled={saving} onPress={next}><Text style={styles.primaryButtonText}>{step === visibleQuestions.length - 1 ? 'Concluir' : 'Continuar'}</Text></Pressable></View>
    </View>
  );
}

function interviewDecimal(value: InterviewAnswer | undefined) {
  if (value === undefined || value === 'unknown' || value === 'automatic' || Array.isArray(value) || typeof value === 'boolean') return null;
  const number = Number(String(value).replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

async function loadInterviewState(url: string, accessToken: string): Promise<InterviewState | null> {
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    return response.ok ? await response.json() as InterviewState : null;
  } catch { return null; }
}

function Week({ accessToken, baseRoutineDays, metrics, onOpenInterview, onOpenTest, onPlanStateChange }: { accessToken: string; baseRoutineDays: RoutineDay[]; metrics: ThreeKmMetrics; onOpenInterview: () => void; onOpenTest: () => void; onPlanStateChange?: (state: { locked: boolean; requiresTest: boolean; requiresOnboarding: boolean }) => void }) {
  const [plan, setPlan] = useState<WeekPlan | null>(null);
  const [billingMessage, setBillingMessage] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [cpf, setCpf] = useState('');
  const [weeklyRoutine, setWeeklyRoutine] = useState<RoutineDay[]>(cloneRoutine(baseRoutineDays));
  const [completionDrafts, setCompletionDrafts] = useState<Record<string, CompletionDraft>>({});
  const [completionMessages, setCompletionMessages] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [recommendationOpen, setRecommendationOpen] = useState(true);
  const [routineAdjustmentOpen, setRoutineAdjustmentOpen] = useState(false);
  const [applyRoutinePermanently, setApplyRoutinePermanently] = useState(false);
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (accessToken) {
      loadPlan();
    }
  }, [accessToken]);

  useEffect(() => {
    setWeeklyRoutine(cloneRoutine(baseRoutineDays));
  }, [baseRoutineDays]);

  async function loadPlan() {
    setIsLoading(true);
    setStatus('');
    try {
      const response = await fetch(`${API_URL}/training-plans/current`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        setStatus('Nao consegui carregar a semana.');
        return;
      }

      const data = (await response.json()) as WeekPlan | null;
      if (data && !data.locked && !data.requiresOnboarding && !isDetailedPlan(data)) {
        setPlan(null);
        setStatus('Plano antigo detectado. Gere uma nova semana para ver os treinos detalhados.');
        return;
      }

      setPlan(data);
      if (!data) {
        setStatus('Gerando sua semana de treino...');
        await generatePlan();
        return;
      }
      setCompletionDrafts(
        Object.fromEntries(data.sessions.filter((session) => session.completion).map((session) => [session.id, completionDraftFromSession(session)])),
      );
    } catch {
      setStatus('Nao consegui conectar com a API agora.');
    } finally {
      setIsLoading(false);
    }
  }

  async function generatePlan() {
    setIsLoading(true);
    setStatus('');
    try {
      const response = await fetch(`${API_URL}/training-plans/week`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          availability: routineToAvailability(weeklyRoutine),
        }),
      });

      if (!response.ok) {
        setStatus('Nao consegui gerar a semana.');
        return;
      }

      const data = (await response.json()) as WeekPlan;
      if (!data.locked && !data.requiresOnboarding && !isDetailedPlan(data)) {
        setPlan(null);
        setStatus('A API ainda esta com a versao antiga. Publique no EasyPanel e gere novamente.');
        return;
      }

      setPlan(data);
      setStatus('Plano detalhado da semana gerado.');
    } catch {
      setStatus('Nao consegui conectar com a API agora.');
    } finally {
      setIsLoading(false);
    }
  }

  async function applyRoutineAdjustment() {
    if (!applyRoutinePermanently) {
      await generatePlan();
      return;
    }

    setIsLoading(true);
    setStatus('');
    try {
      const response = await fetch(`${API_URL}/me/availability`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ availability: routineToAvailability(weeklyRoutine) }),
      });

      if (!response.ok) {
        setStatus('Nao consegui salvar a rotina permanente.');
        setIsLoading(false);
        return;
      }
    } catch {
      setStatus('Nao consegui conectar com a API agora.');
      setIsLoading(false);
      return;
    }

    await generatePlan();
  }

  function moveSession(sessionId: string, direction: -1 | 1) {
    setPlan((currentPlan) => {
      if (!currentPlan) {
        return currentPlan;
      }

      const nextSessions = currentPlan.sessions.map((session) =>
        session.id === sessionId ? shiftSessionDay(session, direction) : session,
      );

      return { ...currentPlan, sessions: sortSessionsByWeek(nextSessions) };
    });
    setStatus('Treino movido apenas nesta semana.');
  }

  function updateCompletionDraft(session: WeekPlanSession, patch: Partial<CompletionDraft>) {
    setCompletionDrafts((current) => ({
      ...current,
      [session.id]: {
        ...defaultCompletionDraft(session),
        ...current[session.id],
        ...patch,
      },
    }));
  }

  async function saveCompletion(session: WeekPlanSession) {
    const draft = completionDrafts[session.id] ?? defaultCompletionDraft(session);
    const body = {
      sessionId: session.id,
      status: draft.status,
      completedAt: dateInputValueToIso(draft.completedDate) ?? undefined,
      perceivedEffort: Number(draft.perceivedEffort) || undefined,
      satisfaction: draft.satisfaction || undefined,
      painFlag: draft.painFlag || undefined,
      durationMin: Number(draft.durationMin) || undefined,
      distanceKm: Number(draft.distanceKm.replace(',', '.')) || undefined,
      avgPaceSecondsKm: paceInputToSeconds(draft.avgPace) ?? undefined,
      notes: draft.notes || undefined,
      details: {
        loadsText: draft.loadsText,
      },
    };

    setStatus('');
    setCompletionMessages((current) => ({ ...current, [session.id]: 'Salvando...' }));
    try {
      const response = await fetch(`${API_URL}/workout-completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const message = Array.isArray(data.message) ? data.message[0] : data.message;
        setCompletionMessages((current) => ({ ...current, [session.id]: message ?? 'Nao consegui salvar. Confira os dados e tente novamente.' }));
        return;
      }

      setCompletionMessages((current) => ({ ...current, [session.id]: 'Treino salvo e feedback enviado ao treinador.' }));
      setPlan((current) => current ? {
        ...current,
        sessions: current.sessions.map((item) => item.id === session.id ? { ...item, completion: body } : item),
      } : current);
    } catch {
      setCompletionMessages((current) => ({ ...current, [session.id]: 'Sem conexao. Tente salvar novamente.' }));
    }
  }

  async function openSubscriptionCheckout() {
    if (cpf.replace(/\D/g, '').length !== 11) {
      setBillingMessage('Informe um CPF valido (11 numeros) para continuar.');
      return;
    }
    setBillingMessage('Preparando pagamento seguro...');
    let response: Response;
    try {
      response = await fetchWithRetry(API_URL + '/billing/checkout', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpf: cpf.replace(/\D/g, '') }),
      });
    } catch {
      setBillingMessage('Nao consegui conectar ao servidor. Verifique sua internet e tente novamente.');
      return;
    }
    try {
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.checkoutUrl) throw new Error(typeof data.message === 'string' ? data.message : 'Nao consegui abrir o pagamento. Tente novamente.');
      setBillingMessage('Pagamento aberto. Depois de pagar, volte ao aplicativo.');
      await Linking.openURL(data.checkoutUrl);
    } catch (error) {
      setBillingMessage(error instanceof Error ? error.message : 'Nao consegui abrir o pagamento. Tente novamente.');
    }
  }

  async function applyCoupon() {
    if (!couponCode.trim()) {
      setBillingMessage('Digite seu cupom.');
      return;
    }
    setBillingMessage('Aplicando cupom...');
    let response: Response;
    try {
      response = await fetchWithRetry(API_URL + '/billing/coupon', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: couponCode }),
      });
    } catch {
      setBillingMessage('Nao consegui conectar ao servidor. Verifique sua internet e tente novamente.');
      return;
    }
    try {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : 'Cupom invalido.');
      setCouponCode('');
      setBillingMessage(data.message ?? 'Cupom aplicado. Acesso liberado.');
      await loadPlan();
    } catch (error) {
      setBillingMessage(error instanceof Error ? error.message : 'Cupom invalido.');
    }
  }
  const sessions = plan?.sessions.length ? plan.sessions : [];
  const weekRange = plan ? planWeekRange(plan) : currentWeekRange();
  const groupedSessions = sessions.reduce<Array<{ key: string; day: string; date: string; sessions: WeekPlanSession[] }>>((groups, session) => {
    const key = session.date;
    const group = groups.find((item) => item.key === key);
    if (group) group.sessions.push(session);
    else groups.push({ key, day: session.day, date: session.date, sessions: [session] });
    return groups;
  }, []).map((group) => ({ ...group, sessions: group.sessions.slice().sort((left, right) => modalityOrderRank(left.modality) - modalityOrderRank(right.modality)) }));

  const subscriptionOffer = (
    <View style={styles.formSection}>
      <Text style={styles.formSectionTitle}>Assinatura Panzeri Run</Text>
      <Text style={styles.formHint}>{plan?.priceLabel ?? 'R$ 19,90 por mes'}. Plano mensal, sem fidelidade.</Text>
      <Text style={styles.inputLabel}>CPF</Text>
      <TextInput style={styles.input} value={cpf} onChangeText={setCpf} placeholder="Somente numeros" keyboardType="number-pad" maxLength={14} />
      <Pressable style={styles.primaryButton} onPress={openSubscriptionCheckout}>
        <Text style={styles.primaryButtonText}>Ativar minha assinatura</Text>
        <Ionicons name="card" size={18} color="#ffffff" />
      </Pressable>
      <Text style={styles.formHint}>O acesso aos treinos sera liberado assim que o pagamento for confirmado.</Text>
      <View style={styles.couponBox}>
        <Text style={styles.inputLabel}>Tenho um cupom</Text>
        <View style={styles.couponRow}>
          <TextInput style={[styles.input, styles.couponInput]} value={couponCode} onChangeText={setCouponCode} placeholder="Digite seu cupom" autoCapitalize="characters" />
          <Pressable style={styles.couponButton} onPress={applyCoupon}>
            <Text style={styles.couponButtonText}>Aplicar</Text>
          </Pressable>
        </View>
      </View>
      {billingMessage ? <Text style={styles.statusMessage}>{billingMessage}</Text> : null}
    </View>
  );

  // A compra precisa estar disponível mesmo quando a semana ainda nao foi criada.
  // Isso evita deixar novos alunos presos em uma tela vazia sem caminho de assinatura.
  if (!plan) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Treino da semana</Text>
        <Text style={styles.titleSmall}>Seu acesso esta quase pronto</Text>
        <View style={styles.coachBox}>
          <Text style={styles.coachTitle}>Ative seu plano para comecar</Text>
          <Text style={styles.coachText}>
            Depois da confirmacao do pagamento, liberaremos seu acesso e montaremos sua semana personalizada com base nas suas respostas e avaliacao.
          </Text>
        </View>
        {subscriptionOffer}
        {status ? <Text style={styles.statusMessage}>{status}</Text> : null}
      </View>
    );
  }

  if (plan?.requiresOnboarding) {
    return <View style={styles.section}><Text style={styles.sectionLabel}>Treino da semana</Text><Text style={styles.titleSmall}>Vamos preparar seu plano</Text><View style={styles.coachBox}><Text style={styles.coachTitle}>Entrevista inicial pendente</Text><Text style={styles.coachText}>Conclua a entrevista para que seu treino respeite seu objetivo, sua rotina e seu historico.</Text></View><Pressable style={styles.primaryButton} onPress={onOpenInterview}><Text style={styles.primaryButtonText}>Continuar entrevista</Text><Ionicons name="chatbubbles" size={18} color="#fff" /></Pressable>{subscriptionOffer}</View>;
  }
  if (plan?.locked) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Treino da semana</Text>
        <Text style={styles.titleSmall}>{weekRange}</Text>
        <View style={styles.coachBox}>
          <Text style={styles.coachTitle}>Seu plano personalizado esta pronto</Text>
          <Text style={styles.coachText}>Com base na sua entrevista e no teste de 3 km, ja montamos sua semana inicial. Ative sua assinatura para liberar o treino completo e comecar hoje.</Text>
        </View>
        <View style={styles.formSection}>
          <Text style={styles.formSectionTitle}>Assinatura Panzeri Run</Text>
          <Text style={styles.formHint}>{plan.priceLabel ?? 'R$ 19,90 por mes'}. Plano mensal, sem fidelidade.</Text>
          <Text style={styles.inputLabel}>CPF</Text>
          <TextInput style={styles.input} value={cpf} onChangeText={setCpf} placeholder="Somente numeros" keyboardType="number-pad" maxLength={14} />
          <Pressable style={styles.primaryButton} onPress={openSubscriptionCheckout}>
            <Text style={styles.primaryButtonText}>Ativar minha assinatura</Text>
            <Ionicons name="card" size={18} color="#ffffff" />
          </Pressable>
          <Text style={styles.formHint}>Seu treino ja esta preparado. Apos a confirmacao, o acesso e liberado para iniciar os treinos.</Text>
          <View style={styles.couponBox}>
            <Text style={styles.inputLabel}>Tenho um cupom</Text>
            <View style={styles.couponRow}>
              <TextInput style={[styles.input, styles.couponInput]} value={couponCode} onChangeText={setCouponCode} placeholder="Digite seu cupom" autoCapitalize="characters" />
              <Pressable style={styles.couponButton} onPress={applyCoupon}>
                <Text style={styles.couponButtonText}>Aplicar</Text>
              </Pressable>
            </View>
          </View>
          {billingMessage ? <Text style={styles.statusMessage}>{billingMessage}</Text> : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Treino da semana</Text>
      <Text style={styles.titleSmall}>{weekRange}</Text>
      <Text style={styles.copyTight}>Seu treino aparece primeiro. Use o ajuste no final da tela quando a rotina desta semana mudar.</Text>

      {status ? <Text style={styles.statusMessage}>{status}</Text> : null}

      {plan?.requiresTest ? (
        <View style={styles.formSection}>
          <Text style={styles.formSectionTitle}>Teste de 3 km pendente</Text>
          <Text style={styles.formHint}>Seu treino ja esta rodando com uma estimativa de ritmo. Fazer o teste de 3 km deixa seus treinos ainda mais precisos e individualizados, e o plano e recalculado automaticamente assim que voce registrar o resultado.</Text>
          <Pressable style={styles.secondaryButton} onPress={onOpenTest}>
            <Ionicons name="stopwatch" size={18} color="#0f766e" />
            <Text style={styles.secondaryButtonText}>Fazer teste de 3 km agora</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.weekList}>
        {plan?.recommendation ? (
          <View style={styles.coachBox}>
            <Pressable style={styles.collapseHeader} onPress={() => setRecommendationOpen((open) => !open)}>
              <Text style={styles.coachTitle}>Orientacao da semana</Text>
              <Ionicons name={recommendationOpen ? 'chevron-up' : 'chevron-down'} size={20} color="#fff" />
            </Pressable>
            {recommendationOpen ? <Text style={styles.coachText}>{plan.recommendation}</Text> : null}
          </View>
        ) : null}
        {groupedSessions.map((group) => {
          const expanded = Boolean(expandedDays[group.key]);
          const modalitySummary = group.sessions.map((session) => session.title).join(' + ');
          return (
            <View style={styles.weekItem} key={group.key}>
              <View style={styles.weekDate}>
                <Text style={styles.weekDay}>{group.day}</Text>
                <Text style={styles.weekNumber}>{group.date}</Text>
              </View>
              <View style={styles.weekSessionCard}>
                <Pressable
                  style={styles.collapseHeader}
                  onPress={() => setExpandedDays((current) => ({ ...current, [group.key]: !current[group.key] }))}
                >
                  <View style={styles.weekSessionTitleBlock}>
                    <Text style={styles.sessionTitle}>{modalitySummary}</Text>
                    <Text style={styles.sessionDetail}>{expanded ? 'Toque para recolher' : 'Toque para ver o treino'}</Text>
                  </View>
                  <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={22} color="#0f766e" />
                </Pressable>

                {expanded ? group.sessions.map((session) => (
                  <View key={session.id} style={[styles.formSection, { borderLeftWidth: 4, borderLeftColor: modalityAccentColor(session.modality) }]}>
                    <View style={styles.weekSessionHeader}>
                      <View style={styles.weekSessionTitleBlock}>
                        <Text style={styles.sessionTitle}>{session.title}</Text>
                        <Text style={styles.sessionDetail}>{session.detail}</Text>
                        <View style={styles.zonePill}><Text style={styles.zoneText}>{session.zone}</Text></View>
                      </View>
                      <View style={styles.weekIcon}>
                        <Ionicons name={iconForModality(session.modality)} size={23} color="#111827" />
                      </View>
                    </View>
                    {'notes' in session && session.notes ? <Text style={styles.sessionNote}>{session.notes}</Text> : null}
                    <SessionPrescription session={session} metrics={metrics} />
                    <CompletionForm
                      session={session}
                      draft={completionDrafts[session.id] ?? defaultCompletionDraft(session)}
                      onChange={(patch) => updateCompletionDraft(session, patch)}
                      onSave={() => saveCompletion(session)}
                      message={completionMessages[session.id]}
                    />
                    <View style={styles.moveActions}>
                      <Pressable style={styles.moveButton} onPress={() => moveSession(session.id, -1)}>
                        <Ionicons name="chevron-back" size={15} color="#0f766e" />
                        <Text style={styles.moveButtonText}>Dia anterior</Text>
                      </Pressable>
                      <Pressable style={styles.moveButton} onPress={() => moveSession(session.id, 1)}>
                        <Text style={styles.moveButtonText}>Proximo dia</Text>
                        <Ionicons name="chevron-forward" size={15} color="#0f766e" />
                      </Pressable>
                    </View>
                  </View>
                )) : null}
              </View>
            </View>
          );
        })}
      </View>

      <View style={styles.formSection}>
        <Pressable style={styles.collapseHeader} onPress={() => setRoutineAdjustmentOpen((open) => !open)}>
          <Text style={styles.formSectionTitle}>Ajuste de rotina da semana atual</Text>
          <Ionicons name={routineAdjustmentOpen ? 'chevron-up' : 'chevron-down'} size={20} color="#0f766e" />
        </Pressable>
        {routineAdjustmentOpen ? (
          <>
            <Text style={styles.formHint}>Mude dias, modalidades e tempos somente de hoje em diante. Treinos anteriores serao preservados.</Text>
            <RoutineEditor routineDays={weeklyRoutine} onChange={setWeeklyRoutine} />
            <View style={styles.termsRow}>
              <Switch value={applyRoutinePermanently} onValueChange={setApplyRoutinePermanently} />
              <Text style={styles.termsText}>Aplicar essa rotina permanentemente, nao so nesta semana (evita ter que refazer a entrevista).</Text>
            </View>
            <Pressable style={[styles.primaryButton, isLoading && styles.disabledButton]} disabled={isLoading} onPress={applyRoutineAdjustment}>
              <Text style={styles.primaryButtonText}>{isLoading ? 'Gerando...' : applyRoutinePermanently ? 'Salvar rotina permanente e gerar treino' : 'Gerar ajustes so desta semana'}</Text>
              <Ionicons name="sparkles" size={18} color="#ffffff" />
            </Pressable>
          </>
        ) : null}
      </View>
    </View>
  );
}

function ThreeKmTest({
  threeKmSeconds,
  onChangeSeconds,
  metrics,
  accessToken,
  latestTest,
  onLater,
  onSaved,
}: {
  threeKmSeconds: string;
  onChangeSeconds: (value: string) => void;
  metrics: ThreeKmMetrics;
  accessToken: string;
  latestTest?: { id?: string; createdAt?: string | null } | null;
  onLater: () => void;
  onSaved: () => void;
}) {
  const [saveStatus, setSaveStatus] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [environment, setEnvironment] = useState<'rua' | 'esteira'>('rua');
  const parsedSeconds = Number(threeKmSeconds);
  const safeSeconds = Number.isFinite(parsedSeconds) && parsedSeconds > 0 ? parsedSeconds : 1200;
  const selectedMinutes = Math.floor(safeSeconds / 60);
  const selectedSeconds = safeSeconds % 60;

  function updateTestTime(part: 'minutes' | 'seconds', value: string) {
    const numeric = Number(value.replace(/[^0-9]/g, ''));
    const minutes = part === 'minutes' ? Math.min(Math.max(numeric || 0, 0), 120) : selectedMinutes;
    const seconds = part === 'seconds' ? Math.min(Math.max(numeric || 0, 0), 59) : selectedSeconds;
    onChangeSeconds(String(minutes * 60 + seconds));
  }

  function saveTest() {
    const totalSeconds = Number(threeKmSeconds);
    setSaveStatus('');

    if (!Number.isFinite(totalSeconds) || totalSeconds < 300 || totalSeconds > 7200) {
      setSaveStatus('Informe um tempo valido entre 5 minutos e 2 horas.');
      return;
    }

    if (!accessToken) {
      setSaveStatus('Entre novamente na conta para salvar o teste.');
      return;
    }

    const lastTestDate = latestTest?.id && latestTest.createdAt ? new Date(latestTest.createdAt) : null;
    const daysSinceLastTest = lastTestDate ? (Date.now() - lastTestDate.getTime()) / 86400000 : null;

    if (latestTest?.id && daysSinceLastTest !== null && daysSinceLastTest < 30) {
      Alert.alert(
        'Teste recente encontrado',
        'Seu ultimo teste foi ha menos de 1 mes. Quer substituir esse teste ou adicionar um novo registro no seu historico?',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Adicionar novo', onPress: () => performSave('create') },
          { text: 'Substituir', onPress: () => performSave('replace') },
        ],
      );
      return;
    }

    performSave('create');
  }

  async function performSave(mode: 'create' | 'replace') {
    const totalSeconds = Number(threeKmSeconds);
    setIsSaving(true);
    try {
      const url = mode === 'replace' && latestTest?.id ? `${API_URL}/fitness-tests/3km/${latestTest.id}` : `${API_URL}/fitness-tests/3km`;
      const response = await fetch(url, {
        method: mode === 'replace' ? 'PUT' : 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          totalSeconds,
          environment,
          notes: `Teste de 3 km realizado ${environment === 'esteira' ? 'na esteira' : 'na rua'}.`,
        }),
      });

      if (!response.ok) {
        setSaveStatus(`Nao consegui salvar: ${await readApiError(response)}`);
        return;
      }

      setSaveStatus('Teste salvo. Recalculando a semana...');
      const planResponse = await fetch(`${API_URL}/training-plans/week`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      if (!planResponse.ok) {
        setSaveStatus('Teste salvo. Abrindo seu plano...');
        onSaved();
        return;
      }

      setSaveStatus('Teste salvo. Abrindo seu plano personalizado...');
      onSaved();
    } catch {
      setSaveStatus('Nao consegui conectar com a API agora.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Teste fisico</Text>
      <Text style={styles.titleSmall}>Teste de 3 km</Text>

      <View style={styles.formSection}>
        <Text style={styles.formSectionTitle}>Como fazer</Text>
        <Text style={styles.formHint}>Este teste deve ser realizado apenas se voce estiver bem e sem dor, febre, tontura ou mal-estar.</Text>
        <Text style={styles.prescriptionText}>1. Faca um breve aquecimento antes de iniciar.</Text>
        <Text style={styles.prescriptionText}>2. Percorra exatamente 3 km no maior ritmo que consiga sustentar ate o final. Comece controlado e aumente se estiver bem.</Text>
        <Text style={styles.prescriptionText}>3. Cronometre apenas os 3 km do teste e registre o tempo total exato.</Text>
        <Text style={styles.prescriptionText}>4. Caminhe ou trote leve por alguns minutos ao terminar.</Text>
        <Text style={styles.formHint}>Interrompa imediatamente se sentir dor no peito, tontura, falta de ar anormal ou qualquer mal-estar.</Text>
      </View>

      <Text style={styles.inputLabel}>Onde voce vai realizar o teste?</Text>
      <View style={styles.optionRow}>
        {(['rua', 'esteira'] as const).map((option) => {
          const selected = environment === option;
          return (
            <Pressable key={option} style={[styles.optionChip, selected && styles.optionChipActive]} onPress={() => setEnvironment(option)}>
              <Text style={[styles.optionChipText, selected && styles.optionChipTextActive]}>{option === 'rua' ? 'Rua ou pista' : 'Esteira'}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.noticeBox}>
        <Text style={styles.noticeTitle}>{environment === 'rua' ? 'Orientacao para rua ou pista' : 'Orientacao para esteira'}</Text>
        <Text style={styles.noticeText}>{environment === 'rua'
          ? 'Use um percurso plano e seguro, com 3 km bem medidos por pista ou GPS. Evite cruzamentos, descidas fortes e locais movimentados.'
          : 'Conte somente o tempo entre o inicio e o final dos 3 km. Para um resultado mais fiel, evite apoiar-se nas barras; se precisar delas para se sentir seguro, use-as, pois a seguranca vem primeiro. Ajuste a velocidade progressivamente.'}</Text>
      </View>

      <Text style={styles.copyTight}>Informe o tempo que levou para completar os 3 km. Exemplo: se fez em 20 minutos e 35 segundos, coloque 20 em minutos e 35 em segundos.</Text>

      <View style={styles.testTimeRow}>
        <View style={styles.testTimeField}>
          <Text style={styles.inputLabel}>Minutos</Text>
          <TextInput
            style={styles.input}
            value={String(selectedMinutes)}
            onChangeText={(value) => updateTestTime('minutes', value)}
            keyboardType="numeric"
            placeholder="20"
          />
        </View>
        <View style={styles.testTimeField}>
          <Text style={styles.inputLabel}>Segundos</Text>
          <TextInput
            style={styles.input}
            value={String(selectedSeconds).padStart(2, '0')}
            onChangeText={(value) => updateTestTime('seconds', value)}
            keyboardType="numeric"
            placeholder="00"
          />
        </View>
      </View>

      <View style={styles.metricGrid}>
        <Metric icon="speedometer" label="Pace medio" value={metrics.pace} />
        <Metric icon="analytics" label="VO2max est." value={metrics.vo2max} />
        <Metric icon="flash" label="vVO2max" value={metrics.vvo2} />
      </View>

      <View style={styles.zoneTable}>
        <ZoneRow zone="Z1" label="Recuperacao" pace={metrics.zones.z1} />
        <ZoneRow zone="Z2" label="Base aerobica" pace={metrics.zones.z2} />
        <ZoneRow zone="Z3" label="Moderado" pace={metrics.zones.z3} />
        <ZoneRow zone="Z4" label="Forte" pace={metrics.zones.z4} />
        <ZoneRow zone="Z5" label="Tiros curtos" pace={metrics.zones.z5} />
      </View>

      <Pressable style={[styles.primaryButton, isSaving && styles.disabledButton]} disabled={isSaving} onPress={saveTest}>
        <Text style={styles.primaryButtonText}>{isSaving ? 'Salvando...' : 'Salvar teste e ver meu plano'}</Text>
        <Ionicons name="cloud-upload" size={18} color="#ffffff" />
      </Pressable>

      <Pressable style={styles.secondaryButton} onPress={onLater}>
        <Text style={styles.secondaryButtonText}>Ainda nao fiz o teste</Text>
      </Pressable>

      {saveStatus ? <Text style={styles.statusMessage}>{saveStatus}</Text> : null}
    </View>
  );
}

function Progress({ completedToday: _completedToday, metrics, accessToken }: { completedToday: boolean; metrics: ThreeKmMetrics; accessToken: string }) {
  const [stravaReport, setStravaReport] = useState<StravaReport | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    fetch(`${API_URL}/strava/report`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((report) => {
        if (report) setStravaReport(report as StravaReport);
      })
      .catch(() => undefined);
  }, [accessToken]);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Evolucao</Text>
      <Text style={styles.titleSmall}>Resumo do aluno</Text>

      <View style={styles.metricGrid}>
        <Metric icon="checkmark-done" label="Aderencia" value={stravaReport?.summary ? `${stravaReport.summary.adherencePercent}%` : 'Sem dados'} />
        <Metric icon="map" label="Km realizados" value={stravaReport?.summary ? String(stravaReport.summary.actualKm) : 'Sem dados'} />
        <Metric icon="trophy" label="Melhor 3 km" value={metrics.pace} />
      </View>

      {!stravaReport?.summary ? <Text style={styles.formHint}>Conecte o Strava na aba propria para atualizar os indicadores automaticamente.</Text> : null}

      {stravaReport?.summary ? (
        <View style={styles.formSection}>
          <Text style={styles.formSectionTitle}>Prescrito x feito</Text>
          {stravaReport.summary.coachAnalysis ? (
            <View style={styles.coachBox}>
              <Text style={styles.coachTitle}>{stravaReport.summary.coachAnalysis.title}</Text>
              <Text style={styles.coachText}>{stravaReport.summary.coachAnalysis.text}</Text>
            </View>
          ) : null}
          <View style={styles.metricGrid}>
            <Metric icon="checkmark-done" label="Aderencia geral" value={`${stravaReport.summary.adherencePercent}%`} />
            <Metric icon="map" label="Km prescrito/feito" value={`${stravaReport.summary.prescribedKm} / ${stravaReport.summary.actualKm}`} />
            <Metric icon="time" label="Min prescrito/feito" value={`${stravaReport.summary.prescribedMinutes} / ${stravaReport.summary.actualMinutes}`} />
          </View>
          {stravaReport.items.map((item) => (
            <View style={styles.reportRow} key={`${item.date}-${item.title}`}>
              <Text style={styles.reportTitle}>{item.date} - {item.title}</Text>
              <Text style={styles.reportText}>
                {reportStatusLabel(item)}
                {item.distanceDiff !== null && item.distanceDiff !== undefined ? ` | diferenca: ${item.distanceDiff} km` : ''}
                {item.durationDiff !== null && item.durationDiff !== undefined ? ` | ${item.durationDiff} min` : ''}
                {item.pace ? ` | pace ${item.pace}` : ''}
                {item.perceivedEffort ? ` | esforco ${item.perceivedEffort}/10` : ''}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

interface TargetRaceItem {
  id: string;
  name: string;
  raceDate: string;
  distanceKm: number;
  targetSeconds: number | null;
  priority: string;
  status: string;
  notes: string | null;
  paceSecondsPerKm: number | null;
  speedKmh: number | null;
}

function TargetRaceScreen({ accessToken }: { accessToken: string }) {
  const [races, setRaces] = useState<TargetRaceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [raceDateInput, setRaceDateInput] = useState('');
  const [distanceInput, setDistanceInput] = useState('');
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  const [seconds, setSeconds] = useState('');
  const [priority, setPriority] = useState('principal');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/me/target-races`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (response.ok) setRaces((await response.json()) as TargetRaceItem[]);
    } catch {
      setMessage('Nao consegui carregar suas metas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [accessToken]);

  const distanceKm = Number(distanceInput.replace(',', '.'));
  const totalSeconds = Number(hours || '0') * 3600 + Number(minutes || '0') * 60 + Number(seconds || '0');
  const previewPace = distanceKm > 0 && totalSeconds > 0 ? formatPace(Math.round(totalSeconds / distanceKm)) : null;
  const previewSpeed = distanceKm > 0 && totalSeconds > 0 ? ((distanceKm / totalSeconds) * 3600).toFixed(2) : null;

  async function createRace() {
    if (!name.trim()) { setMessage('Digite o nome da prova.'); return; }
    const isoDate = dateInputValueToIso(raceDateInput);
    if (!isoDate) { setMessage('Digite uma data valida no formato dia/mes/ano.'); return; }
    if (!distanceKm || distanceKm <= 0) { setMessage('Digite uma distancia valida em quilometros.'); return; }
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/me/target-races`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          raceDate: isoDate,
          distanceKm,
          targetSeconds: totalSeconds > 0 ? totalSeconds : undefined,
          priority,
          notes: notes.trim() || undefined,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({} as { message?: string }));
        setMessage(typeof data.message === 'string' ? data.message : 'Nao consegui salvar essa meta.');
        return;
      }
      setName('');
      setRaceDateInput('');
      setDistanceInput('');
      setHours('');
      setMinutes('');
      setSeconds('');
      setNotes('');
      setPriority('principal');
      setMessage('Meta salva.');
      await load();
    } catch {
      setMessage('Nao consegui salvar essa meta.');
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(raceId: string, status: string) {
    try {
      const response = await fetch(`${API_URL}/me/target-races/${raceId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (response.ok) await load();
    } catch {
      setMessage('Nao consegui atualizar essa meta.');
    }
  }

  async function removeRace(raceId: string) {
    try {
      const response = await fetch(`${API_URL}/me/target-races/${raceId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } });
      if (response.ok) await load();
    } catch {
      setMessage('Nao consegui remover essa meta.');
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Prova alvo</Text>
      <Text style={styles.titleSmall}>Suas metas de prova</Text>
      <Text style={styles.copyTight}>
        Registre a prova que voce esta buscando. Vamos usar isso como norte para montar seu treino — mas fatores que nao controlamos diretamente (sua rotina, alimentacao, sono e dedicacao) tambem influenciam o resultado final. Por isso, escolha uma meta realista com aquilo que voce esta disposto a se comprometer a treinar ate la. Nao garantimos o resultado, mas vamos trabalhar para chegar o mais perto possivel dele com seguranca.
      </Text>

      <View style={styles.formSection}>
        <Text style={styles.formSectionTitle}>Nova meta</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Nome da prova (ex: Meia Maratona de SP)" />
        <TextInput style={styles.input} value={raceDateInput} onChangeText={(text) => setRaceDateInput(formatDateInputText(text))} placeholder="Data (dd/mm/aaaa)" keyboardType="number-pad" maxLength={10} />
        <TextInput style={styles.input} value={distanceInput} onChangeText={setDistanceInput} placeholder="Distancia em km (ex: 21 ou 134,5)" keyboardType="decimal-pad" />
        <Text style={styles.inputLabel}>Tempo que espera fazer (opcional)</Text>
        <View style={styles.couponRow}>
          <TextInput style={[styles.input, styles.couponInput]} value={hours} onChangeText={setHours} placeholder="Horas" keyboardType="number-pad" maxLength={3} />
          <TextInput style={[styles.input, styles.couponInput]} value={minutes} onChangeText={setMinutes} placeholder="Min" keyboardType="number-pad" maxLength={2} />
          <TextInput style={[styles.input, styles.couponInput]} value={seconds} onChangeText={setSeconds} placeholder="Seg" keyboardType="number-pad" maxLength={2} />
        </View>
        {previewPace ? <Text style={styles.formHint}>Isso equivale a um pace de {previewPace} ({previewSpeed} km/h).</Text> : null}
        <Text style={styles.inputLabel}>Prioridade</Text>
        <View style={styles.answerList}>
          {[option('Principal', 'principal'), option('Secundaria', 'secundaria')].map((item) => (
            <Pressable key={item.value} style={[styles.answerButton, priority === item.value && styles.answerButtonActive]} onPress={() => setPriority(item.value)}>
              <Text style={[styles.answerButtonText, priority === item.value && styles.answerButtonTextActive]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput style={styles.input} value={notes} onChangeText={setNotes} placeholder="Observacoes (opcional)" />
        <Pressable style={styles.primaryButton} onPress={createRace} disabled={saving}>
          <Text style={styles.primaryButtonText}>{saving ? 'Salvando...' : 'Salvar meta'}</Text>
        </Pressable>
      </View>

      {message ? <Text style={styles.statusMessage}>{message}</Text> : null}
      {loading ? <Text style={styles.statusMessage}>Carregando...</Text> : null}

      {races.map((race) => (
        <View style={styles.formSection} key={race.id}>
          <Text style={styles.formSectionTitle}>{race.name}</Text>
          <Text style={styles.reportText}>Data: {formatDayMonth(new Date(race.raceDate))} · Distancia: {race.distanceKm} km</Text>
          {race.paceSecondsPerKm ? <Text style={styles.reportText}>Pace alvo: {formatPace(race.paceSecondsPerKm)} ({race.speedKmh} km/h)</Text> : null}
          <Text style={styles.reportText}>Situacao: {race.status === 'em_andamento' ? 'Em andamento' : race.status === 'concluida' ? 'Concluida' : 'Arquivada'}</Text>
          {race.notes ? <Text style={styles.reportText}>{race.notes}</Text> : null}
          <View style={styles.couponRow}>
            {race.status !== 'concluida' ? (
              <Pressable style={styles.secondaryButton} onPress={() => updateStatus(race.id, 'concluida')}>
                <Text style={styles.secondaryButtonText}>Marcar concluida</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.secondaryButton} onPress={() => removeRace(race.id)}>
              <Text style={styles.secondaryButtonText}>Remover</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}

function FixAnswersMenu({ accessToken, onOpenOnboarding, onOpenReassessment }: { accessToken: string; onOpenOnboarding: () => void; onOpenReassessment: () => void }) {
  const [onboardingCompletedAt, setOnboardingCompletedAt] = useState<string | null>(null);
  const [reassessments, setReassessments] = useState<Array<{ id: string; completedAt: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    try {
      const [onboarding, history] = await Promise.all([
        loadInterviewState(`${API_URL}/me/onboarding`, accessToken),
        fetch(`${API_URL}/me/reassessment/history`, { headers: { Authorization: `Bearer ${accessToken}` } })
          .then((response) => (response.ok ? response.json() : []))
          .catch(() => []),
      ]);
      setOnboardingCompletedAt(onboarding?.completedAt ?? null);
      setReassessments(Array.isArray(history) ? history.filter((item: any) => item.completedAt) : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [accessToken]);

  async function correctOnboarding() {
    setBusyId('onboarding');
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/me/onboarding/reopen`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error('reopen');
      onOpenOnboarding();
    } catch {
      setMessage('Nao consegui abrir a entrevista inicial para correcao.');
    } finally {
      setBusyId(null);
    }
  }

  async function correctReassessment(id: string) {
    setBusyId(id);
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/me/reassessment/${id}/reopen`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) {
        const data = await response.json().catch(() => ({} as { message?: string }));
        setMessage(typeof data.message === 'string' ? data.message : 'Nao consegui abrir essa reavaliacao para correcao.');
        return;
      }
      onOpenReassessment();
    } catch {
      setMessage('Nao consegui abrir essa reavaliacao para correcao.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Corrigir respostas anteriores</Text>
      <Text style={styles.titleSmall}>Errou alguma resposta? Corrija aqui</Text>
      <Text style={styles.copyTight}>
        Escolha qual entrevista voce quer corrigir. Ao corrigir, suas respostas dessa entrevista especifica sao substituidas — isso e diferente de fazer uma nova reavaliacao periodica, que fica guardada como um novo registro para acompanhar sua evolucao.
      </Text>

      {loading ? <Text style={styles.statusMessage}>Carregando...</Text> : null}
      {message ? <Text style={styles.statusMessage}>{message}</Text> : null}

      {!loading ? (
        <View style={styles.formSection}>
          <Text style={styles.formSectionTitle}>Entrevista inicial</Text>
          <Text style={styles.reportText}>{onboardingCompletedAt ? `Concluida em ${formatFullDate(new Date(onboardingCompletedAt))}` : 'Ainda nao concluida'}</Text>
          {onboardingCompletedAt ? (
            <Pressable style={styles.secondaryButton} onPress={correctOnboarding} disabled={busyId === 'onboarding'}>
              <Text style={styles.secondaryButtonText}>{busyId === 'onboarding' ? 'Abrindo...' : 'Corrigir entrevista inicial'}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {reassessments.map((item) => (
        <View style={styles.formSection} key={item.id}>
          <Text style={styles.formSectionTitle}>Reavaliacao de {formatFullDate(new Date(item.completedAt))}</Text>
          <Pressable style={styles.secondaryButton} onPress={() => correctReassessment(item.id)} disabled={busyId === item.id}>
            <Text style={styles.secondaryButtonText}>{busyId === item.id ? 'Abrindo...' : 'Corrigir esta reavaliacao'}</Text>
          </Pressable>
        </View>
      ))}

      {!loading && !reassessments.length ? <Text style={styles.copyTight}>Voce ainda nao concluiu nenhuma reavaliacao periodica.</Text> : null}
    </View>
  );
}

const PAIN_REPORT_REGIONS = [
  'Joelho direito', 'Joelho esquerdo', 'Tornozelo direito', 'Tornozelo esquerdo', 'Pe direito', 'Pe esquerdo',
  'Canela direita', 'Canela esquerda', 'Panturrilha direita', 'Panturrilha esquerda', 'Coxa direita', 'Coxa esquerda',
  'Quadril direito', 'Quadril esquerdo', 'Gluteo direito', 'Gluteo esquerdo', 'Lombar/coluna', 'Nao sei responder',
];

const PAIN_ONSET_OPTIONS = [
  option('Comeca e passa durante o treino', 'starts_then_stops'),
  option('Comeca no meio do treino e continua', 'starts_mid'),
  option('So aparece depois do treino', 'after_only'),
  option('Sinto o tempo todo, treinando ou nao', 'all_the_time'),
];

const PAIN_PERSISTENCE_OPTIONS = [
  option('Esta constante, sempre presente', 'permanent'),
  option('Vai e volta (tem dias melhores e piores)', 'oscillating'),
  option('So acontece em movimentos ou posicoes especificas', 'specific_movements'),
];

const PAIN_PREVIOUS_STATUS_OPTIONS = [
  option('Nao relatei dor antes', 'none_before'),
  option('Uma dor anterior sumiu totalmente', 'resolved'),
  option('Melhorou, mas ainda sinto um pouco', 'improved'),
  option('Continua igual', 'unchanged'),
];

function PainReportScreen({ accessToken }: { accessToken: string }) {
  const [regions, setRegions] = useState<string[]>([]);
  const [otherLocation, setOtherLocation] = useState('');
  const [intensity, setIntensity] = useState<number | null>(null);
  const [onsetPattern, setOnsetPattern] = useState('');
  const [persistencePattern, setPersistencePattern] = useState('');
  const [previousPainStatus, setPreviousPainStatus] = useState('');
  const [previousRegionsAvailable, setPreviousRegionsAvailable] = useState<string[]>([]);
  const [resolvedRegions, setResolvedRegions] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<Array<{ id: string; regions: string[]; intensity: number; createdAt: string }>>([]);

  async function loadContext() {
    try {
      const [previousResponse, historyResponse] = await Promise.all([
        fetch(`${API_URL}/me/pain-reports/previous-regions`, { headers: { Authorization: `Bearer ${accessToken}` } }),
        fetch(`${API_URL}/me/pain-reports`, { headers: { Authorization: `Bearer ${accessToken}` } }),
      ]);
      if (previousResponse.ok) setPreviousRegionsAvailable((await previousResponse.json()) as string[]);
      if (historyResponse.ok) setHistory((await historyResponse.json()) as Array<{ id: string; regions: string[]; intensity: number; createdAt: string }>);
    } catch {
      setMessage('Nao consegui carregar seu historico de dor.');
    }
  }

  useEffect(() => { void loadContext(); }, [accessToken]);

  async function submit() {
    if (!regions.length) { setMessage('Marque ao menos uma regiao, ou "Nao sei responder".'); return; }
    if (!intensity) { setMessage('Marque a intensidade da dor.'); return; }
    if (!onsetPattern) { setMessage('Marque quando a dor costuma aparecer.'); return; }
    if (!persistencePattern) { setMessage('Marque como a dor tem se comportado.'); return; }
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/me/pain-reports`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          regions,
          otherLocation: otherLocation.trim() || undefined,
          intensity,
          onsetPattern,
          persistencePattern,
          previousPainStatus: previousPainStatus || undefined,
          resolvedRegions,
          comment: comment.trim() || undefined,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({} as { message?: string }));
        setMessage(typeof data.message === 'string' ? data.message : 'Nao consegui enviar o relato.');
        return;
      }
      setRegions([]);
      setOtherLocation('');
      setIntensity(null);
      setOnsetPattern('');
      setPersistencePattern('');
      setPreviousPainStatus('');
      setResolvedRegions([]);
      setComment('');
      setMessage('Relato enviado. Obrigado por avisar — vamos considerar isso no seu proximo treino.');
      await loadContext();
    } catch {
      setMessage('Nao consegui enviar o relato.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Relatar dor</Text>
      <Text style={styles.titleSmall}>Conte para a gente o que voce esta sentindo</Text>
      <Text style={styles.copyTight}>Use isto quando tiver uma dor que te preocupe ou incomode mais do que o normal. Para dor leve do dia a dia, o feedback logo apos cada treino ja e suficiente.</Text>

      <View style={styles.formSection}>
        <Text style={styles.formSectionTitle}>Onde voce sente a dor?</Text>
        <View style={styles.answerList}>
          {PAIN_REPORT_REGIONS.map((region) => {
            const selected = regions.includes(region);
            return (
              <Pressable key={region} style={[styles.answerButton, selected && styles.answerButtonActive]} onPress={() => setRegions(selected ? regions.filter((item) => item !== region) : [...regions, region])}>
                <Text style={[styles.answerButtonText, selected && styles.answerButtonTextActive]}>{region}</Text>
              </Pressable>
            );
          })}
        </View>
        <TextInput style={styles.input} value={otherLocation} onChangeText={setOtherLocation} placeholder="Outro local (opcional)" />
      </View>

      <View style={styles.formSection}>
        <Text style={styles.formSectionTitle}>Intensidade da dor (1 a 10)</Text>
        <View style={styles.scaleGrid}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((value) => (
            <Pressable key={value} style={[styles.answerButton, styles.scaleButton, intensity === value && styles.answerButtonActive]} onPress={() => setIntensity(value)}>
              <Text style={[styles.answerButtonText, intensity === value && styles.answerButtonTextActive]}>{value}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.formSection}>
        <Text style={styles.formSectionTitle}>Quando a dor costuma aparecer?</Text>
        <View style={styles.answerList}>
          {PAIN_ONSET_OPTIONS.map((item) => (
            <Pressable key={item.value} style={[styles.answerButton, onsetPattern === item.value && styles.answerButtonActive]} onPress={() => setOnsetPattern(item.value)}>
              <Text style={[styles.answerButtonText, onsetPattern === item.value && styles.answerButtonTextActive]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.formSection}>
        <Text style={styles.formSectionTitle}>Como ela tem se comportado?</Text>
        <View style={styles.answerList}>
          {PAIN_PERSISTENCE_OPTIONS.map((item) => (
            <Pressable key={item.value} style={[styles.answerButton, persistencePattern === item.value && styles.answerButtonActive]} onPress={() => setPersistencePattern(item.value)}>
              <Text style={[styles.answerButtonText, persistencePattern === item.value && styles.answerButtonTextActive]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.formSection}>
        <Text style={styles.formSectionTitle}>Alguma dor que voce relatou antes ja sumiu ou melhorou?</Text>
        <View style={styles.answerList}>
          {PAIN_PREVIOUS_STATUS_OPTIONS.map((item) => (
            <Pressable key={item.value} style={[styles.answerButton, previousPainStatus === item.value && styles.answerButtonActive]} onPress={() => setPreviousPainStatus(item.value)}>
              <Text style={[styles.answerButtonText, previousPainStatus === item.value && styles.answerButtonTextActive]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
        {(previousPainStatus === 'resolved' || previousPainStatus === 'improved') && previousRegionsAvailable.length ? (
          <View style={styles.answerList}>
            {previousRegionsAvailable.map((region) => {
              const selected = resolvedRegions.includes(region);
              return (
                <Pressable key={region} style={[styles.answerButton, selected && styles.answerButtonActive]} onPress={() => setResolvedRegions(selected ? resolvedRegions.filter((item) => item !== region) : [...resolvedRegions, region])}>
                  <Text style={[styles.answerButtonText, selected && styles.answerButtonTextActive]}>{region}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>

      <View style={styles.formSection}>
        <Text style={styles.formSectionTitle}>Comentario (opcional)</Text>
        <TextInput style={styles.input} value={comment} onChangeText={setComment} placeholder="Escreva algo mais, se quiser" multiline />
      </View>

      <Pressable style={styles.primaryButton} onPress={submit} disabled={saving}>
        <Text style={styles.primaryButtonText}>{saving ? 'Enviando...' : 'Enviar relato'}</Text>
      </Pressable>
      {message ? <Text style={styles.statusMessage}>{message}</Text> : null}

      {history.length ? (
        <View style={styles.formSection}>
          <Text style={styles.formSectionTitle}>Seus relatos anteriores</Text>
          {history.slice(0, 10).map((item) => (
            <Text key={item.id} style={styles.reportText}>{formatDayMonth(new Date(item.createdAt))} · {item.regions.join(', ') || 'Regiao nao informada'} · intensidade {item.intensity}/10</Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function StravaSync({ accessToken }: { accessToken: string }) {
  const [connection, setConnection] = useState<StravaConnectionStatus | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  async function loadStatus() {
    try {
      const response = await fetch(`${API_URL}/strava/status`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (response.ok) setConnection((await response.json()) as StravaConnectionStatus);
    } catch {
      setMessage('Nao consegui consultar a conexao agora.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadStatus();
    const timer = setInterval(() => void loadStatus(), 5000);
    return () => clearInterval(timer);
  }, [accessToken]);

  async function connectStrava() {
    if (connecting) return;
    setConnecting(true);
    setMessage('');
    const authPopup = openAuthPopup();
    authPopup?.document?.write('<p style="font-family: Arial, sans-serif; padding: 24px;">Abrindo autorizacao do Strava...</p>');
    try {
      const response = await fetch(`${API_URL}/strava/connect-url`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        authPopup?.close?.();
        setMessage('Nao consegui iniciar a autorizacao do Strava.');
        return;
      }
      const data = (await response.json()) as { url: string };
      if (authPopup?.location) authPopup.location.href = data.url;
      else Linking.openURL(data.url);
      setMessage('Conclua a autorizacao uma unica vez, sem recarregar a pagina. Esta tela reconhecera a conexao automaticamente.');
    } catch {
      authPopup?.close?.();
      setMessage('Nao consegui abrir a autorizacao do Strava.');
    } finally {
      setConnecting(false);
    }
  }

  async function verifyNow() {
    setMessage('Verificando atividades...');
    try {
      const response = await fetch(`${API_URL}/strava/sync`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        setMessage('A conta ainda nao esta conectada.');
        return;
      }
      await loadStatus();
      setMessage('Verificacao concluida. A sincronizacao automatica continua ativa.');
    } catch {
      setMessage('Nao consegui verificar agora. Tente novamente mais tarde.');
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Integracao</Text>
      <Text style={styles.titleSmall}>Sincronizar com Strava</Text>
      <Text style={styles.formHint}>Autorize uma vez. Depois, os treinos enviados pelo seu relogio ao Strava chegam automaticamente ao Panzeri Run.</Text>

      <View style={styles.formSection}>
        <View style={styles.reportRow}>
          <Text style={styles.reportTitle}>{loading ? 'Consultando conexao...' : connection?.connected ? 'Strava conectado' : 'Strava nao conectado'}</Text>
          <Text style={styles.reportText}>
            {connection?.connected
              ? connection.automaticSync
                ? 'Sincronizacao automatica ativa. Voce nao precisa apertar nenhum botao depois dos treinos.'
                : 'Conta conectada. A ativacao da sincronizacao automatica esta sendo concluida.'
              : 'Conecte sua conta para permitir o acompanhamento dos treinos pelo treinador.'}
          </Text>
        </View>

        {connection?.lastActivityAt ? (
          <View style={styles.reportRow}>
            <Text style={styles.reportTitle}>Ultima atividade recebida</Text>
            <Text style={styles.reportText}>{connection.lastActivityName ?? 'Atividade do Strava'} - {formatConnectionDate(connection.lastActivityAt)}</Text>
          </View>
        ) : null}

        {!connection?.connected ? (
          <Pressable style={[styles.primaryButton, connecting && styles.disabledButton]} disabled={connecting} onPress={connectStrava}>
            <Text style={styles.primaryButtonText}>{connecting ? 'Abrindo autorizacao...' : 'Conectar com Strava'}</Text>
            <Ionicons name="link" size={18} color="#ffffff" />
          </Pressable>
        ) : (
          <Pressable style={styles.secondaryOutlineButton} onPress={verifyNow}>
            <Text style={styles.secondaryOutlineButtonText}>Verificar agora</Text>
            <Ionicons name="refresh" size={18} color="#0f766e" />
          </Pressable>
        )}
        {message ? <Text style={styles.statusMessage}>{message}</Text> : null}
      </View>
    </View>
  );
}

function formatConnectionDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function Anamnese({
  accessToken,
  userEmail,
  userName,
  savedMe,
  onSavedMeChange,
  onNameChange,
  routineDays,
  onRoutineChange,
}: {
  accessToken: string;
  userEmail: string;
  userName: string;
  savedMe: MeResponse | null;
  onSavedMeChange: (me: MeResponse | null) => void;
  onNameChange: (name: string) => void;
  routineDays: RoutineDay[];
  onRoutineChange: (routineDays: RoutineDay[]) => void;
}) {
  const [name, setName] = useState(userName);
  const [birthDate, setBirthDate] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [sleep, setSleep] = useState('6_7');
  const [stress, setStress] = useState('moderado');
  const [anxiety, setAnxiety] = useState('nao');
  const [healthProblems, setHealthProblems] = useState('');
  const [medications, setMedications] = useState('');
  const [injuries, setInjuries] = useState('Sem lesao impeditiva informada.');
  const [preferredModalities, setPreferredModalities] = useState<string[]>(['Corrida']);
  const [otherModalities, setOtherModalities] = useState<string[]>([]);
  const [trainingLocations, setTrainingLocations] = useState<string[]>(['Corrida na rua']);
  const [mainGoal, setMainGoal] = useState('');
  const [status, setStatus] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!savedMe) {
      return;
    }

    setName(savedMe.name ?? userName);
    setBirthDate(savedMe.birthDate ? formatDateFromApi(savedMe.birthDate) : '');
    setHeightCm(savedMe.heightCm ? String(savedMe.heightCm) : '');
    setWeightKg(savedMe.weightKg ? String(savedMe.weightKg).replace('.', ',') : '');
    setSleep(savedMe.healthProfile?.averageSleep ?? '6_7');
    setStress(savedMe.healthProfile?.stressLevel ?? 'moderado');
    setAnxiety(savedMe.healthProfile?.anxietyLevel ?? 'nao');
    setHealthProblems(savedMe.healthProfile?.healthProblems ?? '');
    setMedications(savedMe.healthProfile?.medications ?? '');
    setInjuries(savedMe.healthProfile?.previousInjuries ?? 'Sem lesao impeditiva informada.');
    setPreferredModalities(savedMe.preferences?.preferredModalities?.length ? savedMe.preferences.preferredModalities : ['Corrida']);
    setOtherModalities(savedMe.preferences?.otherModalities ?? []);
    setTrainingLocations(savedMe.preferences?.trainingLocations?.length ? savedMe.preferences.trainingLocations : ['Corrida na rua']);
    setMainGoal(canonicalGoal(savedMe.preferences?.mainGoal));
  }, [savedMe, userName]);

  async function saveProfile() {
    const cleanName = name.trim();
    const cleanEmail = (savedMe?.email ?? userEmail).trim().toLowerCase();
    const apiBirthDate = parseBrazilianDate(birthDate);
    const parsedHeight = Number(heightCm);
    const parsedWeight = Number(weightKg.replace(',', '.'));

    setStatus('');

    if (!accessToken) {
      setStatus('Entre novamente na conta para salvar o perfil.');
      return;
    }

    if (!cleanName || !cleanEmail || !apiBirthDate || !Number.isFinite(parsedHeight) || !Number.isFinite(parsedWeight)) {
      setStatus('Preencha nome, nascimento em dia/mes/ano, altura e peso.');
      return;
    }

    if (parsedHeight < 100 || parsedHeight > 230) {
      setStatus('Informe uma altura entre 100 e 230 cm.');
      return;
    }

    if (parsedWeight < 30 || parsedWeight > 250) {
      setStatus('Informe um peso entre 30 e 250 kg.');
      return;
    }

    setIsSaving(true);
    try {
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      };

      const response = await fetch(`${API_URL}/me/anamnese`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          profile: {
            name: cleanName,
            email: cleanEmail,
            birthDate: apiBirthDate,
            sex: 'prefiro_nao_informar',
            heightCm: Math.round(parsedHeight),
            weightKg: parsedWeight,
          },
          health: {
            averageSleep: sleep,
            stressLevel: stress,
            anxietyLevel: anxiety,
            previousInjuries: injuries,
            healthProblems,
            medications,
          },
          preferences: {
            preferredModalities,
            otherModalities,
            trainingLocations,
            mainGoal,
            experienceLevel: 'iniciante_intermediario',
          },
          availability: {
            availability: routineToAvailability(routineDays),
          },
        }),
      });

      if (response.status === 404) {
        const legacySaved = await saveAnamneseWithLegacyApi({
          headers,
          profile: {
            name: cleanName,
            email: cleanEmail,
            birthDate: apiBirthDate,
            sex: 'prefiro_nao_informar',
            heightCm: Math.round(parsedHeight),
            weightKg: parsedWeight,
          },
          health: {
            averageSleep: sleep,
            stressLevel: stress,
            anxietyLevel: anxiety,
            previousInjuries: injuries,
            healthProblems,
            medications,
          },
          preferences: {
            preferredModalities,
            otherModalities,
            trainingLocations,
            mainGoal,
            experienceLevel: 'iniciante_intermediario',
          },
          availability: routineToAvailability(routineDays),
        });

        if (!legacySaved.ok) {
          setStatus(legacySaved.status === 401 ? 'Sua sessao expirou. Saia e entre novamente.' : `Nao consegui salvar: ${legacySaved.message}`);
          return;
        }

        onNameChange(cleanName);
        onSavedMeChange(await loadSavedMe(accessToken));
        setStatus('Anamnese salva. O treino da semana sera atualizado.');
        return;
      }

      if (!response.ok) {
        const apiMessage = await readApiError(response);
        setStatus(response.status === 401 ? 'Sua sessao expirou. Saia e entre novamente.' : `Nao consegui salvar: ${apiMessage}`);
        return;
      }

      onNameChange(cleanName);
      onSavedMeChange((await response.json()) as MeResponse);
      setStatus('Anamnese salva. O treino da semana sera atualizado.');
    } catch {
      setStatus('Nao consegui conectar com a API agora.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Anamnese</Text>
      <Text style={styles.titleSmall}>Suas informacoes</Text>

      <View style={styles.formGrid}>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Nome" />
        <TextInput
          style={styles.input}
          value={birthDate}
          onChangeText={(value) => setBirthDate(formatBrazilianDateInput(value))}
          keyboardType="numeric"
          placeholder="Nascimento: DD/MM/AAAA"
        />
        <TextInput
          style={styles.input}
          value={heightCm}
          onChangeText={(value) => setHeightCm(value.replace(/[^0-9]/g, ''))}
          keyboardType="numeric"
          placeholder="Altura em cm"
        />
        <TextInput
          style={styles.input}
          value={weightKg}
          onChangeText={(value) => setWeightKg(value.replace(/[^0-9,.]/g, ''))}
          keyboardType="numeric"
          placeholder="Peso em kg"
        />
      </View>

      <View style={styles.formSection}>
        <Text style={styles.formSectionTitle}>Saude e seguranca</Text>
        <Text style={styles.formHint}>Sono medio</Text>
        <OptionGroup
          options={[
            { label: 'Menos de 5h', value: 'menos_5' },
            { label: '5 a 6h', value: '5_6' },
            { label: '6 a 7h', value: '6_7' },
            { label: '7 a 8h', value: '7_8' },
            { label: 'Mais de 8h', value: 'mais_8' },
          ]}
          selected={[sleep]}
          onToggle={(value) => setSleep(value)}
        />

        <Text style={styles.formHint}>Nivel de estresse</Text>
        <OptionGroup
          options={[
            { label: 'Baixo', value: 'baixo' },
            { label: 'Moderado', value: 'moderado' },
            { label: 'Alto', value: 'alto' },
            { label: 'Muito alto', value: 'muito_alto' },
          ]}
          selected={[stress]}
          onToggle={(value) => setStress(value)}
        />

        <Text style={styles.formHint}>Ansiedade</Text>
        <OptionGroup
          options={[
            { label: 'Nao', value: 'nao' },
            { label: 'Leve', value: 'leve' },
            { label: 'Moderada', value: 'moderada' },
            { label: 'Alta', value: 'alta' },
          ]}
          selected={[anxiety]}
          onToggle={(value) => setAnxiety(value)}
        />

        <TextInput
          style={[styles.input, styles.multilineInput]}
          value={injuries}
          onChangeText={setInjuries}
          multiline
          placeholder="Lesoes, cirurgias ou limitacoes"
        />
        <TextInput
          style={[styles.input, styles.multilineInput]}
          value={healthProblems}
          onChangeText={setHealthProblems}
          multiline
          placeholder="Problemas de saude relevantes"
        />
        <TextInput
          style={styles.input}
          value={medications}
          onChangeText={setMedications}
          placeholder="Medicamentos em uso"
        />
      </View>

      <View style={styles.formSection}>
        <Text style={styles.formSectionTitle}>Objetivo</Text>
        <OptionGroup options={toOptions(goalOptions)} selected={[mainGoal]} onToggle={setMainGoal} />
      </View>

      <View style={styles.formSection}>
        <Text style={styles.formSectionTitle}>Modalidades preferidas</Text>
        <OptionGroup options={toOptions(modalityOptions)} selected={preferredModalities} onToggle={(value) => toggleSelection(preferredModalities, value, setPreferredModalities)} />
      </View>

      <View style={styles.formSection}>
        <Text style={styles.formSectionTitle}>Outras modalidades</Text>
        <Text style={styles.formHint}>Marque se ja pratica ou vai iniciar junto com o programa.</Text>
        <OptionGroup options={toOptions(modalityOptions)} selected={otherModalities} onToggle={(value) => toggleSelection(otherModalities, value, setOtherModalities)} />
      </View>

      <View style={styles.formSection}>
        <Text style={styles.formSectionTitle}>Locais disponiveis</Text>
        <OptionGroup options={toOptions(locationOptions)} selected={trainingLocations} onToggle={(value) => toggleSelection(trainingLocations, value, setTrainingLocations)} />
      </View>

      <View style={styles.formSection}>
        <Text style={styles.formSectionTitle}>Dias e disponibilidade</Text>
        <Text style={styles.formHint}>Em cada dia, escolha o que pode fazer. Se marcar Sem treinos, as outras opcoes saem.</Text>
        <RoutineEditor routineDays={routineDays} onChange={onRoutineChange} />
      </View>

      <Pressable style={[styles.primaryButton, isSaving && styles.disabledButton]} disabled={isSaving} onPress={saveProfile}>
        <Text style={styles.primaryButtonText}>{isSaving ? 'Salvando...' : 'Salvar anamnese'}</Text>
        <Ionicons name="save" size={18} color="#ffffff" />
      </Pressable>

      {status ? <Text style={styles.statusMessage}>{status}</Text> : null}
    </View>
  );
}

function Billing({ accessToken }: { accessToken: string }) {
  const [details, setDetails] = useState<{
    planName: string;
    priceLabel: string;
    status: string;
    providerStatus?: string | null;
    nextChargeAt?: string | null;
    checkoutUrl?: string | null;
    canCancel: boolean;
    syncError?: boolean;
    hasCpf?: boolean;
  } | null>(null);
  const [message, setMessage] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cpf, setCpf] = useState('');

  async function loadBilling(showConfirmation = false) {
    if (showConfirmation) setMessage('Consultando sua assinatura...');
    try {
      const response = await fetchWithRetry(API_URL + '/billing/me', { headers: { Authorization: 'Bearer ' + accessToken } });
      if (!response.ok) throw new Error();
      const data = await response.json();
      setDetails(data);
      if (showConfirmation) {
        setMessage(data.syncError ? 'Mostrando a ultima situacao salva. Nao consegui atualizar agora.' : 'Situacao da assinatura atualizada.');
      }
    } catch {
      setMessage('Nao consegui consultar sua assinatura agora.');
    }
  }

  useEffect(() => { void loadBilling(false); }, [accessToken]);

  async function subscribe() {
    if (!details?.hasCpf && cpf.replace(/\D/g, '').length !== 11) {
      setMessage('Informe um CPF valido (11 numeros) para continuar.');
      return;
    }
    setMessage('Preparando pagamento seguro...');
    let response: Response;
    try {
      response = await fetchWithRetry(API_URL + '/billing/checkout', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpf: cpf.replace(/\D/g, '') }),
      });
    } catch {
      setMessage('Nao consegui conectar ao servidor. Verifique sua internet e tente novamente.');
      return;
    }
    try {
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.checkoutUrl) throw new Error(typeof data.message === 'string' ? data.message : 'Nao consegui abrir o pagamento. Tente novamente.');
      setMessage('Conclua o pagamento e volte ao aplicativo.');
      await Linking.openURL(data.checkoutUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Nao consegui abrir o pagamento. Tente novamente.');
    }
  }

  async function applyBillingCoupon() {
    if (!couponCode.trim()) {
      setMessage('Digite seu cupom.');
      return;
    }
    setMessage('Aplicando cupom...');
    let response: Response;
    try {
      response = await fetchWithRetry(API_URL + '/billing/coupon', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: couponCode }),
      });
    } catch {
      setMessage('Nao consegui conectar ao servidor. Verifique sua internet e tente novamente.');
      return;
    }
    try {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : 'Cupom invalido.');
      setCouponCode('');
      setMessage(data.message ?? 'Cupom aplicado. Acesso liberado.');
      await loadBilling(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Cupom invalido.');
    }
  }

  async function cancel() {
    setMessage('Cancelando assinatura...');
    try {
      const response = await fetch(API_URL + '/billing/cancel', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + accessToken },
      });
      const data = await response.json();
      if (!response.ok) throw new Error();
      setConfirmCancel(false);
      setMessage(data.message ?? 'Assinatura cancelada.');
      await loadBilling();
    } catch {
      setMessage('Nao consegui cancelar agora. Tente novamente.');
    }
  }

  const active = details && ['active', 'manual_active', 'grace'].includes(details.status);
  const paymentConfirmed = details?.providerStatus === 'active' || details?.providerStatus === 'confirmed' || details?.providerStatus === 'received';
  const needsPaymentSetup = !paymentConfirmed;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Plano e faturamento</Text>
      <Text style={styles.titleSmall}>{details?.planName ?? 'Panzeri Run - Plano mensal'}</Text>
      <View style={styles.formSection}>
        <Text style={styles.formSectionTitle}>Sua assinatura</Text>
        <Text style={styles.reportText}>Valor: {details?.priceLabel ?? 'R$ 19,90 por mes'}</Text>
        <Text style={styles.reportText}>Situacao: {active ? 'Ativa' : details?.status === 'overdue' ? 'Pagamento pendente' : details?.status === 'canceled' ? 'Cancelada' : 'Aguardando ativacao'}</Text>
        <Text style={styles.reportText}>Pagamento: {paymentConfirmed ? 'Pagamento confirmado' : active ? 'Assinatura ativa' : 'Aguardando pagamento'}</Text>
        {details?.nextChargeAt ? <Text style={styles.reportText}>Proxima cobranca: {new Date(details.nextChargeAt).toLocaleDateString('pt-BR')}</Text> : null}
      </View>

      {needsPaymentSetup ? (
        <View style={styles.formSection}>
          {!details?.hasCpf ? (
            <>
              <Text style={styles.formSectionTitle}>CPF</Text>
              <Text style={styles.formHint}>Necessario para gerar a cobranca no Asaas.</Text>
              <TextInput style={styles.input} value={cpf} onChangeText={setCpf} placeholder="Somente numeros" keyboardType="number-pad" maxLength={14} />
            </>
          ) : null}
          <Pressable style={styles.primaryButton} onPress={subscribe}>
            <Text style={styles.primaryButtonText}>{active ? 'Atualizar forma de pagamento' : 'Ativar assinatura'}</Text>
            <Ionicons name="card" size={18} color="#ffffff" />
          </Pressable>
        </View>
      ) : null}

      {!active ? (
        <View style={styles.formSection}>
          <Text style={styles.formSectionTitle}>Cupom de acesso</Text>
          <Text style={styles.formHint}>Use apenas se voce recebeu um cupom do treinador.</Text>
          <View style={styles.couponRow}>
            <TextInput style={[styles.input, styles.couponInput]} value={couponCode} onChangeText={setCouponCode} placeholder="Digite seu cupom" autoCapitalize="characters" />
            <Pressable style={styles.couponButton} onPress={applyBillingCoupon}>
              <Text style={styles.couponButtonText}>Aplicar</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {details?.canCancel && !confirmCancel ? (
        <Pressable style={styles.secondaryButton} onPress={() => setConfirmCancel(true)}>
          <Text style={styles.secondaryButtonText}>Cancelar assinatura</Text>
        </Pressable>
      ) : null}

      {confirmCancel ? (
        <View style={styles.formSection}>
          <Text style={styles.formSectionTitle}>Confirmar cancelamento?</Text>
          <Text style={styles.formHint}>As proximas cobrancas serao interrompidas e o acesso sera encerrado.</Text>
          <Pressable style={styles.secondaryButton} onPress={cancel}><Text style={styles.secondaryButtonText}>Sim, cancelar</Text></Pressable>
          <Pressable style={styles.primaryButton} onPress={() => setConfirmCancel(false)}><Text style={styles.primaryButtonText}>Manter assinatura</Text></Pressable>
        </View>
      ) : null}

      <Pressable style={styles.secondaryButton} onPress={() => loadBilling(true)}>
        <Ionicons name="refresh" size={18} color="#0f766e" />
        <Text style={styles.secondaryButtonText}>Atualizar situacao</Text>
      </Pressable>
      {message ? <Text style={styles.statusMessage}>{message}</Text> : null}
      <Text style={styles.formHint}>O pagamento e processado em ambiente seguro pelo Asaas via cartao de credito. A cobranca e renovada automaticamente todo mes.</Text>
    </View>
  );
}
function AppMenu({ activeTab, onChange, onLogout }: { activeTab: Tab; onChange: (tab: Tab) => void; onLogout: () => void }) {
  const tabs: Array<{ id: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
    { id: 'week', label: 'Treino da semana', icon: 'calendar' },
    { id: 'interview', label: 'Entrevista inicial', icon: 'chatbubbles' },
    { id: 'reassessment', label: 'Reavaliacao periodica', icon: 'refresh-circle' },
    { id: 'fixAnswers', label: 'Corrigir respostas anteriores', icon: 'create-outline' },
    { id: 'test', label: 'Teste de VO2 max', icon: 'stopwatch' },
    { id: 'targetRace', label: 'Prova alvo', icon: 'trophy' },
    { id: 'painReport', label: 'Relatar dor', icon: 'medkit' },
    { id: 'progress', label: 'Evolucao', icon: 'stats-chart' },
    { id: 'strava', label: 'Sincronizar com Strava', icon: 'sync' },
    { id: 'billing', label: 'Plano e faturamento', icon: 'card' },
    { id: 'profile', label: 'Perfil', icon: 'person' },
  ];

  return (
    <View style={styles.appMenu}>
      {tabs.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <Pressable style={[styles.menuItem, active && styles.menuItemActive]} key={tab.id} onPress={() => onChange(tab.id)}>
            <Ionicons name={tab.icon} size={21} color={active ? '#0f766e' : '#64748b'} />
            <Text style={[styles.menuItemText, active && styles.menuItemTextActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
      <Pressable style={styles.menuItem} onPress={onLogout}>
        <Ionicons name="log-out-outline" size={21} color="#64748b" />
        <Text style={styles.menuItemText}>Sair</Text>
      </Pressable>
    </View>
  );
}

async function refreshAuthSession(refreshToken: string, saved?: AuthSession): Promise<AuthSession | null> {
  try {
    const response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as AuthResponse;
    if (!data.tokens?.accessToken || !data.tokens.refreshToken) {
      return null;
    }
    return {
      email: saved?.email ?? '',
      name: saved?.name ?? '',
      accessToken: data.tokens.accessToken,
      refreshToken: data.tokens.refreshToken,
    };
  } catch {
    return null;
  }
}

async function restoreAuthSession(): Promise<AuthSession | null> {
  try {
    const raw = await AsyncStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) {
      return null;
    }
    const saved = JSON.parse(raw) as AuthSession;
    if (!saved.refreshToken) {
      await AsyncStorage.removeItem(AUTH_SESSION_KEY);
      return null;
    }
    const refreshed = await refreshAuthSession(saved.refreshToken, saved);
    if (!refreshed) {
      await AsyncStorage.removeItem(AUTH_SESSION_KEY);
    }
    return refreshed;
  } catch {
    await AsyncStorage.removeItem(AUTH_SESSION_KEY);
    return null;
  }
}

function Metric({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.metricCard}>
      <Ionicons name={icon} size={22} color="#0f766e" />
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function SessionCard({
  icon,
  title,
  detail,
  note,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  detail: string;
  note: string;
}) {
  return (
    <View style={styles.sessionCard}>
      <View style={styles.sessionIcon}>
        <Ionicons name={icon} size={22} color="#111827" />
      </View>
      <View style={styles.sessionText}>
        <Text style={styles.sessionTitle}>{title}</Text>
        <Text style={styles.sessionDetail}>{detail}</Text>
        <Text style={styles.sessionNote}>{note}</Text>
      </View>
    </View>
  );
}

function SessionPrescription({ session, metrics }: { session: WeekPlanSession; metrics: ThreeKmMetrics }) {
  const structure = session.structure;
  if (!structure) {
    return null;
  }

  if (structure.type === 'strength') {
    return <StrengthExerciseList category={structure.category} exercises={structure.exercises ?? []} />;
  }

  if (structure.type === 'aerobic') {
    return (
      <View style={styles.prescriptionBox}>
        {structure.guidance ? <Text style={styles.prescriptionText}>{structure.guidance}</Text> : null}
        {structure.blocks?.map((block) => (
          <Text style={styles.prescriptionText} key={block.label}>
            {block.label}: {block.durationMin} min {block.zone ? `| ${block.zone}` : ''}
            {block.guidance ? ` | ${block.guidance}` : ''}
          </Text>
        ))}
      </View>
    );
  }

  const mainZone = structure.zone ?? session.zone;
  const mainPace = structure.paceRange ?? metricPaceForZone(mainZone, metrics);
  const mainSpeed = structure.speedRange ?? speedRangeFromPace(mainPace) ?? (structure.speedKmh ? `${formatDecimal(structure.speedKmh)} km/h` : null);
  const runBlocks: NonNullable<Extract<SessionStructure, { type: 'run' }>['blocks']> = structure.blocks?.length
    ? structure.blocks
    : [{
        label: 'Treino principal',
        durationMin: structure.durationMin ?? session.durationMin ?? 0,
        durationType: 'time',
        distanceValue: structure.distanceKm ?? session.distanceKm ?? undefined,
        distanceUnit: 'km',
        zone: mainZone,
        paceRange: mainPace,
        speedKmh: structure.speedKmh,
        speedRange: mainSpeed,
      }];

  return (
    <View style={styles.prescriptionBox}>
      <View style={styles.runSummary}>
        <View>
          <Text style={styles.runMetricLabel}>Distancia prevista</Text>
          <Text style={styles.runMetricValue}>{structure.distanceKm ?? session.distanceKm ?? '-'} km</Text>
        </View>
        <View>
          <Text style={styles.runMetricLabel}>Duracao total</Text>
          <Text style={styles.runMetricValue}>{structure.durationRange ?? `${structure.durationMin ?? session.durationMin ?? '-'} min`}</Text>
        </View>
      </View>
      {runBlocks.map((block) => {
        if (block.repeatCount && block.steps?.length) {
          return (
            <View style={styles.runBlock} key={block.label}>
              <Text style={styles.runBlockTitle}>Repetir {block.repeatCount}x</Text>
              {block.steps.map((step, index) => (
                <Text style={styles.prescriptionText} key={`${step.label}-${index}`}>
                  - {step.label} por {step.distanceValue}{step.distanceUnit ?? 'km'}
                  {step.paceRange ? ` - Pace (${step.paceRange})` : ''}
                  {step.speedRange ? ` | Velocidade (${step.speedRange})` : ''}
                  {step.durationRange ? ` - completar entre ${step.durationRange}` : ''}
                </Text>
              ))}
            </View>
          );
        }
        const pace = block.paceRange ?? metricPaceForZone(block.zone, metrics);
        const speed = block.speedRange ?? speedRangeFromPace(pace) ?? (block.speedKmh ? `${formatDecimal(block.speedKmh)} km/h` : null);
        return (
          <View style={styles.runBlock} key={block.label}>
            <View style={styles.runBlockHeader}>
              <Text style={styles.runBlockTitle}>{block.label}</Text>
              <Text style={styles.runBlockDuration}>{runBlockDurationLabel(block)}</Text>
            </View>
            <View style={styles.runBlockMetrics}>
              <Text style={styles.runBlockMetric}><Text style={styles.runBlockLabel}>Distancia</Text>{'\n'}{runBlockDistanceLabel(block)}</Text>
              <Text style={styles.runBlockMetric}><Text style={styles.runBlockLabel}>Zona</Text>{'\n'}{block.zone ?? mainZone}</Text>
              <Text style={styles.runBlockMetric}><Text style={styles.runBlockLabel}>Pace</Text>{'\n'}{pace ?? 'Cadastre o teste de 3 km'}</Text>
              <Text style={styles.runBlockMetric}><Text style={styles.runBlockLabel}>Velocidade</Text>{'\n'}{speed ?? 'Cadastre o teste de 3 km'}</Text>
            </View>
            {block.rpe ? <Text style={styles.prescriptionText}>Percepcao de esforco: {rpeLabel(block.rpe)}</Text> : null}
            {block.guidance ? <Text style={styles.prescriptionText}>{block.guidance}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

function StrengthExerciseList({ category, exercises }: { category?: string; exercises: NonNullable<Extract<SessionStructure, { type: 'strength' }>['exercises']> }) {
  const [openExercise, setOpenExercise] = useState<number | null>(null);
  return (
    <View style={styles.prescriptionBox}>
      {category ? <Text style={styles.prescriptionCategory}>{category}</Text> : null}
      <View style={styles.strengthListHeader}>
        <Text style={styles.strengthHeaderText}>Exercicios</Text>
        <Text style={styles.strengthHeaderText}>{exercises.length} itens</Text>
      </View>
      {exercises.map((exercise, index) => {
        const isOpen = openExercise === index;
        return (
          <View style={styles.strengthExercise} key={`${exercise.name}-${index}`}>
            <Pressable style={styles.strengthExerciseTop} onPress={() => setOpenExercise(isOpen ? null : index)}>
              <View style={styles.exerciseNumber}><Text style={styles.exerciseNumberText}>{index + 1}</Text></View>
              <View style={styles.strengthExerciseName}>
                <Text style={styles.exerciseName}>{exercise.name}</Text>
                <Text style={styles.exerciseSummary}>{exercise.sets} series | {exercise.reps} reps | pausa {exercise.restSeconds}s</Text>
              </View>
              <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color="#0f766e" />
            </Pressable>
            {isOpen ? (
              <View style={styles.exerciseExplanation}>
                <View style={styles.exerciseMetrics}>
                  <ExerciseMetric label="Series" value={String(exercise.sets)} />
                  <ExerciseMetric label="Repeticoes" value={exercise.reps} />
                  <ExerciseMetric label="Intensidade" value={exercise.intensity ?? 'Moderada'} />
                  <ExerciseMetric label="Pausa" value={`${exercise.restSeconds}s`} />
                </View>
                {exercise.cadence ? <Text style={styles.exerciseCadence}>Cadencia: {exercise.cadence}</Text> : null}
                <Text style={styles.explanationTitle}>Explicacao</Text>
                <Text style={styles.prescriptionText}>{exercise.description || 'Explicacao ainda nao cadastrada.'}</Text>
                {exercise.videoUrl ? (
                  <Pressable style={styles.videoButton} onPress={() => Linking.openURL(exercise.videoUrl!)}>
                    <Ionicons name="play-circle" size={16} color="#0f766e" />
                    <Text style={styles.videoButtonText}>Assistir demonstracao</Text>
                  </Pressable>
                ) : <Text style={styles.noVideoText}>Exercicio sem video cadastrado.</Text>}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function ExerciseMetric({ label, value }: { label: string; value: string }) {
  return <View style={styles.exerciseMetric}><Text style={styles.exerciseMetricLabel}>{label}</Text><Text style={styles.exerciseMetricValue}>{value}</Text></View>;
}

function CompletionForm({
  session,
  draft,
  onChange,
  onSave,
  message,
}: {
  session: WeekPlanSession;
  draft: CompletionDraft;
  onChange: (patch: Partial<CompletionDraft>) => void;
  onSave: () => void;
  message?: string;
}) {
  const isRun = session.structure?.type === 'run';
  const isAerobic = session.structure?.type === 'aerobic';
  const isStrength = session.structure?.type === 'strength';

  return (
    <View style={styles.completionBox}>
      <Text style={styles.completionTitle}>Registro do treino</Text>
      <View style={styles.completionStatusRow}>
        {[
          { label: 'Feito', value: 'done' },
          { label: 'Nao feito', value: 'missed' },
          { label: 'Ajustado', value: 'adjusted' },
        ].map((option) => (
          <Pressable
            key={option.value}
            style={[styles.completionChip, draft.status === option.value && styles.completionChipActive]}
            onPress={() => onChange({ status: option.value as CompletionDraft['status'] })}
          >
            <Text style={[styles.completionChipText, draft.status === option.value && styles.completionChipTextActive]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.completionFieldGroup}>
        <Text style={styles.inputLabel}>Data realizada</Text>
        <TextInput
          style={styles.compactInput}
          value={draft.completedDate}
          onChangeText={(value) => onChange({ completedDate: formatDateInputText(value) })}
          keyboardType="numeric"
          placeholder="DD/MM/AAAA"
          maxLength={10}
        />
      </View>

      {(isRun || isAerobic) && (
        <View style={styles.completionGrid}>
          <View style={styles.completionFieldGroup}>
            <Text style={styles.inputLabel}>Tempo (min)</Text>
            <TextInput
              style={styles.compactInput}
              value={draft.durationMin}
              onChangeText={(value) => onChange({ durationMin: value.replace(/[^0-9]/g, '') })}
              keyboardType="numeric"
              placeholder="Ex: 45"
            />
          </View>
          {isRun ? (
            <>
              <View style={styles.completionFieldGroup}>
                <Text style={styles.inputLabel}>Distancia (km)</Text>
                <TextInput
                  style={styles.compactInput}
                  value={draft.distanceKm}
                  onChangeText={(value) => onChange({ distanceKm: value.replace(/[^0-9,.]/g, '') })}
                  keyboardType="numeric"
                  placeholder="Ex: 5,4"
                />
              </View>
              <View style={styles.completionFieldGroup}>
                <Text style={styles.inputLabel}>Pace medio</Text>
                <TextInput
                  style={styles.compactInput}
                  value={draft.avgPace}
                  onChangeText={(value) => onChange({ avgPace: value })}
                  placeholder="mm:ss"
                />
              </View>
            </>
          ) : null}
        </View>
      )}

      {isStrength ? (
        <TextInput
          style={[styles.compactInput, styles.multilineInput]}
          value={draft.loadsText}
          onChangeText={(value) => onChange({ loadsText: value })}
          multiline
          placeholder="Cargas usadas por exercicio"
        />
      ) : null}

      <Text style={styles.formHint}>Percepcao de dificuldade do treino (RPE){draft.status === 'done' ? ' - obrigatorio' : ' - opcional'}</Text>
      <View style={styles.completionStatusRow}>
        {Array.from({ length: 10 }, (_, index) => String(index + 1)).map((value) => (
          <Pressable
            key={value}
            style={[styles.completionChip, draft.perceivedEffort === value && styles.completionChipActive]}
            onPress={() => onChange({ perceivedEffort: value })}
          >
            <Text style={[styles.completionChipText, draft.perceivedEffort === value && styles.completionChipTextActive]}>{value}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.formHint}>Satisfacao com o treino proposto (opcional)</Text>
      <View style={styles.completionStatusRow}>
        {[
          { label: 'Amei', value: 'amei' },
          { label: 'Gostei', value: 'gostei' },
          { label: 'Neutro', value: 'neutro' },
          { label: 'Nao gostei', value: 'nao_gostei' },
          { label: 'Detestei', value: 'detestei' },
        ].map((option) => (
          <Pressable
            key={option.value}
            style={[styles.completionChip, draft.satisfaction === option.value && styles.completionChipActive]}
            onPress={() => onChange({ satisfaction: option.value })}
          >
            <Text style={[styles.completionChipText, draft.satisfaction === option.value && styles.completionChipTextActive]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.formHint}>Sentiu dor nesse treino?</Text>
      <View style={styles.completionStatusRow}>
        {[
          { label: 'Nao', value: 'none' },
          { label: 'Sim, leve', value: 'leve' },
          { label: 'Sim, incomodou bastante', value: 'forte' },
        ].map((option) => (
          <Pressable
            key={option.value}
            style={[styles.completionChip, draft.painFlag === option.value && styles.completionChipActive]}
            onPress={() => onChange({ painFlag: option.value })}
          >
            <Text style={[styles.completionChipText, draft.painFlag === option.value && styles.completionChipTextActive]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.formHint}>
        Quanto mais sincero e detalhado for seu comentario, melhor conseguimos ajustar a qualidade dos seus proximos treinos.
      </Text>
      <TextInput
        style={[styles.compactInput, styles.multilineInput]}
        value={draft.notes}
        onChangeText={(value) => onChange({ notes: value })}
        multiline
        placeholder="Comentario sobre o treino (opcional): o que achou, dificuldades, dores..."
      />

      <Pressable style={styles.saveCompletionButton} onPress={onSave}>
        <Ionicons name="checkmark-circle" size={16} color="#ffffff" />
        <Text style={styles.saveCompletionText}>Confirmar treino e enviar feedback</Text>
      </Pressable>
      {message ? <Text style={styles.completionConfirmation}>{message}</Text> : null}
    </View>
  );
}

function ZoneRow({ zone, label, pace }: { zone: string; label: string; pace: string }) {
  return (
    <View style={styles.zoneRow}>
      <Text style={styles.zoneName}>{zone}</Text>
      <Text style={styles.zoneLabel}>{label}</Text>
      <Text style={styles.zonePace}>{pace}</Text>
    </View>
  );
}

function Badge({
  icon,
  title,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
}) {
  return (
    <View style={styles.badge}>
      <Ionicons name={icon} size={19} color="#92400e" />
      <Text style={styles.badgeText}>{title}</Text>
    </View>
  );
}

function RoutineEditor({
  routineDays,
  onChange,
}: {
  routineDays: RoutineDay[];
  onChange: (routineDays: RoutineDay[]) => void;
}) {
  function updateDay(weekday: number, patch: Partial<RoutineDay>) {
    onChange(routineDays.map((day) => (day.weekday === weekday ? { ...day, ...patch } : day)));
  }

  function toggleDayModality(day: RoutineDay, option: string) {
    if (option === 'Sem treinos') {
      updateDay(day.weekday, { modalities: ['Sem treinos'], minutesByModality: {} });
      return;
    }

    const withoutRest = day.modalities.filter((item) => item !== 'Sem treinos');
    const next = withoutRest.includes(option) ? withoutRest.filter((item) => item !== option) : [...withoutRest, option];
    const nextMinutes = next.reduce<Record<string, string>>((acc, modality) => {
      acc[modality] = day.minutesByModality[modality] ?? '45';
      return acc;
    }, {});

    updateDay(day.weekday, {
      modalities: next.length ? next : ['Sem treinos'],
      minutesByModality: next.length ? nextMinutes : {},
    });
  }

  function updateMinutes(day: RoutineDay, modality: string, minutes: string) {
    updateDay(day.weekday, {
      minutesByModality: {
        ...day.minutesByModality,
        [modality]: minutes,
      },
    });
  }

  return (
    <View style={styles.routineList}>
      {routineDays.map((day) => (
        <View style={styles.routineCard} key={day.weekday}>
          <Text style={styles.routineTitle}>{day.label}</Text>
          <OptionGroup
            options={toOptions(dayTrainingOptions)}
            selected={day.modalities}
            onToggle={(value) => toggleDayModality(day, value)}
          />
          {!day.modalities.includes('Sem treinos') && (
            <View style={styles.modalityTimeList}>
              {day.modalities.map((modality) => (
                <View style={styles.modalityTimeRow} key={`${day.weekday}-${modality}`}>
                  <Text style={styles.modalityTimeLabel}>{modality}</Text>
                  <TimeDropdown value={day.minutesByModality[modality] ?? '45'} onChange={(minutes) => updateMinutes(day, modality, minutes)} />
                </View>
              ))}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

function OptionGroup({
  options,
  selected,
  onToggle,
}: {
  options: Array<{ label: string; value: string }>;
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <View style={styles.optionWrap}>
      {options.map((option) => {
        const active = selected.includes(option.value);
        return (
          <Pressable style={[styles.optionChip, active && styles.optionChipActive]} key={option.value} onPress={() => onToggle(option.value)}>
            <Text style={[styles.optionChipText, active && styles.optionChipTextActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function TimeDropdown({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const label = timeLabel(value);

  return (
    <View style={styles.dropdownBox}>
      <Pressable style={styles.dropdownButton} onPress={() => setOpen(!open)}>
        <Text style={styles.dropdownButtonText}>{label}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color="#0f766e" />
      </Pressable>
      {open && (
        <View style={styles.dropdownMenu}>
          {timeOptions.map((option) => (
            <Pressable
              style={[styles.dropdownOption, value === option && styles.dropdownOptionActive]}
              key={option}
              onPress={() => {
                onChange(option);
                setOpen(false);
              }}
            >
              <Text style={[styles.dropdownOptionText, value === option && styles.dropdownOptionTextActive]}>{timeLabel(option)}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function iconForModality(modality: string): keyof typeof Ionicons.glyphMap {
  if (modality === 'forca' || modality === 'fortalecimento_corredores') {
    return 'barbell';
  }
  if (modality === 'descanso') {
    return 'moon';
  }
  return 'walk';
}

// Ordem padronizada: corrida sempre primeiro, depois fortalecimento para corredores, por
// ultimo musculacao — cada modalidade com uma cor de destaque diferente para ficar visual.
function modalityOrderRank(modality: string) {
  if (modality === 'corrida' || modality === 'esteira') return 0;
  if (modality === 'fortalecimento_corredores') return 1;
  if (modality === 'forca') return 2;
  return 3;
}

function modalityAccentColor(modality: string) {
  if (modality === 'corrida' || modality === 'esteira') return '#0f766e';
  if (modality === 'fortalecimento_corredores') return '#d97706';
  if (modality === 'forca') return '#7c3aed';
  return '#64748b';
}

function shiftSessionDay(session: WeekPlanSession, direction: -1 | 1): WeekPlanSession {
  const currentWeekday = dayToWeekday(session.day);
  const nextWeekday = (currentWeekday + direction + 7) % 7;
  const nextDate = shiftDayMonth(session.date, direction);

  return {
    ...session,
    day: weekdayShortLabel(nextWeekday),
    date: nextDate ?? session.date,
  };
}

function sortSessionsByWeek(sessions: WeekPlanSession[]) {
  return [...sessions].sort((left, right) => {
    const leftOrder = weekSortValue(left.day);
    const rightOrder = weekSortValue(right.day);
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.title.localeCompare(right.title);
  });
}

function weekSortValue(day: string) {
  const weekday = dayToWeekday(day);
  return weekday === 0 ? 7 : weekday;
}

function dayToWeekday(day: string) {
  const normalized = day.toLowerCase();
  if (normalized.startsWith('seg')) return 1;
  if (normalized.startsWith('ter')) return 2;
  if (normalized.startsWith('qua')) return 3;
  if (normalized.startsWith('qui')) return 4;
  if (normalized.startsWith('sex')) return 5;
  if (normalized.startsWith('sab')) return 6;
  return 0;
}

function weekdayShortLabel(weekday: number) {
  return ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'][weekday] ?? 'Seg';
}

function planWeekRange(plan: WeekPlan) {
  const start = plan.startDate ? new Date(plan.startDate) : null;
  const end = plan.endDate ? new Date(plan.endDate) : null;

  if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
    return `${formatDayMonthUtc(start)} ${weekdayFullLabelUtc(start)} ate ${formatDayMonthUtc(end)} ${weekdayFullLabelUtc(end)}`;
  }

  if (plan.sessions.length) {
    const first = plan.sessions[0];
    const last = plan.sessions[plan.sessions.length - 1];
    return `${first.date} ${weekdayFullFromShort(first.day)} ate ${last.date} ${weekdayFullFromShort(last.day)}`;
  }

  return currentWeekRange();
}

function formatDayMonthUtc(date: Date) {
  return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function weekdayFullLabelUtc(date: Date) {
  return ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'][date.getUTCDay()] ?? '';
}

function currentWeekRange() {
  const today = new Date();
  const day = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() + (day === 0 ? -6 : 1 - day));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return `${formatDayMonth(monday)} segunda ate ${formatDayMonth(sunday)} domingo`;
}

function formatDayMonth(date: Date) {
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatFullDate(date: Date) {
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

function weekdayFullLabel(date: Date) {
  return ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'][date.getDay()] ?? '';
}

function weekdayFullFromShort(day: string) {
  const labels: Record<string, string> = {
    Dom: 'domingo',
    Seg: 'segunda',
    Ter: 'terca',
    Qua: 'quarta',
    Qui: 'quinta',
    Sex: 'sexta',
    Sab: 'sabado',
  };
  return labels[day] ?? '';
}

function shiftDayMonth(value: string, direction: -1 | 1) {
  const [day, month] = value.split('/').map(Number);
  if (!day || !month) {
    return null;
  }

  const date = new Date(new Date().getFullYear(), month - 1, day);
  date.setDate(date.getDate() + direction);
  const nextDay = String(date.getDate()).padStart(2, '0');
  const nextMonth = String(date.getMonth() + 1).padStart(2, '0');
  return `${nextDay}/${nextMonth}`;
}

function isDetailedPlan(plan: WeekPlan) {
  return plan.sessions.every(
    (session) => session.structure?.type === 'run' || session.structure?.type === 'strength' || session.structure?.type === 'aerobic',
  );
}

function isValidCpf(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  const calcCheckDigit = (length: number) => {
    let total = 0;
    for (let i = 0; i < length; i += 1) total += Number(digits[i]) * (length + 1 - i);
    const remainder = (total * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return calcCheckDigit(9) === Number(digits[9]) && calcCheckDigit(10) === Number(digits[10]);
}

function formatCepInputText(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

function formatPhoneInputText(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function formatCpfInputText(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function formatDateInputText(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function todayDateInputValue() {
  const now = new Date();
  return `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

function isoDateToInputValue(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return todayDateInputValue();
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

function dateInputValueToIso(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString();
}

function defaultCompletionDraft(session: WeekPlanSession): CompletionDraft {
  return {
    status: 'done',
    completedDate: todayDateInputValue(),
    perceivedEffort: '',
    satisfaction: '',
    painFlag: '',
    durationMin: session.durationMin ? String(session.durationMin) : '',
    distanceKm: session.distanceKm ? String(session.distanceKm).replace('.', ',') : '',
    avgPace: '',
    notes: '',
    loadsText: '',
  };
}

function completionDraftFromSession(session: WeekPlanSession): CompletionDraft {
  const completion = session.completion;
  if (!completion) return defaultCompletionDraft(session);
  return {
    status: completion.status,
    completedDate: completion.completedAt ? isoDateToInputValue(completion.completedAt) : todayDateInputValue(),
    perceivedEffort: completion.perceivedEffort ? String(completion.perceivedEffort) : '',
    satisfaction: completion.satisfaction ?? '',
    painFlag: completion.painFlag ?? '',
    durationMin: completion.durationMin ? String(completion.durationMin) : '',
    distanceKm: completion.distanceKm ? String(completion.distanceKm).replace('.', ',') : '',
    avgPace: completion.avgPaceSecondsKm ? paceSecondsToInput(completion.avgPaceSecondsKm) : '',
    notes: completion.notes ?? '',
    loadsText: completion.details?.loadsText ?? '',
  };
}

function paceSecondsToInput(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function reportStatusLabel(item: StravaReport['items'][number]) {
  if (item.status === 'as_prescribed') {
    return `Modalidade e execucao conforme prescrito${item.activityName ? `: ${item.activityName}` : ''}`;
  }
  if (item.status === 'same_modality_changed_execution') {
    return `Modalidade proposta realizada, mas execucao diferente${item.activityName ? `: ${item.activityName}` : ''}`;
  }
  if (item.status === 'different_modality') {
    return `Treinou, mas em outra modalidade: ${modalityLabel(item.actualModality)}${item.activityName ? ` - ${item.activityName}` : ''}`;
  }
  if (item.status === 'not_done') {
    return `Sem registro de ${modalityLabel(item.modality)}`;
  }
  if (item.status === 'future') {
    return 'Treino ainda nao realizado';
  }
  return `Sem registro de ${modalityLabel(item.modality)}`;
}

function modalityLabel(modality?: string | null) {
  if (modality === 'corrida' || modality === 'esteira') return 'corrida';
  if (modality === 'bike') return 'bike/aerobico';
  if (modality === 'forca') return 'musculacao';
  if (modality === 'fortalecimento_corredores') return 'fortalecimento';
  return 'outra atividade';
}

function paceInputToSeconds(value: string) {
  const cleanValue = value.trim();
  if (!cleanValue) {
    return null;
  }

  const match = cleanValue.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function routineToAvailability(routineDays: RoutineDay[]) {
  return routineDays.map((day) => ({
    weekday: day.weekday,
    noTraining: day.modalities.includes('Sem treinos'),
    modalities: day.modalities.includes('Sem treinos') ? [] : day.modalities.map(normalizeModality),
    modalityDurations: day.modalities.reduce<Record<string, number>>((acc, modality) => {
      acc[normalizeModality(modality)] = Number(day.minutesByModality[modality]) || 30;
      return acc;
    }, {}),
    availableMin: day.modalities.includes('Sem treinos')
      ? 0
      : Math.max(...day.modalities.map((modality) => Number(day.minutesByModality[modality]) || 30)),
  }));
}

function normalizeModality(modality: string) {
  const lower = modality.toLowerCase();
  if (lower.includes('fortalecimento para corredores')) {
    return 'fortalecimento_corredores';
  }
  if (lower.includes('musculacao') || lower.includes('forca')) {
    return 'forca';
  }
  if (lower.includes('bike')) {
    return 'bike';
  }
  if (lower.includes('esteira')) {
    return 'esteira';
  }
  return 'corrida';
}

async function loadSavedMe(accessToken: string) {
  try {
    const response = await fetch(`${API_URL}/me`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as MeResponse;
  } catch {
    return null;
  }
}

async function readApiError(response: Response) {
  try {
    const data = (await response.json()) as { message?: string | string[] };
    if (Array.isArray(data.message)) {
      return data.message.join(' ');
    }
    return data.message || 'revise os dados informados.';
  } catch {
    return 'revise os dados informados.';
  }
}

async function saveAnamneseWithLegacyApi(input: {
  headers: Record<string, string>;
  profile: Record<string, unknown>;
  health: Record<string, unknown>;
  preferences: Record<string, unknown>;
  availability: ReturnType<typeof routineToAvailability>;
}) {
  const requests = [
    { path: 'profile', body: input.profile },
    { path: 'health', body: input.health },
    { path: 'preferences', body: input.preferences },
    { path: 'availability', body: { availability: input.availability } },
  ];

  for (const request of requests) {
    try {
      const response = await fetch(`${API_URL}/me/${request.path}`, {
        method: 'PUT',
        headers: input.headers,
        body: JSON.stringify(request.body),
      });
      if (!response.ok) {
        return { ok: false, status: response.status, message: await readApiError(response) };
      }
    } catch {
      return { ok: false, status: 0, message: 'nao consegui conectar com a API.' };
    }
  }

  return { ok: true, status: 200, message: '' };
}

async function loadNotifications(accessToken: string) {
  try {
    const response = await fetch(`${API_URL}/notifications`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { items?: AppNotification[] };
    return data.items ?? [];
  } catch {
    return [];
  }
}

async function loadDismissedNotifications() {
  try {
    const raw = await AsyncStorage.getItem(DISMISSED_NOTIFICATIONS_KEY);
    if (!raw) return [];
    const saved = JSON.parse(raw) as { date?: string; ids?: string[] };
    return saved.date === localDateKey() && Array.isArray(saved.ids) ? saved.ids : [];
  } catch {
    return [];
  }
}

function localDateKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function routineFromSavedAvailability(availability: SavedAvailabilityDay[]) {
  if (!availability.length) {
    return [];
  }

  return defaultRoutineDays.map((defaultDay) => {
      const savedDay = availability.find((day) => day.weekday === defaultDay.weekday);
      if (!savedDay || savedDay.noTraining || !savedDay.modalities.length) {
        return { ...defaultDay, modalities: ['Sem treinos'], minutesByModality: {} };
      }

      const modalities = savedDay.modalities.map(labelFromSavedModality);
      const minutesByModality = modalities.reduce<Record<string, string>>((acc, modalityLabel, index) => {
        const savedModality = savedDay.modalities[index];
        const duration = savedDay.modalityDurations?.[savedModality] ?? savedDay.availableMin ?? 45;
        acc[modalityLabel] = String(duration);
        return acc;
      }, {});

      return {
        ...defaultDay,
        modalities,
        minutesByModality,
      };
    });
}

function labelFromSavedModality(modality: string) {
  if (modality === 'forca') {
    return 'Musculacao';
  }
  if (modality === 'fortalecimento_corredores') {
    return 'Fortalecimento para corredores';
  }
  if (modality === 'esteira') {
    return 'Corrida na esteira';
  }
  if (modality === 'bike') {
    return 'Bike ou outro aparelho aerobico';
  }
  return 'Corrida na rua';
}

function toOptions(options: string[]) {
  return options.map((option) => ({ label: option, value: option }));
}

function toggleSelection(selected: string[], value: string, onChange: (next: string[]) => void) {
  onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
}

function canonicalGoal(value?: string | null) {
  if (!value) return '';
  const normalized = value.toLowerCase().replace(/\s+/g, '');
  const aliases: Array<[string[], string]> = [
    [['comecaracorrer'], 'Comecar a correr'],
    [['correrprimeiros5km', 'primeiros5km', 'completar5km'], 'Completar 5 km'],
    [['melhorarnos5km', 'melhorarmeutemponos5km'], 'Melhorar meu tempo nos 5 km'],
    [['primeiros10km', 'completar10km'], 'Completar 10 km'],
    [['melhorarnos10km', 'melhorarmeutemponos10km'], 'Melhorar meu tempo nos 10 km'],
    [['primeiros21km', 'completar21km'], 'Completar 21 km'],
    [['melhorarnos21km', 'melhorarmeutemponos21km'], 'Melhorar meu tempo nos 21 km'],
    [['primeiramaratona', 'completar42km'], 'Completar 42 km'],
    [['melhorarnamaratona', 'melhorarmeutemponos42km'], 'Melhorar meu tempo nos 42 km'],
  ];
  return aliases.find(([keys]) => keys.includes(normalized))?.[1] ?? value;
}

function shortGoalLabel(value: string) {
  return canonicalGoal(value)
    .replace('Melhorar meu tempo nos ', 'melhorar ')
    .replace('Completar ', 'completar ')
    .replace('Comecar a correr', 'comecar a correr');
}

function cloneRoutine(routineDays: RoutineDay[]) {
  return routineDays.map((day) => ({
    ...day,
    modalities: [...day.modalities],
    minutesByModality: { ...day.minutesByModality },
  }));
}

function timeLabel(value: string) {
  if (value === '120') {
    return 'Mais que 90 min';
  }
  return `0 a ${value} min`;
}

interface ThreeKmMetrics {
  pace: string;
  vo2max: string;
  vvo2: string;
  zones: {
    z1: string;
    z2: string;
    z3: string;
    z4: string;
    z5: string;
  };
}

function calculateThreeKmMetrics(totalSeconds: number): ThreeKmMetrics {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return {
      pace: 'Sem teste',
      vo2max: '--',
      vvo2: '--',
      zones: { z1: '--', z2: '--', z3: '--', z4: '--', z5: '--' },
    };
  }

  const safeSeconds = totalSeconds;
  const timeMinutes = safeSeconds / 60;
  const vo2max = 483 / timeMinutes + 3.5;
  const vvo2 = 3 / (safeSeconds / 3600);
  const paceSeconds = Math.round(safeSeconds / 3);

  return {
    pace: formatPace(paceSeconds),
    vo2max: vo2max.toFixed(1),
    vvo2: `${vvo2.toFixed(1)} km/h`,
    zones: {
      z1: paceFromSpeed(vvo2 * 0.55),
      z2: `${paceFromSpeed(vvo2 * 0.65)} a ${paceFromSpeed(vvo2 * 0.55)}`,
      z3: `${paceFromSpeed(vvo2 * 0.8)} a ${paceFromSpeed(vvo2 * 0.65)}`,
      z4: `${paceFromSpeed(vvo2)} a ${paceFromSpeed(vvo2 * 0.8)}`,
      z5: `mais rapido que ${paceFromSpeed(vvo2)}`,
    },
  };
}

function paceFromSpeed(speedKmh: number) {
  if (!Number.isFinite(speedKmh) || speedKmh <= 0) {
    return '--';
  }
  return formatPace(Math.round(3600 / speedKmh));
}

function runBlockDurationLabel(block: { durationMin?: number; durationRange?: string; durationType?: string; distanceValue?: string | number; distanceUnit?: string }) {
  if (block.durationRange) return `Tempo: ${block.durationRange}`;
  return `${block.durationMin ?? 0} min`;
}

function runBlockDistanceLabel(block: { distanceValue?: string | number; distanceUnit?: string }) {
  if (block.distanceValue === undefined || block.distanceValue === null || block.distanceValue === '') return '-';
  const numericValue = typeof block.distanceValue === 'number' ? block.distanceValue : Number(block.distanceValue);
  const value = Number.isFinite(numericValue) ? formatDecimal(numericValue) : String(block.distanceValue);
  return `${value} ${block.distanceUnit === 'm' ? 'm' : 'km'}`;
}

function rpeLabel(value: string) {
  const labels: Record<string, string> = {
    muito_fraco: 'Muito fraco',
    fraco: 'Fraco',
    moderado: 'Moderado',
    forte: 'Forte',
    muito_forte: 'Muito forte',
  };
  return labels[value] ?? value;
}

function metricPaceForZone(zone: string | undefined, metrics: ThreeKmMetrics) {
  if (!zone) return null;
  const key = zone.toLowerCase() as keyof ThreeKmMetrics['zones'];
  const value = metrics.zones[key];
  return value && value !== '--' ? value : null;
}

function speedRangeFromPace(pace: string | null | undefined) {
  if (!pace) return null;
  const matches = [...pace.matchAll(/(\d+):(\d{2})/g)];
  if (!matches.length) return null;
  const speeds = matches
    .map((match) => 3600 / (Number(match[1]) * 60 + Number(match[2])))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!speeds.length) return null;
  if (speeds.length === 1) return `${formatDecimal(speeds[0])} km/h`;
  return `${formatDecimal(speeds[0])} a ${formatDecimal(speeds[speeds.length - 1])} km/h`;
}

function formatDecimal(value: number) {
  return value.toFixed(1).replace('.', ',');
}

function formatPace(secondsPerKm: number) {
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = secondsPerKm % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}/km`;
}

function formatBrazilianDateInput(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) {
    return digits;
  }
  if (digits.length <= 4) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function parseBrazilianDate(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return '';
  }

  const [, day, month, year] = match;
  const parsedDate = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.getUTCDate() !== Number(day) ||
    parsedDate.getUTCMonth() + 1 !== Number(month) ||
    parsedDate.getUTCFullYear() !== Number(year)
  ) {
    return '';
  }

  return `${year}-${month}-${day}`;
}

function formatDateFromApi(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`;
}

const styles = StyleSheet.create({
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  screen: {
    flexGrow: 1,
    padding: 24,
    gap: 18,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  onboardingScreen: {
    justifyContent: 'center',
    gap: 24,
  },
  appShell: {
    flex: 1,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    backgroundColor: '#f8fafc',
  },
  appHeader: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#dbe4ea',
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  appContent: {
    paddingHorizontal: 12,
    paddingTop: 18,
    paddingBottom: 44,
  },
  section: {
    gap: 16,
  },
  alertBox: {
    borderWidth: 1,
    borderColor: '#dbe4ea',
    borderRadius: 8,
    backgroundColor: '#ffffff',
    padding: 14,
    gap: 10,
    marginBottom: 14,
  },
  alertItem: {
    borderWidth: 1,
    borderColor: '#ccfbf1',
    borderRadius: 8,
    backgroundColor: '#f0fdfa',
    padding: 10,
    gap: 4,
  },
  alertTitle: {
    color: '#0f766e',
    fontSize: 13,
    fontWeight: '900',
  },
  alertText: {
    color: '#334155',
    fontSize: 13,
    lineHeight: 18,
  },
  earlyStudentNotice: {
    borderWidth: 1,
    borderColor: '#99f6e4',
    borderRadius: 8,
    backgroundColor: '#f0fdfa',
    padding: 16,
    gap: 10,
  },
  earlyStudentNoticeTitle: {
    color: '#0f766e',
    fontSize: 17,
    fontWeight: '900',
  },
  earlyStudentNoticeText: {
    color: '#334155',
    fontSize: 14,
    lineHeight: 21,
  },
  whatsAppButton: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#0f766e',
    borderRadius: 8,
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  whatsAppButtonText: {
    color: '#0f766e',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoMark: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: {
    color: '#111827',
    fontSize: 22,
    fontWeight: '800',
  },
  title: {
    color: '#111827',
    fontSize: 34,
    fontWeight: '800',
    lineHeight: 40,
  },
  heroBlock: {
    gap: 10,
  },
  heroEyebrow: {
    color: '#0f766e',
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  heroCopy: {
    color: '#475569',
    fontSize: 17,
    lineHeight: 25,
  },
  startGrid: {
    gap: 10,
  },
  startItem: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dbe4ea',
    backgroundColor: '#ffffff',
    padding: 16,
    gap: 6,
  },
  startTitle: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '800',
  },
  startText: {
    color: '#475569',
    fontSize: 14,
    lineHeight: 20,
  },
  heroButton: {
    minHeight: 58,
    borderRadius: 8,
    backgroundColor: '#0f766e',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  safetyFootnote: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  titleSmall: {
    color: '#111827',
    fontSize: 26,
    fontWeight: '800',
  },
  headerTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '800',
  },
  headerEmail: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 2,
  },
  headerObjective: {
    color: '#0f766e',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 5,
  },
  headerOverline: {
    color: '#0f766e',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  menuButton: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  appMenu: {
    borderBottomWidth: 1,
    borderBottomColor: '#dbe4ea',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  menuItem: {
    minHeight: 44,
    borderRadius: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  menuItemActive: {
    backgroundColor: '#f0fdfa',
  },
  menuItemText: {
    color: '#334155',
    fontSize: 15,
    fontWeight: '800',
  },
  menuItemTextActive: {
    color: '#0f766e',
  },
  copy: {
    color: '#475569',
    fontSize: 16,
    lineHeight: 24,
  },
  copyTight: {
    color: '#475569',
    fontSize: 15,
    lineHeight: 22,
  },
  sectionLabel: {
    color: '#0f766e',
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  metricGrid: {
    gap: 10,
  },
  metricCard: {
    minHeight: 86,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dbe4ea',
    backgroundColor: '#ffffff',
    padding: 16,
    gap: 4,
  },
  metricLabel: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '700',
  },
  metricValue: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '800',
  },
  input: {
    minHeight: 54,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    color: '#111827',
    fontSize: 16,
  },
  testTimeRow: {
    flexDirection: 'row',
    gap: 12,
  },
  testTimeField: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  secureInputWrap: {
    position: 'relative',
    justifyContent: 'center',
  },
  secureInput: {
    paddingRight: 96,
  },
  showPasswordButton: {
    position: 'absolute',
    right: 8,
    minHeight: 38,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dbe4ea',
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  showPasswordText: {
    color: '#0f766e',
    fontSize: 13,
    fontWeight: '800',
  },
  darkInput: {
    minHeight: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#475569',
    backgroundColor: '#1f2937',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#ffffff',
    fontSize: 14,
  },
  multilineInput: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  termsText: {
    flex: 1,
    color: '#475569',
    fontSize: 14,
    lineHeight: 20,
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: 8,
    backgroundColor: '#0f766e',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  authActions: {
    gap: 10,
  },
  authButton: {
    width: '100%',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryOutlineButton: {
    minHeight: 54,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#0f766e',
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  secondaryOutlineButtonText: {
    color: '#0f766e',
    fontSize: 16,
    fontWeight: '800',
  },
  disabledButton: {
    opacity: 0.55,
  },
  secondaryButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: '#0f766e',
    fontSize: 15,
    fontWeight: '700',
  },
  statusMessage: {
    color: '#334155',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  noticeBox: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#99f6e4',
    backgroundColor: '#f0fdfa',
    padding: 14,
    flexDirection: 'column',
    gap: 10,
  },
  noticeTitle: {
    color: '#0f766e',
    fontSize: 15,
    fontWeight: '900',
  },
  noticeText: {
    color: '#115e59',
    fontSize: 14,
    lineHeight: 20,
  },
  inputLabel: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '800',
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  headerLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  collapseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  statusPill: {
    borderRadius: 8,
    backgroundColor: '#fef3c7',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusText: {
    color: '#92400e',
    fontWeight: '800',
  },
  donePill: {
    backgroundColor: '#dcfce7',
  },
  doneText: {
    color: '#166534',
  },
  sessionCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dbe4ea',
    backgroundColor: '#ffffff',
    padding: 16,
    flexDirection: 'row',
    gap: 12,
  },
  sessionIcon: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionText: {
    flex: 1,
    gap: 5,
  },
  sessionTitle: {
    color: '#111827',
    fontSize: 17,
    fontWeight: '800',
  },
  sessionDetail: {
    color: '#0f766e',
    fontSize: 14,
    fontWeight: '700',
  },
  sessionNote: {
    color: '#475569',
    fontSize: 14,
    lineHeight: 20,
  },
  prescriptionBox: {
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#dbe4ea',
    gap: 6,
  },
  exerciseRow: {
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingBottom: 8,
    gap: 3,
  },
  exerciseName: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '900',
  },
  strengthListHeader: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#cbd5e1',
  },
  strengthHeaderText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  strengthExercise: {
    borderBottomWidth: 1,
    borderBottomColor: '#dbe4ea',
    paddingVertical: 12,
    gap: 8,
  },
  strengthExerciseTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  exerciseNumber: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exerciseNumberText: {
    color: '#111827',
    fontSize: 12,
    fontWeight: '900',
  },
  strengthExerciseName: {
    flex: 1,
    gap: 2,
  },
  exerciseSummary: {
    color: '#475569',
    fontSize: 12,
    lineHeight: 17,
  },
  exerciseMetrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  exerciseMetric: {
    minWidth: 72,
    flexGrow: 1,
    borderLeftWidth: 2,
    borderLeftColor: '#99f6e4',
    paddingLeft: 6,
  },
  exerciseMetricLabel: {
    color: '#64748b',
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  exerciseMetricValue: {
    color: '#111827',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 2,
  },
  exerciseCadence: {
    color: '#334155',
    fontSize: 11,
    fontWeight: '700',
  },
  exerciseExplanation: {
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 9,
    gap: 7,
  },
  explanationTitle: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '900',
  },
  prescriptionCategory: {
    color: '#0f766e',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  prescriptionText: {
    color: '#334155',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  runSummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#cbd5e1',
  },
  runMetricLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '800',
  },
  runMetricValue: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '900',
    marginTop: 2,
  },
  runBlock: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    gap: 8,
  },
  runBlockHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  runBlockTitle: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '900',
  },
  runBlockDuration: {
    color: '#0f766e',
    fontSize: 13,
    fontWeight: '900',
  },
  runBlockMetrics: {
    gap: 6,
  },
  runBlockMetric: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  runBlockLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  loadField: {
    color: '#0f766e',
    fontSize: 13,
    fontWeight: '800',
  },
  videoButton: {
    alignSelf: 'flex-start',
    minHeight: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#99f6e4',
    backgroundColor: '#f0fdfa',
    paddingHorizontal: 9,
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  videoButtonText: {
    color: '#0f766e',
    fontSize: 12,
    fontWeight: '900',
  },
  noVideoText: {
    color: '#92400e',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 4,
  },
  completionBox: {
    marginTop: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    padding: 10,
    gap: 8,
  },
  completionTitle: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '900',
  },
  completionStatusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  completionChip: {
    minHeight: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingHorizontal: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completionChipActive: {
    borderColor: '#0f766e',
    backgroundColor: '#ccfbf1',
  },
  completionChipText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '800',
  },
  completionChipTextActive: {
    color: '#115e59',
  },
  completionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  completionFieldGroup: {
    flex: 1,
    minWidth: 90,
    gap: 4,
    marginBottom: 8,
  },
  compactInput: {
    minHeight: 42,
    minWidth: 112,
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    color: '#111827',
    fontSize: 13,
    fontWeight: '700',
  },
  saveCompletionButton: {
    minHeight: 40,
    borderRadius: 8,
    backgroundColor: '#0f766e',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  saveCompletionText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  completionConfirmation: {
    color: '#0f766e',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
    textAlign: 'center',
  },
  reportRow: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    padding: 10,
    gap: 4,
  },
  reportTitle: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '900',
  },
  reportText: {
    color: '#334155',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  coachBox: {
    borderRadius: 8,
    backgroundColor: '#111827',
    padding: 16,
    gap: 6,
  },
  coachTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  coachText: {
    color: '#cbd5e1',
    fontSize: 14,
    lineHeight: 20,
  },
  weekList: {
    gap: 10,
  },
  weekItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  weekDate: {
    width: 54,
    paddingTop: 14,
    alignItems: 'center',
  },
  weekSessionCard: {
    flex: 1,
    minWidth: 0,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dbe4ea',
    backgroundColor: '#f8fafc',
    padding: 14,
    gap: 10,
  },
  weekSessionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  weekSessionTitleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  weekDay: {
    color: '#111827',
    fontWeight: '800',
  },
  weekNumber: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 2,
  },
  weekIcon: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekText: {
    flex: 1,
  },
  zonePill: {
    alignSelf: 'flex-start',
    minWidth: 42,
    borderRadius: 6,
    backgroundColor: '#ccfbf1',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 4,
  },
  zoneText: {
    color: '#115e59',
    fontSize: 12,
    fontWeight: '800',
  },
  moveActions: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  moveButton: {
    minHeight: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#99f6e4',
    backgroundColor: '#f0fdfa',
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  moveButtonText: {
    color: '#0f766e',
    fontSize: 12,
    fontWeight: '800',
  },
  zoneTable: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dbe4ea',
    overflow: 'hidden',
    backgroundColor: '#ffffff',
  },
  zoneRow: {
    minHeight: 48,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    gap: 10,
  },
  zoneName: {
    width: 34,
    color: '#0f766e',
    fontWeight: '900',
  },
  zoneLabel: {
    flex: 1,
    color: '#334155',
    fontWeight: '700',
  },
  zonePace: {
    color: '#111827',
    fontWeight: '800',
  },
  badgeRow: {
    gap: 10,
  },
  badge: {
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: '#fef3c7',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  badgeText: {
    color: '#92400e',
    fontWeight: '800',
  },
  formGrid: {
    gap: 10,
  },
  formSection: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dbe4ea',
    backgroundColor: '#ffffff',
    padding: 16,
    gap: 12,
  },
  formSectionTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '800',
  },
  formHint: {
    color: '#475569',
    fontSize: 13,
    lineHeight: 18,
  },
  couponBox: {
    gap: 8,
  },
  couponRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  couponInput: {
    flex: 1,
  },
  couponButton: {
    minHeight: 54,
    borderRadius: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f766e',
  },
  couponButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
  },
  interviewTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  interviewCounter: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '800',
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#e2e8f0',
    overflow: 'hidden',
  },
  progressFill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#0f766e',
  },
  interviewQuestion: {
    color: '#111827',
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '900',
  },
  requiredMark: {
    color: '#dc2626',
  },
  wheelPickerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 8,
  },
  wheelColumnWrap: {
    alignItems: 'center',
  },
  wheelColumn: {
    height: WHEEL_ITEM_HEIGHT * WHEEL_VISIBLE_ITEMS,
    width: 84,
    overflow: 'hidden',
  },
  wheelItem: {
    height: WHEEL_ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheelValue: {
    fontSize: 18,
    color: '#9ca3af',
  },
  wheelValueActive: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
  },
  wheelHighlight: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: WHEEL_ITEM_HEIGHT,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#d1d5db',
  },
  wheelColumnLabel: {
    marginTop: 4,
    fontSize: 12,
    color: '#6b7280',
  },
  dropdownField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  dropdownFieldText: {
    fontSize: 16,
    color: '#111827',
    fontWeight: '600',
  },
  dropdownFieldPlaceholder: {
    fontSize: 16,
    color: '#9ca3af',
  },
  dropdownOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 24,
  },
  dropdownSheet: {
    backgroundColor: '#fff',
    borderRadius: 14,
    maxHeight: 420,
    paddingVertical: 8,
  },
  interviewDropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  interviewDropdownOptionText: {
    fontSize: 16,
    color: '#111827',
  },
  interviewDropdownOptionTextActive: {
    fontSize: 16,
    color: '#0f766e',
    fontWeight: '700',
  },
  dropdownDoneButton: {
    marginTop: 4,
    marginHorizontal: 12,
    marginBottom: 8,
    backgroundColor: '#0f766e',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  dropdownDoneButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  answerList: {
    gap: 9,
  },
  answerButton: {
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  answerButtonActive: {
    borderColor: '#0f766e',
    backgroundColor: '#ccfbf1',
  },
  answerButtonText: {
    color: '#334155',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  answerButtonTextActive: {
    color: '#0f766e',
  },
  scaleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  scaleButton: {
    width: 52,
    minHeight: 52,
    paddingHorizontal: 0,
  },
  helpButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 36,
  },
  helpButtonText: {
    color: '#0f766e',
    fontSize: 13,
    fontWeight: '900',
  },
  decimalButton: {
    alignSelf: 'flex-start',
    minHeight: 36,
    borderWidth: 1,
    borderColor: '#0f766e',
    borderRadius: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  decimalButtonText: {
    color: '#0f766e',
    fontSize: 13,
    fontWeight: '900',
  },
  calculationBox: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#99f6e4',
    backgroundColor: '#f0fdfa',
    padding: 12,
    gap: 4,
  },
  calculationTitle: {
    color: '#0f766e',
    fontSize: 13,
    fontWeight: '900',
  },
  calculationText: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '700',
  },  interviewActions: {
    flexDirection: 'row',
    gap: 10,
  },
  optionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionChip: {
    minHeight: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionChipActive: {
    borderColor: '#0f766e',
    backgroundColor: '#ccfbf1',
  },
  optionChipText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '800',
  },
  optionChipTextActive: {
    color: '#115e59',
  },
  availabilityBox: {
    borderRadius: 8,
    backgroundColor: '#334155',
    padding: 16,
    gap: 8,
  },
  availabilityText: {
    color: '#e2e8f0',
    fontSize: 14,
  },
  routineList: {
    gap: 12,
  },
  routineCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    padding: 12,
    gap: 10,
  },
  routineTitle: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '900',
  },
  modalityTimeList: {
    gap: 8,
  },
  modalityTimeRow: {
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  modalityTimeLabel: {
    flex: 1,
    color: '#111827',
    fontSize: 14,
    fontWeight: '800',
    paddingTop: 9,
  },
  dropdownBox: {
    width: 154,
  },
  dropdownButton: {
    minHeight: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#0f766e',
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  dropdownButtonText: {
    color: '#0f766e',
    fontSize: 13,
    fontWeight: '800',
  },
  dropdownMenu: {
    marginTop: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  dropdownOption: {
    minHeight: 36,
    paddingHorizontal: 10,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  dropdownOptionActive: {
    backgroundColor: '#ccfbf1',
  },
  dropdownOptionText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '700',
  },
  dropdownOptionTextActive: {
    color: '#115e59',
    fontWeight: '900',
  },
  tabBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 78,
    borderTopWidth: 1,
    borderTopColor: '#dbe4ea',
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 6,
  },
  tabButton: {
    minWidth: 58,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  tabText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '800',
  },
  tabTextActive: {
    color: '#0f766e',
  },
});







