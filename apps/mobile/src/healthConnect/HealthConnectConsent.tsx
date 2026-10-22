import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { PRColors } from '../../theme/tokens';

// Autorizacoes do Health Connect (22/10/2026). A aluna escolhe, grupo a grupo, o que compartilha — NADA vem marcado; o Atlas (IA) e o historico anterior sao autorizacoes separadas.
// Perguntamos TODAS as categorias desde ja': o que o relogio, o aplicativo de origem ou o Android ainda nao disponibilizarem chega automaticamente quando passar a existir, sem nova pergunta.
// Quem grava e' o servidor (POST /health-connect/consent/*); depois de salvar, o app pede ao ANDROID so' as permissoes das categorias marcadas (ver onSaved).
interface Group { id: string; label: string; description: string; required: boolean; requires?: string[] }
interface Purpose { id: string; label: string; description: string; external: boolean; screen?: { version: string; title: string; paragraphs: string[]; checkboxText: string; buttonLabel: string } }
interface Doc { version: string; dateLabel: string; textHash: string; title: string; intro: string; groups: Group[]; optionalPurposes: Purpose[]; purposeHashes: Record<string, string>; locked: Record<string, boolean>; acknowledgementText: string; confirmButtonLabel: string; sections: Array<{ heading: string | null; paragraphs?: string[] }> }
interface Perms { connected: boolean; consent: { needsReview: boolean }; groups: Array<{ id: string; granted: boolean }>; purposes: Array<{ id: string; granted: boolean; needsNewAuthorization: boolean; available: boolean; grantedAt: string | null }> }

const privacyUrl = 'https://agenteselton-panzeri-run-api.hbljgk.easypanel.host/politica-privacidade';

export function HealthConnectConsent({ apiUrl, accessToken, onSaved }: { apiUrl: string; accessToken: string; onSaved: () => void | Promise<void> }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [perms, setPerms] = useState<Perms | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState(false);
  const [ack, setAck] = useState(false);
  const [atlasAck, setAtlasAck] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const mounted = useRef(true);
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` };

  const load = useCallback(async () => {
    try {
      const [d, p] = await Promise.all([fetch(`${apiUrl}/health-connect/consent`, { headers }), fetch(`${apiUrl}/health-connect/permissions`, { headers })]);
      if (!d.ok || !p.ok) throw new Error('load');
      const nextDoc = (await d.json()) as Doc;
      const nextPerms = (await p.json()) as Perms;
      if (!mounted.current) return;
      setDoc(nextDoc);
      setPerms(nextPerms);
      setSelected(new Set(nextPerms.groups.filter((g) => g.granted).map((g) => g.id)));
      setHistory(nextPerms.purposes.some((x) => x.id === 'history_backfill' && x.granted));
    } catch {
      if (mounted.current) setMessage({ ok: false, text: 'Não foi possível carregar suas autorizações agora. Tente de novo.' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, accessToken]);

  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, [load]);

  if (!doc || !perms) return message ? <Text style={[styles.hint, { color: PRColors.danger }]}>{message.text}</Text> : <ActivityIndicator />;

  const grantedGroups = new Set(perms.groups.filter((g) => g.granted).map((g) => g.id));
  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) {
      next.delete(id);
      for (const g of doc.groups) if ((g.requires ?? []).includes(id)) next.delete(g.id); // quem depende sai junto
    } else {
      next.add(id);
      for (const r of doc.groups.find((g) => g.id === id)?.requires ?? []) next.add(r); // dependencia entra junto
    }
    return next;
  });
  const grant = [...selected].filter((id) => !grantedGroups.has(id));
  const revoke = [...grantedGroups].filter((id) => !selected.has(id));
  const historyGranted = perms.purposes.some((p) => p.id === 'history_backfill' && p.granted);
  const changed = grant.length > 0 || revoke.length > 0 || history !== historyGranted;
  const needsAck = grant.length > 0 || (history && !historyGranted);

  async function post(path: string, body: unknown): Promise<boolean> {
    const response = await fetch(`${apiUrl}/health-connect/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    return response.ok;
  }

  async function save() {
    if (busy || !changed || (needsAck && !ack)) return;
    setBusy('save'); setMessage(null);
    try {
      let ok = true;
      if (grant.length > 0 || revoke.length > 0) ok = await post('consent/groups', { grant, revoke, acknowledged: ack, consentVersion: doc!.version, consentTextHash: doc!.textHash });
      if (ok && history !== historyGranted) {
        ok = await post('consent/purposes', history
          ? { grant: ['history_backfill'], acknowledged: ack, consentVersion: doc!.version, consentTextHash: doc!.textHash }
          : { revoke: ['history_backfill'] });
      }
      if (!ok) { setMessage({ ok: false, text: 'Não foi possível salvar suas autorizações. Tente de novo.' }); return; }
      setAck(false);
      setMessage({ ok: true, text: 'Autorizações salvas.' });
      await load();
      await onSaved();
    } catch {
      setMessage({ ok: false, text: 'Não foi possível salvar suas autorizações. Verifique a conexão e tente de novo.' });
    } finally {
      if (mounted.current) setBusy('');
    }
  }

  async function reconfirm() {
    setBusy('reconfirm'); setMessage(null);
    try {
      const ok = await post('consent/reconfirm', { acknowledged: true, consentVersion: doc!.version, consentTextHash: doc!.textHash });
      setMessage(ok ? { ok: true, text: 'Texto atual confirmado.' } : { ok: false, text: 'Não foi possível confirmar agora.' });
      await load();
      if (ok) await onSaved();
    } finally { if (mounted.current) setBusy(''); }
  }

  const atlas = doc.optionalPurposes.find((p) => p.id === 'ai_external');
  const atlasState = perms.purposes.find((p) => p.id === 'ai_external');
  async function atlasGrant() {
    if (!atlas?.screen || !atlasAck || busy) return;
    setBusy('atlas'); setMessage(null);
    try {
      const ok = await post('consent/purposes', { grant: ['ai_external'], acknowledged: true, consentVersion: atlas.screen.version, consentTextHash: doc!.purposeHashes.ai_external });
      setMessage(ok ? { ok: true, text: 'Análise com o Atlas autorizada.' } : { ok: false, text: 'Não foi possível autorizar agora.' });
      setAtlasAck(false);
      await load();
    } finally { if (mounted.current) setBusy(''); }
  }
  async function atlasRevoke() {
    setBusy('atlas'); setMessage(null);
    try {
      const ok = await post('consent/purposes', { revoke: ['ai_external'] });
      setMessage(ok ? { ok: true, text: 'Autorização do Atlas retirada.' } : { ok: false, text: 'Não foi possível retirar agora.' });
      await load();
    } finally { if (mounted.current) setBusy(''); }
  }

  // Exclui os dados que o Panzeri Run ja' importou do Health Connect (so' depois de retirar as autorizacoes).
  async function deleteImported() {
    setBusy('delete'); setMessage(null);
    try {
      const response = await fetch(`${apiUrl}/health-connect/data`, { method: 'DELETE', headers });
      setMessage(response.ok ? { ok: true, text: 'Os dados importados do Health Connect foram excluídos.' } : { ok: false, text: 'Não foi possível excluir agora. Retire antes todas as autorizações.' });
    } finally { if (mounted.current) setBusy(''); }
  }

  async function withdrawAll() {
    setBusy('withdraw'); setMessage(null);
    try {
      const response = await fetch(`${apiUrl}/health-connect/consent`, { method: 'DELETE', headers });
      setMessage(response.ok ? { ok: true, text: 'Todas as autorizações foram retiradas. O que já foi importado continua no histórico.' } : { ok: false, text: 'Não foi possível retirar agora.' });
      await load();
      await onSaved();
    } finally { if (mounted.current) setBusy(''); }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{doc.title}</Text>
      <Text style={styles.hint}>{doc.intro}</Text>
      {doc.sections.map((section, index) => (
        <View key={index} style={{ gap: 4 }}>
          {section.heading ? <Text style={styles.subtitle}>{section.heading}</Text> : null}
          {(section.paragraphs ?? []).map((p, i) => <Text key={i} style={styles.hint}>{p}</Text>)}
        </View>
      ))}
      <Text style={styles.hint}>Versão {doc.version} de {doc.dateLabel}. <Text style={styles.link} onPress={() => void Linking.openURL(privacyUrl)}>Política de Privacidade</Text></Text>
      {perms.connected && perms.consent.needsReview ? (
        <View style={styles.warnBox}>
          <Text style={styles.warnText}>O texto das autorizações mudou. O compartilhamento fica suspenso até você ler a versão atual e confirmar.</Text>
          <Pressable style={styles.secondary} onPress={reconfirm} disabled={busy !== ''} accessibilityRole="button"><Text style={styles.secondaryText}>Confirmar o texto atual</Text></Pressable>
        </View>
      ) : null}

      <View style={styles.row}>
        <Text style={styles.subtitle}>O que você quer compartilhar</Text>
        <Pressable onPress={() => setSelected(new Set(doc.groups.map((g) => g.id)))} accessibilityRole="button"><Text style={styles.link}>Marcar todos</Text></Pressable>
      </View>
      {doc.groups.map((group) => (
        <Pressable key={group.id} style={styles.check} onPress={() => toggle(group.id)} accessibilityRole="checkbox" accessibilityState={{ checked: selected.has(group.id) }}>
          <View style={[styles.box, selected.has(group.id) && styles.boxOn]}>{selected.has(group.id) ? <Text style={styles.tick}>✓</Text> : null}</View>
          <View style={{ flex: 1 }}>
            <Text style={styles.checkLabel}>{group.label}</Text>
            <Text style={styles.hint}>{group.description}</Text>
          </View>
        </Pressable>
      ))}
      {doc.optionalPurposes.filter((p) => p.id === 'history_backfill').map((p) => (
        <Pressable key={p.id} style={styles.check} onPress={() => setHistory((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: history }}>
          <View style={[styles.box, history && styles.boxOn]}>{history ? <Text style={styles.tick}>✓</Text> : null}</View>
          <View style={{ flex: 1 }}>
            <Text style={styles.checkLabel}>{p.label}</Text>
            <Text style={styles.hint}>{p.description}</Text>
          </View>
        </Pressable>
      ))}
      {needsAck ? (
        <Pressable style={styles.check} onPress={() => setAck((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: ack }}>
          <View style={[styles.box, ack && styles.boxOn]}>{ack ? <Text style={styles.tick}>✓</Text> : null}</View>
          <Text style={[styles.checkLabel, { flex: 1, fontWeight: '600' }]}>{doc.acknowledgementText}</Text>
        </Pressable>
      ) : null}
      <Pressable style={[styles.primary, (!changed || (needsAck && !ack) || busy !== '') && styles.disabled]} disabled={!changed || (needsAck && !ack) || busy !== ''} onPress={save} accessibilityRole="button">
        {busy === 'save' ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryText}>{doc.confirmButtonLabel}</Text>}
      </Pressable>
      {message ? <Text style={[styles.hint, { color: message.ok ? PRColors.success : PRColors.danger }]}>{message.text}</Text> : null}

      {atlas?.screen ? (
        <View style={styles.inner}>
          <Text style={styles.subtitle}>{atlas.screen.title}</Text>
          {atlas.screen.paragraphs.map((p, i) => <Text key={i} style={styles.hint}>{p}</Text>)}
          {atlasState?.needsNewAuthorization ? <Text style={[styles.hint, { color: PRColors.warning }]}>O texto desta autorização mudou. Leia a nova versão e autorize novamente.</Text> : null}
          {atlasState?.granted ? (
            <>
              <Text style={[styles.hint, { color: PRColors.success }]}>Análise com o Atlas autorizada. Você pode retirar quando quiser.</Text>
              <Pressable style={styles.secondary} onPress={atlasRevoke} disabled={busy !== ''} accessibilityRole="button"><Text style={styles.secondaryText}>Retirar autorização do Atlas</Text></Pressable>
            </>
          ) : (
            <>
              {doc.locked.ai_external ? <Text style={[styles.hint, { color: PRColors.warning }]}>Esta autorização ainda não está disponível. Você será avisado quando puder concedê-la; enquanto isso, nada é enviado.</Text> : null}
              <Pressable style={styles.check} onPress={() => !doc.locked.ai_external && setAtlasAck((v) => !v)} disabled={doc.locked.ai_external} accessibilityRole="checkbox" accessibilityState={{ checked: atlasAck }}>
                <View style={[styles.box, atlasAck && styles.boxOn, doc.locked.ai_external && styles.disabled]}>{atlasAck ? <Text style={styles.tick}>✓</Text> : null}</View>
                <Text style={[styles.checkLabel, { flex: 1, fontWeight: '600' }]}>{atlas.screen.checkboxText}</Text>
              </Pressable>
              <Pressable style={[styles.primary, (!atlasAck || doc.locked.ai_external || busy !== '' || !perms.connected) && styles.disabled]} disabled={!atlasAck || doc.locked.ai_external || busy !== '' || !perms.connected} onPress={atlasGrant} accessibilityRole="button">
                <Text style={styles.primaryText}>{atlas.screen.buttonLabel}</Text>
              </Pressable>
              {!perms.connected ? <Text style={styles.hint}>Salve primeiro ao menos um grupo de dados acima.</Text> : null}
            </>
          )}
        </View>
      ) : null}

      {!perms.connected ? (
        <Pressable style={styles.secondary} onPress={deleteImported} disabled={busy !== ''} accessibilityRole="button"><Text style={[styles.secondaryText, { color: PRColors.danger }]}>Excluir os dados já importados</Text></Pressable>
      ) : null}
      {perms.connected ? (
        <Pressable style={styles.secondary} onPress={withdrawAll} disabled={busy !== ''} accessibilityRole="button"><Text style={[styles.secondaryText, { color: PRColors.danger }]}>Retirar todas as autorizações</Text></Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 8, borderWidth: 1, borderColor: '#dbe4ea', backgroundColor: '#ffffff', padding: 16, gap: 10 },
  inner: { borderTopWidth: 1, borderTopColor: '#dbe4ea', paddingTop: 12, gap: 8 },
  title: { color: '#111827', fontSize: 17, fontWeight: '800' },
  subtitle: { color: '#111827', fontSize: 15, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  hint: { color: '#475569', fontSize: 13, lineHeight: 18 },
  link: { color: PRColors.ocean, fontSize: 13, fontWeight: '700' },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 4 },
  checkLabel: { color: '#111827', fontSize: 14, fontWeight: '700' },
  box: { width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: PRColors.slate, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  boxOn: { backgroundColor: PRColors.ocean, borderColor: PRColors.ocean },
  tick: { color: '#ffffff', fontWeight: '900', fontSize: 14 },
  primary: { minHeight: 48, borderRadius: 8, backgroundColor: PRColors.ocean, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  primaryText: { color: '#ffffff', fontWeight: '800', fontSize: 15, textAlign: 'center' },
  secondary: { minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: PRColors.ocean, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  secondaryText: { color: PRColors.ocean, fontWeight: '800', fontSize: 14, textAlign: 'center' },
  disabled: { opacity: 0.5 },
  warnBox: { borderRadius: 8, backgroundColor: '#fef3c7', padding: 10, gap: 8 },
  warnText: { color: '#92400e', fontSize: 13, lineHeight: 18 },
});
