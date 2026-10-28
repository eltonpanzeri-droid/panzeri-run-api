import React, { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  isAppleHealthSupported,
  isHealthDataAvailable,
  readRecentRunningWorkouts,
  readWorkoutRoute,
  requestHealthAuthorization,
  type AppleRoutePoint,
} from '../../modules/panzeri-apple-health/src';

// Sincronizacao simples com o app Saude (28/10/2026). Substitui a antiga tela tecnica (AppleHealthProofCard) para o aluno: um unico botao que abre a folha de permissao do
// proprio iOS, le os treinos de corrida e as medidas guardadas junto deles (distancia, frequencia cardiaca, calorias, passos, potencia, elevacao e percurso) e envia para a
// PROPRIA conta. O iOS nao informa o que foi negado: dado que nao chegou simplesmente nao aparece. Tocar de novo nunca duplica (o servidor reconhece cada treino) e completa
// o que faltava em treinos ja' importados. So' iOS nativo; no PWA/Android o cartao nao aparece.

const MAX_WORKOUTS = 200;
const WORKOUTS_PER_REQUEST = 50;
const ROUTES_PER_REQUEST = 5;

type ImportResponse = { created: number; enriched?: number; alreadyImported: number; rejected: number; items: Array<{ uuid: string | null; status: string; enriched?: boolean }> };

async function post<T>(apiUrl: string, accessToken: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

export function AppleHealthSyncCard({ accessToken, apiUrl }: { accessToken: string; apiUrl: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  if (Platform.OS !== 'ios' || !isAppleHealthSupported) return null;

  async function sync() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      if (!isHealthDataAvailable()) {
        setMessage({ ok: false, text: 'O app Saúde não está disponível neste aparelho.' });
        return;
      }
      await requestHealthAuthorization();
      const workouts = await readRecentRunningWorkouts(MAX_WORKOUTS);
      if (workouts.length === 0) {
        setMessage({ ok: false, text: 'Não encontramos corridas no app Saúde. Confira em Ajustes > Saúde > Acesso a Dados e Dispositivos > Panzeri Run se o acesso aos treinos está liberado.' });
        return;
      }
      let created = 0; let enriched = 0; let already = 0; let rejected = 0;
      const changed: string[] = [];
      for (let start = 0; start < workouts.length; start += WORKOUTS_PER_REQUEST) {
        const result = await post<ImportResponse>(apiUrl, accessToken, '/apple-health/workouts', { workouts: workouts.slice(start, start + WORKOUTS_PER_REQUEST) });
        created += result.created; enriched += result.enriched ?? 0; rejected += result.rejected;
        already += result.alreadyImported - (result.enriched ?? 0);
        // percurso: so' dos treinos novos ou que receberam dados novos neste envio
        const ids = new Set(workouts.slice(start, start + WORKOUTS_PER_REQUEST).map((w) => w.uuid.toLowerCase()));
        for (const item of result.items) if (item.uuid && ids.has(item.uuid.toLowerCase()) && (item.status === 'created' || item.enriched === true)) changed.push(item.uuid.toLowerCase());
      }
      // Percurso (GPS): opcional. Falha ou ausencia de rota nunca derruba a sincronizacao dos treinos.
      let routes = 0;
      try {
        const pending: Array<{ recordId: string; points: AppleRoutePoint[] }> = [];
        for (const uuid of changed) {
          const points = await readWorkoutRoute(uuid);
          if (points.length >= 2) pending.push({ recordId: uuid, points });
        }
        for (let start = 0; start < pending.length; start += ROUTES_PER_REQUEST) {
          const result = await post<{ stored: number }>(apiUrl, accessToken, '/apple-health/routes', { routes: pending.slice(start, start + ROUTES_PER_REQUEST) });
          routes += result.stored;
        }
      } catch {
        routes = 0;
      }
      const parts = [
        created > 0 ? `${plural(created, 'treino novo importado', 'treinos novos importados')}` : null,
        enriched > 0 ? `${plural(enriched, 'treino atualizado', 'treinos atualizados')} com mais dados` : null,
        already > 0 ? `${plural(already, 'já estava', 'já estavam')} no Panzeri Run` : null,
        routes > 0 ? `${plural(routes, 'percurso', 'percursos')} do mapa` : null,
        rejected > 0 ? `${plural(rejected, 'não pôde ser importado', 'não puderam ser importados')}` : null,
      ].filter(Boolean);
      setMessage({ ok: rejected === 0, text: `Pronto. ${parts.join(' · ')}.` });
    } catch (error) {
      const detail = error instanceof Error && error.message.startsWith('HTTP ') ? ` (${error.message})` : '';
      setMessage({ ok: false, text: `Não foi possível sincronizar agora${detail}. Tente novamente em instantes.` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Apple Saúde</Text>
      <Text style={styles.hint}>Traz suas corridas do app Saúde para o Panzeri Run, com as medidas guardadas junto de cada treino: distância, frequência cardíaca, calorias, passos, potência, elevação e percurso. Você escolhe o que compartilhar na tela do iPhone, e só entra o que você permitir.</Text>
      <Pressable style={[styles.button, busy && styles.buttonDisabled]} disabled={busy} onPress={() => void sync()} accessibilityRole="button">
        {busy ? <ActivityIndicator size="small" color="#246F91" /> : null}
        <Text style={styles.buttonText}>{busy ? 'Sincronizando…' : 'Continuar e sincronizar'}</Text>
      </Pressable>
      {message ? <Text style={[styles.message, message.ok ? null : styles.messageProblem]}>{message.text}</Text> : null}
      <Text style={styles.hint}>Você pode tocar de novo sempre que quiser: treinos já importados não são duplicados e, se novos dados estiverem disponíveis, eles são completados.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 16, padding: 14, borderWidth: 1, borderColor: '#246F91', borderRadius: 8, gap: 10 },
  title: { fontSize: 16, fontWeight: '700', color: '#071827' },
  hint: { fontSize: 12, color: '#4a5560' },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#246F91' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { fontSize: 15, color: '#246F91', fontWeight: '700' },
  message: { fontSize: 13, color: '#14532d' },
  messageProblem: { color: '#b91c1c' },
});
