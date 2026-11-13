import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../src/PtText';
import { HomeBorder, HomeColors, HomeRadius, HomeSpace, HomeTypography } from './homeTheme';
import { fetchJsonAuth } from './homeApi';
import { modalityName } from './chartData';
import { CurrentWeekDto, weekCoachText } from './summaryPanelLogic';

// Semana em curso (14/11/2026, pedido de Elton): área própria, FORA dos números gerais, junto com o antigo "Seu acompanhamento". Números do servidor (GET /me/evolution/panel, semanaAtual):
// treinos feitos (com seletor de modalidade), km corridos, quanto falta de treino e de km. O texto de incentivo é por regra. As frases de sono e cansaço (se houver) vêm das telas de detalhe.
const km = (value: number) => `${String(value).replace('.', ',')} km`;

function Tile({ label, value, sub, children }: { label: string; value: string; sub?: string; children?: React.ReactNode }) {
  return (
    <View style={[styles.tile, HomeBorder.card]}>
      <Text style={styles.tileLabel}>{label}</Text>
      {children}
      <Text style={styles.tileValue}>{value}</Text>
      {sub ? <Text style={styles.tileSub}>{sub}</Text> : null}
    </View>
  );
}

export function ThisWeekCard({ accessToken, firstName, extraLines }: { accessToken: string; firstName: string; extraLines: string[] }) {
  const [week, setWeek] = useState<CurrentWeekDto | null | undefined>(undefined);
  const [modality, setModality] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchJsonAuth<{ semanaAtual: CurrentWeekDto }>('/me/evolution/panel', accessToken).then((data) => { if (alive) setWeek(data?.semanaAtual ?? null); });
    return () => { alive = false; };
  }, [accessToken]);

  if (week === undefined) return <ActivityIndicator style={{ marginVertical: HomeSpace.component }} />;
  if (week === null) return null; // sem leitura: a tela inicial segue sem este cartão

  const selected = modality ? week.porModalidade.find((m) => m.modality === modality)?.count ?? 0 : week.treinosFeitos;
  return (
    <View style={[styles.card, HomeBorder.card]}>
      <View style={styles.header}>
        <Ionicons name="flag-outline" size={18} color={HomeColors.panzeriPrimary} />
        <Text style={styles.title}>Esta semana</Text>
      </View>
      <Text style={styles.coach}>{weekCoachText(week, firstName)}</Text>
      <View style={styles.grid}>
        <Tile label="TREINOS FEITOS" value={String(selected)} sub={modality ? modalityName(modality) : 'todas as modalidades'}>
          {week.porModalidade.length > 1 ? (
            <View style={styles.chips}>
              {[null, ...week.porModalidade.map((m) => m.modality)].map((m) => (
                <Pressable key={m ?? 'todas'} onPress={() => setModality(m)} style={[styles.chip, modality === m && styles.chipActive]} accessibilityRole="button" accessibilityLabel={`Modalidade: ${m ? modalityName(m) : 'Todas'}`}>
                  <Text style={[styles.chipText, modality === m && styles.chipTextActive]}>{m ? modalityName(m) : 'Todas'}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </Tile>
        <Tile label="KM CORRIDOS" value={week.kmRealizados > 0 ? km(week.kmRealizados) : '0 km'} sub={week.kmPrescritos != null ? `de ${km(week.kmPrescritos)} prescritos` : 'nesta semana'} />
        <Tile label="FALTAM TREINOS" value={String(week.treinosFaltam)} sub={week.treinosPrescritos > 0 ? `de ${week.treinosPrescritos} do programa` : 'sem treinos do programa'} />
        <Tile label="FALTAM KM" value={week.kmFaltam != null ? km(week.kmFaltam) : '—'} sub={week.kmFaltam === 0 && week.kmAlemDoPrescrito > 0 ? `você passou ${km(week.kmAlemDoPrescrito)}` : `${week.diasRestantes} ${week.diasRestantes === 1 ? 'dia restante' : 'dias restantes'}`} />
      </View>
      {extraLines.length > 0 ? <Text style={styles.extra}>{extraLines.join(' ')}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: HomeColors.surfaceHighlight, borderRadius: HomeRadius.cardLarge, padding: HomeSpace.component, gap: HomeSpace.related },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { ...HomeTypography.sectionTitle, color: HomeColors.textPrimary },
  coach: { ...HomeTypography.body, color: HomeColors.textPrimary, lineHeight: 22 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { flexGrow: 1, flexBasis: '47%', backgroundColor: HomeColors.surface, borderRadius: HomeRadius.cardLarge, padding: HomeSpace.related, gap: 4 },
  tileLabel: { ...HomeTypography.label, color: HomeColors.textSecondary, letterSpacing: 0.4 },
  tileValue: { fontSize: 24, fontWeight: '800', color: HomeColors.textPrimary },
  tileSub: { ...HomeTypography.tertiary, color: HomeColors.textSecondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: HomeRadius.pill, backgroundColor: HomeColors.surfaceSecondary },
  chipActive: { backgroundColor: HomeColors.panzeriPrimary },
  chipText: { ...HomeTypography.label, color: HomeColors.textSecondary },
  chipTextActive: { color: '#FFFFFF' },
  extra: { ...HomeTypography.body, color: HomeColors.textSecondary, lineHeight: 21 },
});
