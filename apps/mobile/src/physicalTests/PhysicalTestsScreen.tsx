import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Svg, { Line, Path, Rect, Circle, Text as SvgText } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../PtText';
import { InfoTip } from '../InfoTip';
import { HOW_WE_USE, REPEAT_TESTS_BODY, REPEAT_TESTS_TITLE, THREE_KM_HOW_TO, THREE_KM_SAFETY, ZONE_HELP, ZONES_USE_CARD } from './texts';
import {
  CONFIDENCE_LABELS, INDICATOR_LABELS, METHOD_OPTIONS, ORIGIN_LABELS, RAW_THREE_KM_TIME, brDateFromIso, buildSeries, describeRawResults, formatIndicatorValue, formatMinSec,
  formatRange, formatSpeed, isoFromBrDate, maskBrDate, methodLabel, nextDueText, paceLabelFromKmh, parseDecimal, parseMinSec, parseMinSecParts, todayBrDate, xPositions,
  type HistoryRow, type SpeedUnit,
} from './format';

// Testes físicos > Capacidade aeróbia (Lote 3, 30/10/2026). Dois fluxos: teste de 3 km autoaplicável e "Informar resultados de outro teste".
// Os cálculos são do servidor (Daniels e Gilbert, Esteve-Lanao, Tanaka e Gulati); esta tela só informa o que o aluno fez e mostra o que volta,
// sempre com origem (medido, informado, estimado), confiança e faixa. Nada aqui calcula treino.

type View_ = 'home' | 'aerobic' | 'threeKm' | 'external' | 'results' | 'evolution' | 'how';
interface Indicator { key: string; value: number; unit: string; origin: string; confidence: string; rangeLow?: number | null; rangeHigh?: number | null; pace?: string; from: { assessmentId: string; method: string; performedAt: string; fromReference: boolean } }
interface Zone { id: string; label: string; speedKmh: [number, number]; paceSecondsPerKm: [number, number | null]; heartRate?: [number, number]; open?: 'fast' }
interface Profile {
  reference: { assessmentId: string; method: string; methodLabel: string; performedAt: string; label: string } | null;
  indicators: Indicator[]; zones: Zone[] | null; limitations: string[]; nextReassessmentDueAt: string | null;
  assessments: Array<{ id: string; method: string; methodLabel: string; performedAt: string }>;
  // Referência operacional vigente (camada 3). Quando vem de ajuste feito pela análise dos treinos, o aluno vê o que mudou e por quê.
  operationalReference?: { version: number; source: string; justification: string; createdAt: string; payload?: { zones?: Zone[] | null; adjustment?: { changes: Array<{ key: string; from: number; to: number }> } } } | null;
}

const COLORS = { ink: '#071827', muted: '#4a5560', soft: '#6b7783', line: '#d6dee6', brand: '#246F91', brandSoft: '#8fc3d9', danger: '#b91c1c', ok: '#1f7a4d' };
const METHOD_COLORS: Record<string, string> = { three_km: '#246F91', ergospirometry: '#1f7a4d', five_km: '#b7791f', cooper_12min: '#7b4fa3', incremental: '#c2410c', lactate: '#0f766e', other: '#6b7783', unknown: '#6b7783' };
const SHAPES = ['circle', 'square', 'diamond', 'triangle'] as const;
// Forma fixa por método (além da cor), para o gráfico não depender só de cor.
const SHAPE_BY_METHOD: Record<string, (typeof SHAPES)[number]> = { three_km: 'circle', ergospirometry: 'square', five_km: 'diamond', cooper_12min: 'triangle', lactate: 'diamond', incremental: 'triangle', other: 'circle', unknown: 'circle' };
const shapeFor = (method: string) => SHAPE_BY_METHOD[method] ?? 'circle';
const PLACEHOLDER = '#9aa5b1';

async function api<T>(apiUrl: string, token: string, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, { method: init?.method ?? 'GET', headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { 'Content-Type': 'application/json' } : {}) }, body: init?.body ? JSON.stringify(init.body) : undefined });
  if (!response.ok) {
    let message = 'Não foi possível concluir agora.';
    try { const data = await response.json(); message = Array.isArray(data?.message) ? data.message.join(' ') : typeof data?.message === 'string' ? data.message : message; } catch { /* mantém a mensagem padrão */ }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export function PhysicalTestsScreen({ accessToken, apiUrl, onBack, initialView }: { accessToken: string; apiUrl: string; onBack?: () => void; initialView?: View_ }) {
  const [view, setView] = useState<View_>(initialView ?? 'home');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [unit, setUnit] = useState<SpeedUnit>('pace');

  const load = useCallback(async () => {
    setLoading(true); setLoadError(false);
    try {
      const [p, h] = await Promise.all([api<Profile>(apiUrl, accessToken, '/physiology/profile'), api<HistoryRow[]>(apiUrl, accessToken, '/physiology/history')]);
      setProfile(p); setHistory(h);
    } catch { setLoadError(true); } finally { setLoading(false); }
  }, [apiUrl, accessToken]);
  useEffect(() => { void load(); }, [load]);

  const back = (to: View_) => (
    <Pressable onPress={() => setView(to)} accessibilityRole="button"><Text style={styles.back}>← Voltar</Text></Pressable>
  );
  const hasData = (profile?.assessments.length ?? 0) > 0;

  if (view === 'home') return (
    <View style={styles.wrap}>
      {onBack ? <Pressable onPress={onBack} accessibilityRole="button"><Text style={styles.back}>← Voltar</Text></Pressable> : null}
      <Text style={styles.title}>Testes físicos</Text>
      <Text style={styles.intro}>Avaliações simples que ajudam o Panzeri Run a conhecer a sua capacidade e a individualizar o seu programa de treino.</Text>
      <Pressable style={styles.card} onPress={() => setView('aerobic')} accessibilityRole="button">
        <View style={styles.rowBetween}><Text style={styles.cardTitle}>Capacidade aeróbia</Text><Ionicons name="chevron-forward" size={20} color={COLORS.brand} /></View>
        <Text style={styles.hint}>Teste de 3 km ou resultados de outro teste. Veja seus indicadores, zonas de treino e evolução.</Text>
      </Pressable>
    </View>
  );

  if (view === 'aerobic') return (
    <View style={styles.wrap}>
      {back('home')}
      <Text style={styles.title}>Capacidade aeróbia</Text>
      {loading ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
      {loadError ? <ErrorBox onRetry={() => void load()} /> : null}
      {profile?.reference ? (
        <Pressable style={styles.card} onPress={() => setView('results')} accessibilityRole="button">
          <Text style={styles.label}>{profile.reference.label}</Text>
          <Text style={styles.hint}>Toque para ver seus indicadores e zonas de treino.</Text>
        </Pressable>
      ) : null}
      <Pressable style={styles.card} onPress={() => setView('threeKm')} accessibilityRole="button">
        <Text style={styles.cardTitle}>Teste de 3 km</Text>
        <Text style={styles.hint}>Você corre 3 km no melhor tempo possível e informa o tempo final e, se quiser, a maior frequência cardíaca. Nós calculamos as estimativas.</Text>
      </Pressable>
      <Pressable style={styles.card} onPress={() => setView('external')} accessibilityRole="button">
        <Text style={styles.cardTitle}>Informar resultados de outro teste</Text>
        <Text style={styles.hint}>Ergoespirometria, teste de Cooper, 5 km, lactato ou outra avaliação que você já fez.</Text>
      </Pressable>
      {hasData ? <Pressable onPress={() => setView('evolution')} accessibilityRole="button"><Text style={styles.link}>Evolução dos testes físicos</Text></Pressable> : null}
      <Pressable onPress={() => setView('how')} accessibilityRole="button"><Text style={styles.link}>Como utilizamos os resultados dos testes?</Text></Pressable>
      {hasData && profile?.nextReassessmentDueAt ? <Text style={styles.hint}>{nextDueText(profile.nextReassessmentDueAt, brToIso(todayBrDate()) ?? '')}</Text> : null}
    </View>
  );

  if (view === 'threeKm') return <ThreeKmForm apiUrl={apiUrl} token={accessToken} onBack={() => setView('aerobic')} onSaved={async () => { await load(); setView('results'); }} />;
  if (view === 'external') return <ExternalForm apiUrl={apiUrl} token={accessToken} onBack={() => setView('aerobic')} onSaved={async () => { await load(); setView('results'); }} />;
  if (view === 'results') return <Results profile={profile} loading={loading} unit={unit} setUnit={setUnit} onBack={() => setView('aerobic')} onEvolution={() => setView('evolution')} onHow={() => setView('how')} />;
  if (view === 'evolution') return <Evolution rows={history} unit={unit} setUnit={setUnit} onBack={() => setView('aerobic')} />;
  return <HowWeUse onBack={() => setView('aerobic')} />;
}

const brToIso = (br: string) => isoFromBrDate(br);

function ErrorBox({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.box}>
      <Text style={styles.problem}>Não foi possível carregar seus dados agora.</Text>
      <Pressable style={styles.button} onPress={onRetry} accessibilityRole="button"><Text style={styles.buttonText}>Tentar de novo</Text></Pressable>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }}><Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text></Pressable>;
}

// ---------------------------------------------------------------- teste de 3 km
function ThreeKmForm({ apiUrl, token, onBack, onSaved }: { apiUrl: string; token: string; onBack: () => void; onSaved: () => Promise<void> }) {
  const [minutes, setMinutes] = useState('');
  const [seconds, setSeconds] = useState('');
  const [hr, setHr] = useState('');
  const [environment, setEnvironment] = useState<'rua' | 'esteira'>('rua');
  const [date, setDate] = useState(todayBrDate());
  const [howOpen, setHowOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function submit() {
    setMessage('');
    const total = parseMinSecParts(minutes, seconds);
    if (total === null || total < 300 || total > 7200) { setMessage('Informe o tempo dos 3 km em minutos e segundos (entre 5 minutos e 2 horas).'); return; }
    const maxHeartRate = hr.trim() === '' ? undefined : Number(hr.replace(/\D/g, ''));
    if (maxHeartRate !== undefined && (!Number.isFinite(maxHeartRate) || maxHeartRate < 40 || maxHeartRate > 240)) { setMessage('A frequência cardíaca deve estar entre 40 e 240 bpm. Se não tiver esse dado, deixe em branco.'); return; }
    const iso = isoFromBrDate(date);
    if (!iso) { setMessage('Informe a data do teste no formato DD/MM/AAAA.'); return; }
    setSaving(true);
    try {
      await api(apiUrl, token, '/fitness-tests/3km', { method: 'POST', body: { totalSeconds: total, environment, ...(maxHeartRate !== undefined ? { maxHeartRate } : {}), performedAt: iso } });
      await onSaved();
    } catch (error) { setMessage((error as Error).message); } finally { setSaving(false); }
  }

  return (
    <View style={styles.wrap}>
      <Pressable onPress={onBack} accessibilityRole="button"><Text style={styles.back}>← Voltar</Text></Pressable>
      <Text style={styles.title}>Teste de 3 km</Text>
      <Pressable style={styles.card} onPress={() => setHowOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: howOpen }}>
        <View style={styles.rowBetween}><Text style={styles.cardTitle}>Como realizar o teste de 3 km?</Text><Ionicons name={howOpen ? 'chevron-up' : 'chevron-down'} size={20} color={COLORS.brand} /></View>
        {howOpen ? (
          <View style={{ gap: 10, marginTop: 6 }}>
            {THREE_KM_HOW_TO.map((step, i) => (<View key={step.title}><Text style={styles.label}>{i + 1}. {step.title}</Text><Text style={styles.hint}>{step.body}</Text></View>))}
            <View style={styles.warn}><Text style={styles.warnText}>{THREE_KM_SAFETY}</Text></View>
          </View>
        ) : null}
      </Pressable>

      <Text style={styles.label}>Onde você fez o teste?</Text>
      <View style={styles.chips}>
        <Chip label="Rua ou pista" active={environment === 'rua'} onPress={() => setEnvironment('rua')} />
        <Chip label="Esteira" active={environment === 'esteira'} onPress={() => setEnvironment('esteira')} />
      </View>

      <Text style={styles.label}>Tempo total dos 3 km</Text>
      <View style={styles.row}>
        <View style={styles.field}><Text style={styles.hint}>Minutos</Text><TextInput placeholderTextColor={PLACEHOLDER} style={styles.input} value={minutes} onChangeText={(v) => setMinutes(v.replace(/\D/g, '').slice(0, 3))} keyboardType="numeric" placeholder="20" accessibilityLabel="Minutos" /></View>
        <View style={styles.field}><Text style={styles.hint}>Segundos</Text><TextInput placeholderTextColor={PLACEHOLDER} style={styles.input} value={seconds} onChangeText={(v) => setSeconds(v.replace(/\D/g, '').slice(0, 2))} keyboardType="numeric" placeholder="35" accessibilityLabel="Segundos" /></View>
      </View>

      <Text style={styles.label}>Maior frequência cardíaca no teste (opcional)</Text>
      <TextInput placeholderTextColor={PLACEHOLDER} style={styles.input} value={hr} onChangeText={(v) => setHr(v.replace(/\D/g, '').slice(0, 3))} keyboardType="numeric" placeholder="Ex.: 186" accessibilityLabel="Maior frequência cardíaca" />
      <Text style={styles.hint}>Sem esse dado, as zonas de frequência cardíaca são estimadas pela sua idade, com menos confiança.</Text>

      <Text style={styles.label}>Data do teste</Text>
      <TextInput placeholderTextColor={PLACEHOLDER} style={styles.input} value={date} onChangeText={(v) => setDate(maskBrDate(v))} keyboardType="numeric" placeholder="DD/MM/AAAA" accessibilityLabel="Data do teste" />

      {message ? <Text style={styles.problem}>{message}</Text> : null}
      <Pressable style={[styles.primary, saving && styles.disabled]} disabled={saving} onPress={() => void submit()} accessibilityRole="button"><Text style={styles.primaryText}>{saving ? 'Calculando...' : 'Salvar e ver meus indicadores'}</Text></Pressable>
      <Text style={styles.hint}>A inteligência artificial usa esse resultado na próxima vez que montar o seu programa de treino.</Text>
    </View>
  );
}

// ---------------------------------------------------------------- outro teste
function ExternalForm({ apiUrl, token, onBack, onSaved }: { apiUrl: string; token: string; onBack: () => void; onSaved: () => Promise<void> }) {
  const [method, setMethod] = useState<string>('');
  const [custom, setCustom] = useState('');
  const [date, setDate] = useState('');
  const [unit, setUnit] = useState<SpeedUnit>('kmh');
  const [f, setF] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const timeFromText = (k: string) => (f[k]?.trim() ? parseMinSec(f[k]) : null);

  async function submit() {
    const problems: string[] = [];
    const iso = isoFromBrDate(date);
    if (!iso) problems.push('Informe a data da avaliação no formato DD/MM/AAAA.');
    const results: Record<string, number> = {};
    const num = (key: string, label: string, target: string) => {
      const raw = f[key]?.trim(); if (!raw) return;
      const v = parseDecimal(raw); if (v === null) { problems.push(`${label}: número inválido.`); return; } results[target] = v;
    };
    const speed = (key: string, label: string, kmhKey: string, paceKey: string) => {
      const raw = f[key]?.trim(); if (!raw) return;
      if (unit === 'kmh') { const v = parseDecimal(raw); if (v === null) problems.push(`${label}: número inválido.`); else results[kmhKey] = v; }
      else { const s = parseMinSec(raw); if (s === null) problems.push(`${label}: use o formato min:seg, por exemplo 4:30.`); else results[paceKey] = s; }
    };
    num('vo2max', 'VO₂máx', 'vo2max'); num('hrmax', 'FC máxima', 'hrmax_bpm');
    speed('vvo2', 'Velocidade no VO₂máx', 'vvo2max_kmh', 'vvo2max_pace_seconds');
    speed('l2speed', 'Velocidade no L2', 'l2_speed_kmh', 'l2_pace_seconds'); num('l2hr', 'FC no L2', 'l2_hr_bpm'); num('l2vo2', 'VO₂ no L2', 'l2_vo2'); num('l2vo2pct', 'VO₂ no L2 (% do máximo)', 'l2_vo2_pct');
    speed('l1speed', 'Velocidade no L1', 'l1_speed_kmh', 'l1_pace_seconds'); num('l1hr', 'FC no L1', 'l1_hr_bpm'); num('l1vo2', 'VO₂ no L1', 'l1_vo2'); num('l1vo2pct', 'VO₂ no L1 (% do máximo)', 'l1_vo2_pct');
    if (method === 'three_km' || method === 'five_km') { const t = timeFromText('time'); if (f.time?.trim() && t === null) problems.push('Tempo: use o formato min:seg, por exemplo 25:40.'); else if (t !== null) results.totalSeconds = t; }
    if (method === 'cooper_12min') num('distance', 'Distância', 'distanceMeters');
    if (!method) problems.push('Escolha o método da avaliação ou "Não sei informar".');
    if (Object.keys(results).length === 0 && problems.length === 0) problems.push('Informe ao menos um resultado. Campos em branco ficam em branco.');
    if (problems.length > 0) { setErrors(problems); return; }
    setErrors([]); setSaving(true);
    try {
      await api(apiUrl, token, '/physiology/assessments', { method: 'POST', body: { method, ...(method === 'other' && custom.trim() ? { methodLabel: custom.trim() } : {}), performedAt: iso, results } });
      await onSaved();
    } catch (error) { setErrors([(error as Error).message]); } finally { setSaving(false); }
  }

  const speedHint = unit === 'kmh' ? 'km/h, ex.: 15,5' : 'min:seg por km, ex.: 4:30';
  // Função (não componente): um componente declarado aqui seria recriado a cada tecla e o campo perderia o foco.
  const field = (id: string, label: string, placeholder?: string) => (
    <View key={id} style={styles.fieldWide}><Text style={styles.hint}>{label}</Text><TextInput placeholderTextColor={PLACEHOLDER} style={styles.input} value={f[id] ?? ''} onChangeText={(v) => set(id, v)} placeholder={placeholder} keyboardType="numbers-and-punctuation" accessibilityLabel={label} /></View>
  );

  return (
    <View style={styles.wrap}>
      <Pressable onPress={onBack} accessibilityRole="button"><Text style={styles.back}>← Voltar</Text></Pressable>
      <Text style={styles.title}>Informar resultados de outro teste</Text>
      <Text style={styles.intro}>Registre uma avaliação que você já fez, por exemplo no laboratório. Preencha só o que você tem: nós não inventamos os campos que ficarem em branco.</Text>

      <Text style={styles.label}>Data da avaliação</Text>
      <TextInput placeholderTextColor={PLACEHOLDER} style={styles.input} value={date} onChangeText={(v) => setDate(maskBrDate(v))} keyboardType="numeric" placeholder="DD/MM/AAAA" accessibilityLabel="Data da avaliação" />

      <Text style={styles.label}>Método utilizado</Text>
      <View style={styles.chips}>{METHOD_OPTIONS.map((o) => <Chip key={o.id} label={o.label} active={method === o.id} onPress={() => setMethod(o.id)} />)}</View>
      {method === 'other' ? <TextInput placeholderTextColor={PLACEHOLDER} style={styles.input} value={custom} onChangeText={setCustom} placeholder="Nome do método" maxLength={80} accessibilityLabel="Nome do método" /> : null}

      {method === 'three_km' || method === 'five_km' ? field('time', `Tempo total dos ${method === 'three_km' ? '3' : '5'} km (min:seg)`, 'Ex.: 25:40') : null}
      {method === 'cooper_12min' ? field('distance', 'Distância percorrida em 12 minutos (metros)', 'Ex.: 2800') : null}

      <Text style={styles.label}>Resultados disponíveis</Text>
      <View style={styles.chips}>
        <Chip label="Velocidades em km/h" active={unit === 'kmh'} onPress={() => setUnit('kmh')} />
        <Chip label="Velocidades em min/km" active={unit === 'pace'} onPress={() => setUnit('pace')} />
      </View>
      {field('vo2max', "VO₂máx (ml/kg/min)", "Ex.: 52,3")}
      {field('vvo2', `Velocidade no VO₂máx (${speedHint})`)}
      {field('hrmax', "Frequência cardíaca máxima (bpm)", "Ex.: 188")}
      <Text style={styles.label}>Limiar 2 (L2)</Text>
      {field('l2speed', `Velocidade no L2 (${speedHint})`)}{field('l2hr', "Frequência cardíaca no L2 (bpm)")}{field('l2vo2', "VO₂ no L2 (ml/kg/min), se disponível")}{field('l2vo2pct', "ou VO₂ no L2 em % do máximo, como no laudo (ex.: 88)")}
      <Text style={styles.label}>Limiar 1 (L1)</Text>
      {field('l1speed', `Velocidade no L1 (${speedHint})`)}{field('l1hr', "Frequência cardíaca no L1 (bpm)")}{field('l1vo2', "VO₂ no L1 (ml/kg/min), se disponível")}{field('l1vo2pct', "ou VO₂ no L1 em % do máximo, como no laudo (ex.: 53)")}

      {errors.map((e) => <Text key={e} style={styles.problem}>{e}</Text>)}
      <Pressable style={[styles.primary, saving && styles.disabled]} disabled={saving} onPress={() => void submit()} accessibilityRole="button"><Text style={styles.primaryText}>{saving ? 'Salvando...' : 'Salvar avaliação'}</Text></Pressable>
    </View>
  );
}

// ---------------------------------------------------------------- resultados, zonas e referência
function UnitToggle({ unit, setUnit }: { unit: SpeedUnit; setUnit: (u: SpeedUnit) => void }) {
  return <View style={styles.chips}><Chip label="Ritmo (min/km)" active={unit === 'pace'} onPress={() => setUnit('pace')} /><Chip label="Velocidade (km/h)" active={unit === 'kmh'} onPress={() => setUnit('kmh')} /></View>;
}

function Results({ profile, loading, unit, setUnit, onBack, onEvolution, onHow }: { profile: Profile | null; loading: boolean; unit: SpeedUnit; setUnit: (u: SpeedUnit) => void; onBack: () => void; onEvolution: () => void; onHow: () => void }) {
  const today = brToIso(todayBrDate()) ?? '';
  return (
    <View style={styles.wrap}>
      <Pressable onPress={onBack} accessibilityRole="button"><Text style={styles.back}>← Voltar</Text></Pressable>
      <Text style={styles.title}>Seus indicadores</Text>
      {loading ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
      {!loading && !profile?.reference ? <Text style={styles.hint}>Você ainda não registrou nenhuma avaliação.</Text> : null}
      {profile?.reference ? (
        <>
          <View style={styles.refBox}><Text style={styles.refText}>{profile.reference.label}</Text></View>
          <UnitToggle unit={unit} setUnit={setUnit} />
          {profile.indicators.map((i) => (
            <View key={i.key} style={styles.card}>
              <Text style={styles.hint}>{INDICATOR_LABELS[i.key]?.label ?? i.key}</Text>
              <Text style={styles.value}>{formatIndicatorValue(i.key, i.value, unit)}</Text>
              {INDICATOR_LABELS[i.key]?.kind === 'speed' ? <Text style={styles.hint}>{unit === 'pace' ? formatSpeed(i.value, 'kmh') : paceLabelFromKmh(i.value)}</Text> : null}
              {formatRange(i.key, i.rangeLow, i.rangeHigh, unit) ? <Text style={styles.hint}>Faixa de variação típica: {formatRange(i.key, i.rangeLow, i.rangeHigh, unit)}</Text> : null}
              <Text style={styles.note}>{ORIGIN_LABELS[i.origin] ?? i.origin} | {CONFIDENCE_LABELS[i.confidence] ?? i.confidence}{i.from.fromReference ? '' : ` | de ${methodLabel(i.from.method)}, ${brDateFromIso(i.from.performedAt)}`}</Text>
            </View>
          ))}
          {profile.zones ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Zonas de treinamento</Text>
              <InfoTip label="Como ler as zonas?">{ZONE_HELP}</InfoTip>
              <Text style={styles.hint}>{ZONES_USE_CARD}</Text>
              {profile.zones.map((z) => (
                <View key={z.id} style={styles.zoneRow}>
                  <Text style={styles.label}>{zoneTitle(z)}</Text>
                  <Text style={styles.hint}>{zoneSpeedText(z, unit)}</Text>
                  <Text style={styles.hint}>{z.heartRate ? `Frequência cardíaca observada no teste: ${z.heartRate[0] === 0 ? 'até' : `${z.heartRate[0]} a`} ${z.heartRate[1]} bpm` : 'Frequência cardíaca: sem dados suficientes'}</Text>
                </View>
              ))}
            </View>
          ) : <Text style={styles.hint}>As zonas aparecem quando existem velocidades de L1, L2 e VO₂máx.</Text>}
          {profile.operationalReference && profile.operationalReference.source !== 'tests' && profile.operationalReference.payload?.adjustment ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Referências em uso no seu programa</Text>
              <Text style={styles.hint}>{profile.operationalReference.source === 'coach_adjustment' ? 'Ajustadas pelo seu treinador' : 'Ajustadas com base nos seus treinos'} em {brDateFromIso(profile.operationalReference.createdAt.slice(0, 10))}. Os resultados originais dos seus testes continuam guardados.</Text>
              {profile.operationalReference.payload.adjustment.changes.map((c) => (
                <Text key={c.key} style={styles.label}>{INDICATOR_LABELS[c.key]?.label ?? c.key}: {formatIndicatorValue(c.key, c.from, unit)} → {formatIndicatorValue(c.key, c.to, unit)}</Text>
              ))}
              <Text style={styles.hint}>Motivo: {profile.operationalReference.justification}</Text>
              {profile.operationalReference.payload.zones ? profile.operationalReference.payload.zones.map((z) => (
                <View key={z.id} style={styles.zoneRow}>
                  <Text style={styles.label}>{zoneTitle(z)}</Text>
                  <Text style={styles.hint}>{zoneSpeedText(z, unit)}</Text>
                </View>
              )) : null}
            </View>
          ) : null}
          {profile.limitations.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Limitações destes valores</Text>
              {profile.limitations.map((l) => <Text key={l} style={styles.hint}>• {l}</Text>)}
            </View>
          ) : null}
          {profile.nextReassessmentDueAt ? <Text style={styles.hint}>{nextDueText(profile.nextReassessmentDueAt, today)}</Text> : null}
        </>
      ) : null}
      <Pressable onPress={onEvolution} accessibilityRole="button"><Text style={styles.link}>Evolução dos testes físicos</Text></Pressable>
      <Pressable onPress={onHow} accessibilityRole="button"><Text style={styles.link}>Como utilizamos os resultados dos testes?</Text></Pressable>
    </View>
  );
}

const zoneTitle = (z: Zone) => (z.id === 'Z1-Z2' ? z.label : `${z.id}: ${z.label}`);

function zoneSpeedText(z: Zone, unit: SpeedUnit): string {
  const [from, to] = z.speedKmh;
  if (z.open === 'fast') return unit === 'pace' ? `Ritmo: mais rápido que ${formatMinSec(z.paceSecondsPerKm[0])}/km` : `Velocidade: acima de ${from.toFixed(1).replace('.', ',')} km/h`;
  if (unit === 'pace') {
    const [fast, slow] = z.paceSecondsPerKm;
    return slow === null ? `Ritmo: mais lento que ${formatMinSec(fast)}/km` : `Ritmo: ${formatMinSec(fast)} a ${formatMinSec(slow)}/km`;
  }
  return from === 0 ? `Velocidade: até ${to.toFixed(1).replace('.', ',')} km/h` : `Velocidade: ${from.toFixed(1).replace('.', ',')} a ${to.toFixed(1).replace('.', ',')} km/h`;
}

// ---------------------------------------------------------------- evolução
const INDICATOR_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'vo2max', label: 'VO₂máx' }, { id: 'vvo2max_kmh', label: 'Velocidade no VO₂máx' }, { id: 'hrmax_bpm', label: 'FC máxima' },
  { id: 'l1_speed_kmh', label: 'L1: velocidade' }, { id: 'l1_hr_bpm', label: 'L1: FC' }, { id: 'l2_speed_kmh', label: 'L2: velocidade' }, { id: 'l2_hr_bpm', label: 'L2: FC' },
  { id: RAW_THREE_KM_TIME, label: 'Tempo dos 3 km' },
];

function Evolution({ rows, unit, setUnit, onBack }: { rows: HistoryRow[]; unit: SpeedUnit; setUnit: (u: SpeedUnit) => void; onBack: () => void }) {
  const [method, setMethod] = useState('all');
  const [indicator, setIndicator] = useState('vo2max');
  const methodsPresent = useMemo(() => [...new Set(rows.map((r) => r.method))], [rows]);
  const series = useMemo(() => buildSeries(rows, method, indicator), [rows, method, indicator]);
  const isSpeed = INDICATOR_LABELS[indicator]?.kind === 'speed';
  const isTime = indicator === RAW_THREE_KM_TIME;
  const fmt = (v: number) => (isTime ? formatMinSec(v) : formatIndicatorValue(indicator, v, unit));
  const tableRows = useMemo(() => [...rows].filter((r) => method === 'all' || r.method === method).sort((a, b) => (a.performedAt < b.performedAt ? 1 : -1)), [rows, method]);

  return (
    <View style={styles.wrap}>
      <Pressable onPress={onBack} accessibilityRole="button"><Text style={styles.back}>← Voltar</Text></Pressable>
      <Text style={styles.title}>Evolução dos testes físicos</Text>
      {rows.length === 0 ? <Text style={styles.hint}>Registre uma avaliação para acompanhar a sua evolução.</Text> : (
        <>
          <Text style={styles.label}>Método</Text>
          <View style={styles.chips}>
            <Chip label="Todos os métodos" active={method === 'all'} onPress={() => setMethod('all')} />
            {methodsPresent.map((m) => <Chip key={m} label={methodLabel(m, rows.find((r) => r.method === m)?.methodLabel)} active={method === m} onPress={() => setMethod(m)} />)}
          </View>
          <Text style={styles.label}>Indicador</Text>
          <View style={styles.chips}>{INDICATOR_OPTIONS.map((o) => <Chip key={o.id} label={o.label} active={indicator === o.id} onPress={() => setIndicator(o.id)} />)}</View>
          {isSpeed ? <UnitToggle unit={unit} setUnit={setUnit} /> : null}
          <Text style={styles.hint}>A comparação por um mesmo método é a melhor forma de acompanhar a evolução. Em "Todos os métodos" você vê a trajetória completa, com cada método identificado.</Text>

          {series.length === 0 ? <Text style={styles.hint}>Nenhuma avaliação com esse indicador {method === 'all' ? '' : 'nesse método '}ainda.</Text> : <Chart points={series} fmt={fmt} isSpeed={isSpeed} unit={unit} isTime={isTime} />}
          <View style={styles.chips}>{[...new Set(series.map((p) => p.method))].map((m) => <View key={m} style={styles.legend}><Marker method={m} size={12} /><Text style={styles.hint}>{methodLabel(m)}</Text></View>)}</View>

          <Text style={styles.cardTitle}>Tabela</Text>
          {tableRows.map((r) => {
            const found = isTime ? undefined : r.indicators.find((i) => i.key === indicator);
            const timeValue = isTime && r.method === 'three_km' && typeof r.rawResults?.totalSeconds === 'number' ? r.rawResults.totalSeconds : null;
            return (
              <View key={r.assessmentId} style={styles.card}>
                <Text style={styles.label}>{brDateFromIso(r.performedAt)} | {methodLabel(r.method, r.methodLabel)}</Text>
                <Text style={styles.hint}>Resultado original: {describeRawResults(r.method, r.rawResults)}</Text>
                <Text style={styles.hint}>{INDICATOR_OPTIONS.find((o) => o.id === indicator)?.label}: {found ? `${fmt(found.value)} (${ORIGIN_LABELS[found.origin] ?? found.origin})` : timeValue !== null ? `${fmt(timeValue)} (Informado)` : 'não disponível nesta avaliação'}</Text>
                {r.isReference ? <Text style={styles.refBadge}>Avaliação de referência atual</Text> : null}
              </View>
            );
          })}
        </>
      )}
    </View>
  );
}

function Marker({ method, size }: { method: string; size: number }) {
  const c = METHOD_COLORS[method] ?? COLORS.soft; const s = shapeFor(method); const h = size / 2;
  return (
    <Svg width={size} height={size}>
      {s === 'circle' ? <Circle cx={h} cy={h} r={h - 1} fill={c} /> : s === 'square' ? <Rect x={1} y={1} width={size - 2} height={size - 2} fill={c} /> : s === 'diamond' ? <Path d={`M${h} 1 L${size - 1} ${h} L${h} ${size - 1} L1 ${h} Z`} fill={c} /> : <Path d={`M${h} 1 L${size - 1} ${size - 1} L1 ${size - 1} Z`} fill={c} />}
    </Svg>
  );
}

function Chart({ points, fmt, isSpeed, unit, isTime }: { points: ReturnType<typeof buildSeries>; fmt: (v: number) => string; isSpeed: boolean; unit: SpeedUnit; isTime: boolean }) {
  const W = 320, H = 190, L = 56, R = 12, T = 14, B = 34;
  const values = points.map((p) => p.value);
  const lo0 = Math.min(...values), hi0 = Math.max(...values);
  const pad = hi0 === lo0 ? Math.max(Math.abs(hi0) * 0.05, 1) : (hi0 - lo0) * 0.15;
  const lo = lo0 - pad, hi = hi0 + pad;
  const xs = xPositions(points.map((p) => p.date), W - L - R - 24).map((x) => L + 12 + x);
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = [0, 1, 2, 3].map((i) => lo + ((hi - lo) * i) / 3);
  const tickLabel = (v: number) => (isTime ? formatMinSec(v) : isSpeed ? (unit === 'pace' ? paceLabelFromKmh(v).replace('/km', '') : v.toFixed(1)) : String(Math.round(v * 10) / 10));
  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} accessibilityLabel="Gráfico da evolução">
      {ticks.map((t) => (<React.Fragment key={t}><Line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#e5ebf0" strokeWidth={1} /><SvgText x={L - 6} y={y(t) + 4} fontSize={10} fill={COLORS.soft} textAnchor="end">{tickLabel(t)}</SvgText></React.Fragment>))}
      {points.length > 1 ? <Path d={points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xs[i]} ${y(p.value)}`).join(' ')} stroke={COLORS.brandSoft} strokeWidth={1.5} fill="none" /> : null}
      {points.map((p, i) => {
        const c = METHOD_COLORS[p.method] ?? COLORS.soft; const s = shapeFor(p.method); const cx = xs[i], cy = y(p.value);
        return (
          <React.Fragment key={p.assessmentId}>
            {s === 'circle' ? <Circle cx={cx} cy={cy} r={5} fill={c} stroke={p.isReference ? COLORS.ink : 'none'} strokeWidth={2} /> : s === 'square' ? <Rect x={cx - 5} y={cy - 5} width={10} height={10} fill={c} stroke={p.isReference ? COLORS.ink : 'none'} strokeWidth={2} /> : s === 'diamond' ? <Path d={`M${cx} ${cy - 6} L${cx + 6} ${cy} L${cx} ${cy + 6} L${cx - 6} ${cy} Z`} fill={c} stroke={p.isReference ? COLORS.ink : 'none'} strokeWidth={2} /> : <Path d={`M${cx} ${cy - 6} L${cx + 6} ${cy + 5} L${cx - 6} ${cy + 5} Z`} fill={c} stroke={p.isReference ? COLORS.ink : 'none'} strokeWidth={2} />}
            <SvgText x={cx} y={cy - 9} fontSize={9} fill={COLORS.muted} textAnchor="middle">{fmt(p.value).replace(' ml/kg/min', '').replace(' km/h', '').replace(' bpm', '')}</SvgText>
            <SvgText x={cx} y={H - 16} fontSize={9} fill={COLORS.soft} textAnchor="middle">{brDateFromIso(p.date).slice(0, 5)}</SvgText>
            <SvgText x={cx} y={H - 5} fontSize={8} fill={COLORS.soft} textAnchor="middle">{p.date.slice(0, 4)}</SvgText>
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

// ---------------------------------------------------------------- explicações
function HowWeUse({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.wrap}>
      <Pressable onPress={onBack} accessibilityRole="button"><Text style={styles.back}>← Voltar</Text></Pressable>
      <Text style={styles.title}>Como utilizamos os resultados dos testes?</Text>
      {HOW_WE_USE.map((s) => (<View key={s.title} style={styles.card}><Text style={styles.cardTitle}>{s.title}</Text><Text style={styles.hint}>{s.body}</Text></View>))}
      <View style={styles.card}><Text style={styles.cardTitle}>{REPEAT_TESTS_TITLE}</Text><Text style={styles.hint}>{REPEAT_TESTS_BODY}</Text></View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12, paddingBottom: 28 },
  back: { fontSize: 14, color: COLORS.brand, fontWeight: '600' },
  title: { fontSize: 22, fontWeight: '800', color: COLORS.ink },
  intro: { fontSize: 13, color: COLORS.muted, lineHeight: 19 },
  card: { padding: 14, borderWidth: 1, borderColor: COLORS.line, borderRadius: 10, gap: 6, backgroundColor: '#fff' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: COLORS.ink },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', gap: 12 },
  field: { flex: 1, gap: 4 },
  fieldWide: { gap: 4 },
  label: { fontSize: 13, fontWeight: '700', color: COLORS.muted },
  value: { fontSize: 24, fontWeight: '800', color: COLORS.ink },
  hint: { fontSize: 12, color: COLORS.muted, lineHeight: 17 },
  note: { fontSize: 11, color: COLORS.soft, lineHeight: 16 },
  link: { fontSize: 14, color: COLORS.brand, fontWeight: '700', paddingVertical: 4 },
  input: { borderWidth: 1, borderColor: COLORS.line, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: COLORS.ink, backgroundColor: '#fff' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: COLORS.line, backgroundColor: '#fff' },
  chipActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  chipText: { fontSize: 13, color: COLORS.muted, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  primary: { alignItems: 'center', paddingVertical: 14, borderRadius: 8, backgroundColor: COLORS.brand },
  primaryText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  disabled: { opacity: 0.6 },
  button: { alignItems: 'center', paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: COLORS.brand },
  buttonText: { fontSize: 14, fontWeight: '700', color: COLORS.brand },
  box: { padding: 14, borderWidth: 1, borderColor: COLORS.line, borderRadius: 10, gap: 8 },
  problem: { fontSize: 13, color: COLORS.danger },
  warn: { padding: 10, borderRadius: 8, backgroundColor: '#fff4e5' },
  warnText: { fontSize: 12, color: '#7a4a00', lineHeight: 17 },
  refBox: { padding: 12, borderRadius: 8, backgroundColor: '#eaf4f9' },
  refText: { fontSize: 14, fontWeight: '700', color: COLORS.brand },
  refBadge: { fontSize: 11, fontWeight: '700', color: COLORS.ok },
  zoneRow: { gap: 2, paddingTop: 6 },
});
