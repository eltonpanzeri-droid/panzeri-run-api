import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../PtText';
import { PRColors } from '../../theme/tokens';

// Autorizacao do ATLAS para quem JA' estava conectada em Polar ou Wahoo (22/10/2026). Os textos, a versao e o hash vem do servidor (GET /legacy-consent/:provider) e voltam em cada
// resposta, para o servidor registrar o que a aluna de fato viu. Enquanto ela nao responder, NADA muda (regra de nao-perda); responder "nao autorizo" tambem vale e nunca desconecta o provedor.
// So' aparece para quem esta conectada ao provedor.
interface Screen { version: string; title: string; paragraphs: string[]; checkboxText: string; buttonLabel: string }
interface Doc { provider: string; textHash: string; purposeHashes: Record<string, string>; optionalPurposes: Array<{ id: string; screen?: Screen }> }
interface Permissions { connected: boolean; decided: boolean; atlas: { granted: boolean; needsNewAuthorization: boolean; grantedAt: string | null; declined: boolean } }

const privacyUrl = 'https://agenteselton-panzeri-run-api.hbljgk.easypanel.host/politica-privacidade';

export function LegacyAtlasConsentCard({ provider, apiUrl, accessToken }: { provider: 'polar' | 'wahoo'; apiUrl: string; accessToken: string }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [perms, setPerms] = useState<Permissions | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const mounted = useRef(true);
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` };

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/legacy-consent/${provider}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) return;
      const body = (await response.json()) as { document: Doc; permissions: Permissions };
      if (!mounted.current) return;
      setDoc(body.document);
      setPerms(body.permissions);
    } catch { /* sem o pedido na tela nada muda: o comportamento anterior continua */ }
  }, [apiUrl, accessToken, provider]);

  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, [load]);

  const screen = doc?.optionalPurposes.find((p) => p.id === 'ai_external')?.screen;
  if (!doc || !perms || !screen || !perms.connected) return null;

  async function decide(grant: boolean) {
    if (busy || (grant && !ack)) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`${apiUrl}/legacy-consent/${provider}/atlas`, {
        method: 'POST', headers,
        body: JSON.stringify(grant ? { grant: true, acknowledged: true, consentVersion: screen!.version, consentTextHash: doc!.purposeHashes.ai_external } : { grant: false }),
      });
      if (!response.ok) { setMessage({ ok: false, text: 'Não foi possível salvar agora. Tente de novo.' }); return; }
      setAck(false);
      setMessage({ ok: true, text: grant ? 'Análise com o Atlas autorizada.' : 'Registrado: o Atlas não usará suas atividades deste provedor.' });
      await load();
    } catch {
      setMessage({ ok: false, text: 'Não foi possível salvar agora. Verifique a conexão e tente de novo.' });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const granted = perms.atlas.granted;
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{screen.title}</Text>
      {screen.paragraphs.map((p, i) => <Text key={i} style={styles.hint}>{p}</Text>)}
      <Text style={styles.hint}>Versão {screen.version}. <Text style={styles.link} onPress={() => void Linking.openURL(privacyUrl)}>Política de Privacidade</Text></Text>
      {!perms.decided ? <Text style={[styles.hint, { color: PRColors.warning }]}>Você ainda não respondeu. Enquanto não responder, tudo continua como está.</Text> : null}
      {perms.atlas.needsNewAuthorization ? <Text style={[styles.hint, { color: PRColors.warning }]}>O texto desta autorização mudou. Leia a nova versão e autorize novamente.</Text> : null}
      {granted ? (
        <>
          <Text style={[styles.hint, { color: PRColors.success }]}>Autorizada. Você pode retirar quando quiser.</Text>
          <Pressable style={[styles.secondary, busy && styles.disabled]} disabled={busy} onPress={() => void decide(false)} accessibilityRole="button"><Text style={styles.secondaryText}>Retirar autorização do Atlas</Text></Pressable>
        </>
      ) : (
        <>
          {perms.atlas.declined ? <Text style={styles.hint}>Você escolheu não autorizar. Pode mudar quando quiser.</Text> : null}
          <Pressable style={styles.check} onPress={() => setAck((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: ack }}>
            <View style={[styles.box, ack && styles.boxOn]}>{ack ? <Text style={styles.tick}>✓</Text> : null}</View>
            <Text style={[styles.checkLabel, { flex: 1 }]}>{screen.checkboxText}</Text>
          </Pressable>
          <Pressable style={[styles.primary, (!ack || busy) && styles.disabled]} disabled={!ack || busy} onPress={() => void decide(true)} accessibilityRole="button">
            {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryText}>{screen.buttonLabel}</Text>}
          </Pressable>
          {!perms.atlas.declined ? (
            <Pressable style={[styles.secondary, busy && styles.disabled]} disabled={busy} onPress={() => void decide(false)} accessibilityRole="button"><Text style={styles.secondaryText}>Não autorizo</Text></Pressable>
          ) : null}
        </>
      )}
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
  secondary: { minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: PRColors.ocean, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  secondaryText: { color: PRColors.ocean, fontWeight: '800', fontSize: 14, textAlign: 'center' },
  disabled: { opacity: 0.5 },
});
