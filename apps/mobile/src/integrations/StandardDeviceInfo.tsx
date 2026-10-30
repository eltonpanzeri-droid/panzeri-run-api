import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../PtText';
import { Ionicons } from '@expo/vector-icons';
import { PRColors } from '../../theme/tokens';

// Roteiro PADRAO de toda integracao de dispositivo (30/10/2026): o mesmo texto e a mesma ordem para Apple, Health Connect, Samsung, COROS, Zepp, Polar, Wahoo, Strava...
// Os valores de cada fabricante vem do catalogo do servidor (GET /me/integrations -> profile); aqui so' ha o texto-padrao. Nao concede nem pede autorizacao: quem pede e' a tela
// propria de cada integracao (quando existe) ou o sistema/fabricante. O texto geral de privacidade fica em "Privacidade e dados".
// Regra editorial: so' afirma o que o servidor confirma; o que a fabricante nao libera aparece como "ainda nao disponivel", nunca como promessa.
export type DataGroupId = 'activities' | 'performance' | 'sleep' | 'recovery' | 'daily' | 'route' | 'other_health';
export interface IntegrationProfile {
  dataGroups: DataGroupId[];
  workoutDelivery: 'available' | 'preparing' | 'not_available';
  workoutDeliveryNote: string;
  authorizedBy: 'manufacturer' | 'panzeri' | 'both';
  aiUse: 'allowed' | 'with_consent' | 'not_used';
}

export const GROUP_TEXT: Record<DataGroupId, { label: string; description: string }> = {
  activities: { label: 'Treinamentos e atividades físicas', description: 'Modalidade, data, horário, duração, distância, velocidade, ritmo, calorias, elevação e demais informações das sessões realizadas.' },
  performance: { label: 'Frequência cardíaca e desempenho', description: 'Frequência cardíaca, cadência, potência, dinâmica de corrida e outras medições relacionadas ao esforço físico.' },
  sleep: { label: 'Sono', description: 'Duração, horários, estágios do sono e demais informações disponíveis sobre seu descanso.' },
  recovery: { label: 'Recuperação e indicadores fisiológicos', description: 'Frequência cardíaca de repouso, variabilidade da frequência cardíaca, indicadores de recuperação e outras medições autorizadas.' },
  daily: { label: 'Atividade diária', description: 'Passos, deslocamentos, gasto energético, tempo ativo e outras informações relacionadas à movimentação ao longo do dia.' },
  route: { label: 'Percursos e localização', description: 'Registros de percurso, quando disponíveis e autorizados, para apresentação e análise das atividades.' },
  other_health: { label: 'Outros dados de saúde e bem-estar', description: 'Informações adicionais que você optar por compartilhar, conforme as funcionalidades disponíveis e as autorizações aplicáveis.' },
};

const USES = [
  'Registrar e organizar suas atividades.',
  'Comparar treinos planejados e realizados.',
  'Acompanhar sua evolução ao longo do tempo.',
  'Identificar tendências individuais de desempenho e recuperação.',
  'Produzir gráficos e relatórios.',
  'Apoiar a personalização das próximas sessões de treinamento.',
];

export function aiLine(aiUse: IntegrationProfile['aiUse']): string {
  if (aiUse === 'not_used') return 'Os dados desta integração não são enviados à inteligência artificial.';
  if (aiUse === 'with_consent') return 'Indicadores pertinentes só serão usados nas análises feitas com auxílio de inteligência artificial se você der uma autorização própria para isso.';
  return 'Quando aplicável, indicadores pertinentes também poderão ser utilizados nas análises feitas com auxílio de inteligência artificial.';
}

export function authorizationLines(authorizedBy: IntegrationProfile['authorizedBy']): string[] {
  const own = 'Outras são registradas no Panzeri Run, para definir quais informações podem ser armazenadas e utilizadas.';
  const maker = 'Algumas autorizações são solicitadas diretamente pelo fabricante ou pelo sistema do seu dispositivo.';
  const lines = authorizedBy === 'manufacturer' ? [maker] : authorizedBy === 'panzeri' ? [own] : [maker, own];
  return [...lines, 'O Panzeri Run respeita as permissões concedidas e as condições aplicáveis ao tratamento dos dados.'];
}

export function workoutLine(profile: IntegrationProfile): string {
  const status = profile.workoutDelivery === 'available' ? 'Disponível.' : profile.workoutDelivery === 'preparing' ? 'Em preparação.' : 'Ainda não disponível.';
  return `${status} ${profile.workoutDeliveryNote}`;
}

export function StandardDeviceInfo({ name, profile, operational, defaultOpen }: { name: string; profile?: IntegrationProfile; operational: boolean; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!profile) return null;
  return (
    <View style={styles.card}>
      <Pressable onPress={() => setOpen((value) => !value)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.header}>
        <Text style={styles.title}>{operational ? 'Como esta integração funciona' : `Sobre a integração com ${name}`}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={PRColors.ocean} />
      </Pressable>
      {open ? (
        <View style={{ gap: 10 }}>
          <Text style={styles.body}>
            {operational
              ? 'Com esta integração, você pode compartilhar informações disponíveis sobre suas atividades, seu desempenho e sua recuperação. A disponibilidade depende dos registros existentes, das permissões concedidas e dos recursos oferecidos pela integração.'
              : 'Esta integração ainda não está disponível para conexão. Nenhum dado seu é solicitado enquanto ela não for liberada. Abaixo, o que poderá ser compartilhado quando for.'}
          </Text>
          {profile.dataGroups.length > 0 ? (
            <View style={{ gap: 8 }}>
              <Text style={styles.heading}>{operational ? 'Quais informações podem ser compartilhadas' : 'Informações que poderão ser compartilhadas quando a integração for liberada'}</Text>
              {profile.dataGroups.map((id) => (
                <View key={id}>
                  <Text style={styles.groupLabel}>{GROUP_TEXT[id].label}</Text>
                  <Text style={styles.body}>{GROUP_TEXT[id].description}</Text>
                </View>
              ))}
              <Text style={styles.small}>Você escolhe o que compartilhar quando a integração oferecer essa opção. Nem toda informação está sempre disponível: depende do dispositivo e do que o fabricante libera.</Text>
            </View>
          ) : null}
          <View style={{ gap: 4 }}>
            <Text style={styles.heading}>Como utilizamos essas informações</Text>
            {USES.map((line) => <Text key={line} style={styles.body}>• {line}</Text>)}
            <Text style={styles.body}>{aiLine(profile.aiUse)}</Text>
          </View>
          <View style={{ gap: 4 }}>
            <Text style={styles.heading}>Envio de treinos ao dispositivo</Text>
            <Text style={styles.body}>{workoutLine(profile)}</Text>
            <Text style={styles.small}>O envio de treinos é diferente da importação de atividades e tem autorização própria.</Text>
          </View>
          <View style={{ gap: 4 }}>
            <Text style={styles.heading}>Suas autorizações</Text>
            {authorizationLines(profile.authorizedBy).map((line) => <Text key={line} style={styles.body}>{line}</Text>)}
          </View>
          <Text style={styles.small}>As medições são produzidas pelos dispositivos e aplicativos que você usa; a disponibilidade e a precisão podem variar. O Panzeri Run usa essas informações como apoio ao acompanhamento esportivo e à individualização do treinamento. O tratamento segue as regras de Privacidade e dados.</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 8, borderWidth: 1, borderColor: '#dbe4ea', backgroundColor: '#ffffff', padding: 16, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { color: '#111827', fontSize: 15, fontWeight: '800', flex: 1 },
  heading: { color: '#111827', fontSize: 14, fontWeight: '800' },
  groupLabel: { color: '#111827', fontSize: 13, fontWeight: '700' },
  body: { color: '#475569', fontSize: 13, lineHeight: 18 },
  small: { color: '#64748b', fontSize: 12, lineHeight: 17 },
});
