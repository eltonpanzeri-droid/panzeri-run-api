import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Text } from '../src/PtText';
import { HomeBorder, HomeColors, HomeRadius, HomeSpace, HomeTypography } from './homeTheme';
import { fetchJsonAuth } from './homeApi';
import { modalityName } from './chartData';
import { PanelPreset, PanelRange, maskBrDate, periodLabel, presetRange, queryFor, validateCustomRange } from './summaryPanelLogic';

// Painel de resumo da TELA INICIAL (14/11/2026, lista de Elton; saiu da tela "Evolução do treinamento"). Todos os números vêm do servidor (GET /me/evolution/panel); aqui só se apresenta.
// O padrão é "desde o início"; a aluna pode escolher 30 dias, 3 meses ou um período livre. Itens marcados "desde o início" (semanas desde que entrou, semana com mais km, recorde de semanas ativas)
// não mudam com o período. Treinos por modalidade tem o seletor de modalidade (Todas por padrão).
interface PanelDto {
  period: { from: string | null; to: string; isAll: boolean };
  treinosFeitos: number;
  porModalidade: Array<{ modality: string; count: number }>;
  kmPercorridos: number;
  mediaKmPorSemana: number | null;
  semanasComKm: number;
  semanasDesdeQueEntrou: number;
  semanaComMaisKm: { km: number; weekStart: string } | null;
  recordeSemanasAtivas: number;
}

const PRESETS: Array<{ id: PanelPreset; label: string }> = [
  { id: 'all', label: 'Desde o início' },
  { id: '30d', label: '30 dias' },
  { id: '90d', label: '3 meses' },
  { id: 'custom', label: 'Período livre' },
];

const km = (value: number) => `${String(value).replace('.', ',')} km`;
const weekLabel = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function Tile({ label, value, sub, wide, children }: { label: string; value: string; sub?: string; wide?: boolean; children?: React.ReactNode }) {
  return (
    <View style={[styles.tile, HomeBorder.card, wide && styles.tileWide]}>
      <Text style={styles.tileLabel}>{label}</Text>
      {children}
      <Text style={styles.tileValue}>{value}</Text>
      {sub ? <Text style={styles.tileSub}>{sub}</Text> : null}
    </View>
  );
}

export function SummaryPanel({ accessToken, todayIso }: { accessToken: string; todayIso: string }) {
  const [preset, setPreset] = useState<PanelPreset>('all');
  const [range, setRange] = useState<PanelRange>({ from: null, to: null });
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelDto | null | undefined>(undefined);
  const [modality, setModality] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setPanel(undefined);
    fetchJsonAuth<PanelDto>(`/me/evolution/panel${queryFor(range)}`, accessToken).then((data) => { if (alive) setPanel(data); });
    return () => { alive = false; };
  }, [accessToken, range.from, range.to]);

  function choose(next: PanelPreset) {
    setPreset(next);
    setError(null);
    if (next !== 'custom') { setRange(presetRange(next, todayIso)); setModality(null); }
  }

  function applyCustom() {
    const result = validateCustomRange(fromText, toText, todayIso);
    if (!result.ok) { setError(result.error); return; }
    setError(null);
    setModality(null);
    setRange(result.range);
  }

  const label = periodLabel(range);
  const selected = modality ? panel?.porModalidade.find((m) => m.modality === modality) : null;
  const modalityCount = panel ? (modality ? (selected?.count ?? 0) : panel.treinosFeitos) : 0;

  return (
    <View style={{ gap: HomeSpace.related }}>
      <View style={{ gap: 4 }}>
        <Text style={styles.title}>Seu resumo</Text>
        <Text style={styles.subtitle}>Os seus números desde que você começou. Você pode escolher um período.</Text>
      </View>
      <View style={styles.chips}>
        {PRESETS.map((p) => (
          <Pressable key={p.id} onPress={() => choose(p.id)} style={[styles.chip, preset === p.id && styles.chipActive]} accessibilityRole="button" accessibilityLabel={`Período: ${p.label}`}>
            <Text style={[styles.chipText, preset === p.id && styles.chipTextActive]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>
      {preset === 'custom' ? (
        <View style={[styles.customBox, HomeBorder.card]}>
          <View style={styles.customRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.inputLabel}>De</Text>
              <TextInput value={fromText} onChangeText={(t) => setFromText(maskBrDate(t))} placeholder="dd/mm/aaaa" keyboardType="number-pad" maxLength={10} style={styles.input} accessibilityLabel="Data inicial" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.inputLabel}>Até</Text>
              <TextInput value={toText} onChangeText={(t) => setToText(maskBrDate(t))} placeholder="dd/mm/aaaa" keyboardType="number-pad" maxLength={10} style={styles.input} accessibilityLabel="Data final" />
            </View>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable onPress={applyCustom} style={styles.apply} accessibilityRole="button"><Text style={styles.applyText}>Aplicar período</Text></Pressable>
        </View>
      ) : null}

      {panel === undefined ? (
        <ActivityIndicator style={{ marginVertical: HomeSpace.component }} />
      ) : panel === null ? (
        <Text style={styles.subtitle}>Não foi possível carregar o seu resumo agora.</Text>
      ) : (
        <View style={styles.grid}>
          <Tile label="SEMANAS DESDE QUE ENTROU" value={String(panel.semanasDesdeQueEntrou)} sub="desde o início" />
          <Tile label="TREINOS FEITOS" value={String(panel.treinosFeitos)} sub={label} />
          <Tile label="TREINOS POR MODALIDADE" value={String(modalityCount)} sub={`${modality ? modalityName(modality) : 'todas as modalidades'} · ${label}`} wide>
            <View style={styles.chips}>
              {[null, ...panel.porModalidade.map((m) => m.modality)].map((m) => (
                <Pressable key={m ?? 'todas'} onPress={() => setModality(m)} style={[styles.chip, modality === m && styles.chipActive]} accessibilityRole="button" accessibilityLabel={`Modalidade: ${m ? modalityName(m) : 'Todas'}`}>
                  <Text style={[styles.chipText, modality === m && styles.chipTextActive]}>{m ? modalityName(m) : 'Todas'}</Text>
                </Pressable>
              ))}
            </View>
          </Tile>
          <Tile label="KM PERCORRIDOS" value={panel.kmPercorridos > 0 ? km(panel.kmPercorridos) : '—'} sub={label} />
          <Tile label="MÉDIA DE KM POR SEMANA" value={panel.mediaKmPorSemana != null ? km(panel.mediaKmPorSemana) : '—'} sub={panel.semanasComKm > 0 ? `${panel.semanasComKm} ${panel.semanasComKm === 1 ? 'semana' : 'semanas'} com km · ${label}` : label} />
          <Tile label="SEMANA COM MAIS KM" value={panel.semanaComMaisKm ? km(panel.semanaComMaisKm.km) : '—'} sub={panel.semanaComMaisKm ? `semana de ${weekLabel(panel.semanaComMaisKm.weekStart)} · desde o início` : 'desde o início'} />
          <Tile label="RECORDE DE SEMANAS ATIVAS" value={String(panel.recordeSemanasAtivas)} sub="semanas seguidas com treino · desde o início" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { ...HomeTypography.sectionTitle, color: HomeColors.textPrimary },
  subtitle: { ...HomeTypography.body, color: HomeColors.textSecondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: HomeRadius.pill, backgroundColor: HomeColors.surfaceSecondary },
  chipActive: { backgroundColor: HomeColors.panzeriPrimary },
  chipText: { ...HomeTypography.label, color: HomeColors.textSecondary },
  chipTextActive: { color: '#FFFFFF' },
  customBox: { backgroundColor: HomeColors.surface, borderRadius: HomeRadius.cardLarge, padding: HomeSpace.related, gap: 8 },
  customRow: { flexDirection: 'row', gap: 10 },
  inputLabel: { ...HomeTypography.label, color: HomeColors.textSecondary, marginBottom: 4 },
  input: { ...HomeTypography.body, borderWidth: 1, borderColor: '#D1D5DB', borderRadius: HomeRadius.small, paddingHorizontal: 10, paddingVertical: 8, color: HomeColors.textPrimary },
  error: { ...HomeTypography.tertiary, color: '#B42318' },
  apply: { alignSelf: 'flex-start', backgroundColor: HomeColors.panzeriPrimary, borderRadius: HomeRadius.pill, paddingHorizontal: 16, paddingVertical: 8 },
  applyText: { ...HomeTypography.bodyMedium, color: '#FFFFFF' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { flexGrow: 1, flexBasis: '47%', backgroundColor: HomeColors.surface, borderRadius: HomeRadius.cardLarge, padding: HomeSpace.related, gap: 4 },
  tileWide: { flexBasis: '100%' },
  tileLabel: { ...HomeTypography.label, color: HomeColors.textSecondary, letterSpacing: 0.4 },
  tileValue: { fontSize: 24, fontWeight: '800', color: HomeColors.textPrimary },
  tileSub: { ...HomeTypography.tertiary, color: HomeColors.textSecondary },
});
