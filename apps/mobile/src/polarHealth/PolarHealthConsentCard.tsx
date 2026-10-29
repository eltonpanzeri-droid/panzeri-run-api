import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../PtText';
import { PRColors } from '../../theme/tokens';

// Saude e recuperacao da Polar (23/10/2026): quem JA' conectou a Polar escolhe aqui, sem reconectar, quais grupos de dados de saude compartilhar (sono, recuperacao noturna/HRV, atividade
// diaria). Texto, versao e hash vem do servidor (GET /polar/health-consent) e voltam na resposta, para o servidor registrar o que a aluna de fato viu. Enquanto ela nao escolher, NADA de saude
// e' importado. Retirar um grupo apaga os dados ja' importados dele. So' aparece para quem esta conectada a Polar.
interface Group { id: string; label: string; description: string }
interface Doc { version: string; title: string; paragraphs: string[]; groups: Group[]; checkboxText: string; buttonLabel: string; textHash: string }
interface Permissions { connected: boolean; decided: boolean; granted: string[]; needsNewAuthorization: boolean; grantedAt: string | null }

const privacyUrl = 'https://agenteselton-panzeri-run-api.hbljgk.easypanel.host/politica-privacidade';

export function PolarHealthConsentCard({ apiUrl, accessToken }: { apiUrl: string; accessToken: string }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [perms, setPerms] = useState<Permissions | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const mounted = useRef(true);
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` };

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/polar/health-consent`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) return;
      const body = (await response.json()) as { document: Doc; permissions: Permissions };
      if (!mounted.current) return;
      setDoc(body.document);
      setPerms(body.permissions);
      setSelected(body.permissions.granted);
    } catch { /* sem o pedido na tela, nada e' importado: o estado seguro continua */ }
  }, [apiUrl, accessToken]);

  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, [load]);

  if (!doc || !perms || !perms.connected) return null;

  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  const changed = selected.length !== perms.granted.length || selected.some((id) => !perms.granted.includes(id));
  const needsAck = selected.length > 0 && (selected.some((id) => !perms.granted.includes(id)) || perms.needsNewAuthorization);
  const canSave = !busy && (changed || perms.needsNewAuthorization) && (!needsAck || ack) && (selected.length > 0 || perms.granted.length > 0);

  async function save() {
    if (!canSave) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`${apiUrl}/polar/health-consent`, {
        method: 'POST', headers,
        body: JSON.stringify(selected.length > 0 ? { categories: selected, acknowledged: true, consentVersion: doc!.version, consentTextHash: doc!.textHash } : { categories: [] }),
      });
      if (!response.ok) { setMessage({ ok: false, text: 'Não foi possível salvar agora. Tente de novo.' }); return; }
      setAck(false);
      setMessage({ ok: true, text: selected.length > 0 ? 'Escolha salva. Os dados começam a chegar em alguns minutos.' : 'Registrado: nenhum dado de saúde da Polar será importado, e os já importados foram apagados.' });
      await load();
    } catch {
      setMessage({ ok: false, text: 'Não foi possível salvar agora. Verifique a conexão e tente de novo.' });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{doc.title}</Text>
      {doc.paragraphs.map((p, i) => <Text key={i} style={styles.hint}>{p}</Text>)}
      <Text style={styles.hint}>Versão {doc.version}. <Text style={styles.link} onPress={() => void Linking.openURL(privacyUrl)}>Política de Privacidade</Text></Text>
      {!perms.decided ? <Text style={[styles.hint, { color: PRColors.warning }]}>Você ainda não escolheu. Enquanto não escolher, nenhum dado de saúde da Polar é importado.</Text> : null}
      {perms.needsNewAuthorization ? <Text style={[styles.hint, { color: PRColors.warning }]}>O texto desta autorização mudou. Leia a nova versão e autorize novamente.</Text> : null}
      {doc.groups.map((group) => {
        const on = selected.includes(group.id);
        return (
          <Pressable key={group.id} style={styles.check} onPress={() => toggle(group.id)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
            <View style={[styles.box, on && styles.boxOn]}>{on ? <Text style={styles.tick}>✓</Text> : null}</View>
            <View style={{ flex: 1 }}>
              <Text style={styles.checkLabel}>{group.label}</Text>
              <Text style={styles.hint}>{group.description}</Text>
            </View>
          </Pressable>
        );
      })}
      {needsAck ? (
        <Pressable style={styles.check} onPress={() => setAck((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: ack }}>
          <View style={[styles.box, ack && styles.boxOn]}>{ack ? <Text style={styles.tick}>✓</Text> : null}</View>
          <Text style={[styles.checkLabel, { flex: 1 }]}>{doc.checkboxText}</Text>
        </Pressable>
      ) : null}
      <Pressable style={[styles.primary, !canSave && styles.disabled]} disabled={!canSave} onPress={() => void save()} accessibilityRole="button">
        {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryText}>{selected.length === 0 && perms.granted.length > 0 ? 'Retirar minha autorização' : doc.buttonLabel}</Text>}
      </Pressable>
      {perms.granted.length > 0 && !changed ? <Text style={[styles.hint, { color: PRColors.success }]}>Autorizado. Você pode mudar quando quiser.</Text> : null}
      {message ? <Text style={[styles.hint, { color: message.ok ? PRColors.success : PRColors.danger }]}>{message.text}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 8, borderWidth: 1, borderColor: '#dbe4ea', backgroundColor: '#ffffff', padding: 16, gap: 10, marginTop: 12 },
  title: { color: '#111827', fontSize: 17, fontWeight: '800' },
  hint: { color: '#475569', fontSize: 13, lineHeight: 18 },
  link: { color: PRColors.ocean, fontSize: 13, fontWeight: '700' },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 4 },
  checkLabel: { color: '#111827', fontSize: 13, fontWeight: '600' },
  box: { width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: PRColors.slate, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  boxOn: { backgroundColor: PRColors.ocean, borderColor: PRColors.ocean },
  tick: { color: '#ffffff', fontWeight: '900', fontSize: 14 },
  primary: { minHeight: 48, borderRadius: 8, backgroundColor: PRColors.ocean, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  primaryText: { color: '#ffffff', fontWeight: '800', fontSize: 15, textAlign: 'center' },
  disabled: { opacity: 0.5 },
});
