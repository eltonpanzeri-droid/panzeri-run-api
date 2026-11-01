import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../PtText';
import { PRColors } from '../../theme/tokens';

// Polar: saude, recuperacao E Atlas num cartao so' (01/11/2026, ordem de Elton: "tudo no mesmo cartao, sem pedir autorizacao duas vezes").
// 1) Saude e recuperacao (23/10/2026): quem JA' conectou a Polar escolhe aqui, sem reconectar, quais grupos de dados de saude compartilhar (sono, recuperacao noturna/HRV, atividade diaria). Texto, versao e hash
//    vem do servidor (GET /polar/health-consent) e voltam na resposta. Enquanto ela nao escolher, NADA de saude e' importado. Retirar um grupo apaga os dados ja' importados dele.
// 2) Atlas (a mesma autorizacao que cobre os treinos da Polar; texto, versao e hash vem de GET /legacy-consent/polar): uma caixa so' cobre os treinos E os grupos de saude marcados acima. Sem ela, nada da Polar
//    vai a IA. Os dois registros continuam separados no servidor, mas a aluna ve e salva tudo de uma vez ("Salvar minha escolha"). Se o texto do Atlas nao carregar, o cartao funciona so' com a saude.
// So' aparece para quem esta conectada a Polar.
interface Group { id: string; label: string; description: string }
interface Doc { version: string; title: string; paragraphs: string[]; groups: Group[]; checkboxText: string; buttonLabel: string; textHash: string }
interface Permissions { connected: boolean; decided: boolean; granted: string[]; needsNewAuthorization: boolean; grantedAt: string | null }
interface AtlasScreen { version: string; title: string; paragraphs: string[]; checkboxText: string; buttonLabel: string }
interface AtlasDoc { purposeHashes: Record<string, string>; optionalPurposes: Array<{ id: string; screen?: AtlasScreen }> }
interface AtlasPermissions { connected: boolean; decided: boolean; atlas: { granted: boolean; needsNewAuthorization: boolean; grantedAt: string | null; declined: boolean } }

const privacyUrl = 'https://agenteselton-panzeri-run-api.hbljgk.easypanel.host/politica-privacidade';

export function PolarHealthConsentCard({ apiUrl, accessToken }: { apiUrl: string; accessToken: string }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [perms, setPerms] = useState<Permissions | null>(null);
  const [atlasDoc, setAtlasDoc] = useState<AtlasDoc | null>(null);
  const [atlasPerms, setAtlasPerms] = useState<AtlasPermissions | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [atlasOn, setAtlasOn] = useState(false);
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
    try {
      const response = await fetch(`${apiUrl}/legacy-consent/polar`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) return;
      const body = (await response.json()) as { document: AtlasDoc; permissions: AtlasPermissions };
      if (!mounted.current) return;
      setAtlasDoc(body.document);
      setAtlasPerms(body.permissions);
      setAtlasOn(body.permissions.atlas.granted);
    } catch { /* sem o texto do Atlas o cartao segue so' com a saude; nada da Polar vai a IA sem a autorizacao dela */ }
  }, [apiUrl, accessToken]);

  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, [load]);

  if (!doc || !perms || !perms.connected) return null;

  const atlasScreen = atlasDoc?.optionalPurposes.find((p) => p.id === 'ai_external')?.screen;
  const showAtlas = Boolean(atlasScreen && atlasPerms && atlasPerms.connected);
  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  const changed = selected.length !== perms.granted.length || selected.some((id) => !perms.granted.includes(id));
  const needsAck = selected.length > 0 && (selected.some((id) => !perms.granted.includes(id)) || perms.needsNewAuthorization);
  const healthDirty = (changed || perms.needsNewAuthorization) && (selected.length > 0 || perms.granted.length > 0);
  // Atlas: so' ha' o que salvar quando a escolha mudou em relacao ao que vale hoje (autorizar, ou retirar uma autorizacao vigente). Marcar a caixa e' o aceite expresso do texto vigente.
  const atlasDirty = showAtlas && atlasPerms !== null && atlasOn !== atlasPerms.atlas.granted;
  const canSave = !busy && (healthDirty || atlasDirty) && (!healthDirty || !needsAck || ack);
  const onlyWithdrawing = selected.length === 0 && perms.granted.length > 0 && !atlasOn;

  async function save() {
    if (!canSave) return;
    setBusy(true); setMessage(null);
    let healthSaved = false;
    try {
      if (healthDirty) {
        const response = await fetch(`${apiUrl}/polar/health-consent`, {
          method: 'POST', headers,
          body: JSON.stringify(selected.length > 0 ? { categories: selected, acknowledged: true, consentVersion: doc!.version, consentTextHash: doc!.textHash } : { categories: [] }),
        });
        if (!response.ok) { setMessage({ ok: false, text: 'Não foi possível salvar agora. Tente de novo.' }); return; }
        healthSaved = true;
      }
      if (atlasDirty && atlasScreen && atlasDoc) {
        const response = await fetch(`${apiUrl}/legacy-consent/polar/atlas`, {
          method: 'POST', headers,
          body: JSON.stringify(atlasOn ? { grant: true, acknowledged: true, consentVersion: atlasScreen.version, consentTextHash: atlasDoc.purposeHashes.ai_external } : { grant: false }),
        });
        if (!response.ok) {
          setMessage({ ok: false, text: healthSaved ? 'Seus dados de saúde foram salvos, mas não consegui salvar a escolha do Atlas. Tente salvar de novo.' : 'Não foi possível salvar agora. Tente de novo.' });
          await load();
          return;
        }
      }
      setAck(false);
      setMessage({ ok: true, text: 'Escolha salva.' + (healthDirty && selected.length > 0 ? ' Os dados de saúde começam a chegar em alguns minutos.' : '') + (healthDirty && selected.length === 0 ? ' Nenhum dado de saúde da Polar será importado, e os já importados foram apagados.' : '') });
      await load();
    } catch {
      setMessage({ ok: false, text: 'Não foi possível salvar agora. Verifique a conexão e tente de novo.' });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const check = (on: boolean, onPress: () => void, label: string, hint?: string) => (
    <Pressable style={styles.check} onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
      <View style={[styles.box, on && styles.boxOn]}>{on ? <Text style={styles.tick}>✓</Text> : null}</View>
      <View style={{ flex: 1 }}>
        <Text style={hint ? styles.checkLabel : [styles.checkLabel, { flex: 1 }]}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
    </Pressable>
  );

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{doc.title}</Text>
      {doc.paragraphs.map((p, i) => <Text key={i} style={styles.hint}>{p}</Text>)}
      <Text style={styles.hint}>Versão {doc.version}. <Text style={styles.link} onPress={() => void Linking.openURL(privacyUrl)}>Política de Privacidade</Text></Text>
      {!perms.decided ? <Text style={[styles.hint, { color: PRColors.warning }]}>Você ainda não escolheu. Enquanto não escolher, nenhum dado de saúde da Polar é importado.</Text> : null}
      {perms.needsNewAuthorization ? <Text style={[styles.hint, { color: PRColors.warning }]}>O texto desta autorização mudou. Leia a nova versão e autorize novamente.</Text> : null}
      {doc.groups.map((group) => <React.Fragment key={group.id}>{check(selected.includes(group.id), () => toggle(group.id), group.label, group.description)}</React.Fragment>)}
      {needsAck ? check(ack, () => setAck((v) => !v), doc.checkboxText) : null}

      {showAtlas && atlasScreen && atlasPerms ? (
        <View style={styles.atlas}>
          <Text style={styles.title}>{atlasScreen.title}</Text>
          {atlasScreen.paragraphs.map((p, i) => <Text key={i} style={styles.hint}>{p}</Text>)}
          <Text style={styles.hint}>Versão {atlasScreen.version}. <Text style={styles.link} onPress={() => void Linking.openURL(privacyUrl)}>Política de Privacidade</Text></Text>
          {atlasPerms.atlas.needsNewAuthorization ? <Text style={[styles.hint, { color: PRColors.warning }]}>O texto do Atlas mudou. Leia a nova versão e autorize novamente.</Text> : null}
          {!atlasPerms.decided ? <Text style={[styles.hint, { color: PRColors.warning }]}>Você ainda não respondeu sobre o Atlas. Enquanto não responder, tudo continua como está.</Text> : null}
          {check(atlasOn, () => setAtlasOn((v) => !v), atlasScreen.checkboxText)}
        </View>
      ) : null}

      <Pressable style={[styles.primary, !canSave && styles.disabled]} disabled={!canSave} onPress={() => void save()} accessibilityRole="button">
        {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryText}>{onlyWithdrawing ? 'Retirar minha autorização' : doc.buttonLabel}</Text>}
      </Pressable>
      {perms.granted.length > 0 && !changed && !atlasDirty ? <Text style={[styles.hint, { color: PRColors.success }]}>Autorizado. Você pode mudar quando quiser.</Text> : null}
      {showAtlas && atlasPerms?.atlas.granted && !atlasDirty ? <Text style={[styles.hint, { color: PRColors.success }]}>Atlas autorizado. Desmarque a caixa acima e salve para retirar.</Text> : null}
      {message ? <Text style={[styles.hint, { color: message.ok ? PRColors.success : PRColors.danger }]}>{message.text}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 8, borderWidth: 1, borderColor: '#dbe4ea', backgroundColor: '#ffffff', padding: 16, gap: 10, marginTop: 12 },
  atlas: { gap: 10, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 14, marginTop: 4 },
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
