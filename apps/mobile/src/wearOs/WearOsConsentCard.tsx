import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';
import { Text } from '../PtText';

// Autorizacoes do relogio Wear OS (17/11/2026, fase 3). Texto, grupos e versao vem do servidor (GET /me/wear/consent); a aluna marca o que autoriza (nada vem marcado), confirma expressamente e salva
// (PUT /me/wear/consent com a versao e o hash do texto que ela viu). Depois pode alterar grupos, desligar o uso pela IA ou retirar tudo; retirar apaga os dados do grupo retirado. O texto e' RASCUNHO
// ate a revisao de Elton e do advogado. Fica na tela Samsung / Galaxy Watch, acima do pareamento.

interface ConsentGroupView { id: string; label: string; description: string; requires: string[]; granted: boolean }
interface ConsentDocument { version: string; textHash: string; title: string; intro: string; sections: Array<{ heading: string | null; paragraphs?: string[] }>; acknowledgementText: string; confirmButtonLabel: string }
interface ConsentView { connected: boolean; consent: { needsReview: boolean; grantedVersion: string | null }; groups: ConsentGroupView[]; ai: boolean; document: ConsentDocument }

async function errorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { message?: string | string[] };
    return Array.isArray(data.message) ? data.message.join(' ') : data.message || 'Tente de novo.';
  } catch {
    return 'Tente de novo.';
  }
}

export function WearOsConsentCard({ accessToken, apiUrl }: { accessToken: string; apiUrl: string }) {
  const [view, setView] = useState<ConsentView | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [ai, setAi] = useState(true);
  const [acknowledged, setAcknowledged] = useState(false);
  const [showText, setShowText] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

  const apply = useCallback((data: ConsentView) => {
    setView(data);
    setSelected(data.groups.filter((g) => g.granted).map((g) => g.id));
    setAi(data.connected ? data.ai : true);
    setAcknowledged(false);
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/me/wear/consent`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (response.ok) apply((await response.json()) as ConsentView);
    } catch {
      // sem a tela de autorizacao nada e' enviado: o servidor recusa treino sem autorizacao
    }
  }, [accessToken, apiUrl, apply]);
  useEffect(() => { void load(); }, [load]);

  const toggle = (id: string) => {
    if (!view) return;
    setSelected((current) => {
      if (current.includes(id)) {
        // retirar um grupo retira tambem os que dependem dele
        const dependents = view.groups.filter((g) => g.requires.includes(id)).map((g) => g.id);
        return current.filter((item) => item !== id && !dependents.includes(item));
      }
      const needs = view.groups.find((g) => g.id === id)?.requires ?? [];
      return [...new Set([...current, ...needs, id])];
    });
  };

  const save = useCallback(async (groups: string[]) => {
    if (!view || busy) return;
    const granting = groups.some((id) => !view.groups.find((g) => g.id === id)?.granted) || view.consent.needsReview;
    if (granting && !acknowledged) { setMessage('Marque a confirmação ao final do texto para autorizar.'); return; }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`${apiUrl}/me/wear/consent`, {
        method: 'PUT', headers,
        body: JSON.stringify({ groups, ...(groups.length > 0 ? { ai } : {}), acknowledged, version: view.document.version, textHash: view.document.textHash }),
      });
      if (!response.ok) { setMessage(await errorMessage(response)); return; }
      setMessage(groups.length === 0 ? 'Autorizações retiradas. O relógio deixou de enviar treinos.' : 'Autorizações salvas.');
      await load();
    } catch {
      setMessage('Não consegui salvar agora. Verifique a internet e tente de novo.');
    } finally {
      setBusy(false);
    }
  }, [acknowledged, ai, apiUrl, busy, headers, load, view]);

  if (!view) return null;
  const doc = view.document;
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{doc.title}</Text>
      <Text style={styles.text}>{doc.intro}</Text>
      {view.consent.needsReview ? <Text style={styles.warn}>O texto das autorizações mudou. Leia e confirme de novo para o relógio voltar a enviar treinos.</Text> : null}
      <Pressable onPress={() => setShowText((v) => !v)} accessibilityRole="button"><Text style={styles.link}>{showText ? 'Ocultar o texto completo' : 'Ler o texto completo'}</Text></Pressable>
      {showText ? doc.sections.map((section, index) => (
        <View key={index} style={styles.section}>
          {section.heading ? <Text style={styles.subtitle}>{section.heading}</Text> : null}
          {(section.paragraphs ?? []).map((paragraph, i) => <Text key={i} style={styles.text}>{paragraph}</Text>)}
        </View>
      )) : null}
      {view.groups.map((group) => (
        <View key={group.id} style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowName}>{group.label}</Text>
            <Text style={styles.hint}>{group.description}</Text>
          </View>
          <Switch value={selected.includes(group.id)} onValueChange={() => toggle(group.id)} disabled={busy} />
        </View>
      ))}
      {selected.length > 0 ? (
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowName}>Usar nas análises com inteligência artificial (Atlas)</Text>
            <Text style={styles.hint}>Já faz parte desta autorização e pode ser desligado quando quiser.</Text>
          </View>
          <Switch value={ai} onValueChange={setAi} disabled={busy} />
        </View>
      ) : null}
      {selected.length > 0 ? (
        <View style={styles.row}>
          <View style={styles.rowText}><Text style={styles.hint}>{doc.acknowledgementText}</Text></View>
          <Switch value={acknowledged} onValueChange={setAcknowledged} disabled={busy} accessibilityLabel="Li e autorizo" />
        </View>
      ) : null}
      <Pressable style={[styles.button, busy && styles.disabled]} disabled={busy} onPress={() => void save(selected)} accessibilityRole="button">
        {busy ? <ActivityIndicator size="small" color="#0B3D5C" /> : null}
        <Text style={styles.buttonText}>{selected.length === 0 && view.connected ? 'Retirar todas as autorizações' : doc.confirmButtonLabel}</Text>
      </Pressable>
      {message ? <Text style={styles.hint}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 12, padding: 14, gap: 10, backgroundColor: '#FFFFFF', marginBottom: 12 },
  title: { fontSize: 16, fontWeight: '700', color: '#0F172A' },
  subtitle: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  text: { fontSize: 13, color: '#475569' },
  warn: { fontSize: 13, color: '#B42318', fontWeight: '600' },
  link: { fontSize: 13, color: '#0B3D5C', fontWeight: '700', textDecorationLine: 'underline' },
  section: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowText: { flex: 1, gap: 2 },
  rowName: { fontSize: 14, fontWeight: '600', color: '#0F172A' },
  hint: { fontSize: 12, color: '#475569' },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: '#0B3D5C', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: '#FFFFFF' },
  disabled: { opacity: 0.5 },
  buttonText: { color: '#0B3D5C', fontWeight: '700', fontSize: 14 },
});
