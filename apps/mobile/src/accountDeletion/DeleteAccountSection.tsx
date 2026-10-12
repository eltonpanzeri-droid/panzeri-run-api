import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { PRColors } from '../../theme/tokens';
import {
  buildBody, canSubmit, ChargesChoice, CONFIRM_PHRASE, DeletionInfo, describeFailure, EXTERNAL_CHARGES_WARNING, IRREVERSIBLE_WARNING, needsChargesChoice,
  chargesAckText, pendingChargesLines, storeCancelGuides, subscriptionNotice, WILL_BE_DELETED, WILL_BE_KEPT,
} from './logic';

const DANGER = '#b91c1c';

// "Excluir minha conta" dentro do aplicativo (exigencia da Apple e direito do titular). Fica em Privacidade e dados. A exclusao e' definitiva: pede a
// senha e a frase EXCLUIR CONTA. NAO bloqueia por assinatura: avisa que a exclusao nao cancela cobranca externa e oferece o caminho para cancelar.
export function DeleteAccountSection({ accessToken, apiUrl, onDeleted, onOpenBilling }: { accessToken: string; apiUrl: string; onDeleted: () => void; onOpenBilling: () => void }) {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<DeletionInfo | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [choice, setChoice] = useState<ChargesChoice | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [password, setPassword] = useState('');
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const submitting = useRef(false); // trava o duplo toque antes mesmo do estado atualizar

  const headers = { Authorization: `Bearer ${accessToken}` };

  const loadInfo = useCallback(async () => {
    setLoadFailed(false);
    try {
      const response = await fetch(`${apiUrl}/me/account/deletion-info`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error('status');
      setInfo((await response.json()) as DeletionInfo);
    } catch {
      setLoadFailed(true);
    }
  }, [accessToken, apiUrl]);

  useEffect(() => { if (open && !info) void loadInfo(); }, [open, info, loadInfo]);

  async function submit() {
    if (submitting.current || !canSubmit({ info, choice, acknowledged, password, phrase, busy })) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/me/account/delete`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody({ info, choice, acknowledged, password, phrase })),
      });
      if (response.ok) {
        setDone(true);
        setTimeout(onDeleted, 1800);
        return;
      }
      const failure = describeFailure(response.status, await response.json().catch(() => null));
      setError(failure.message);
      if (failure.refetchInfo) await loadInfo();
    } catch {
      setError('Sem conexão. Nada foi excluído; tente novamente quando estiver online.');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  if (done) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Conta excluída</Text>
        <Text style={styles.hint}>Sua conta e seus dados foram excluídos. Você será desconectado agora.</Text>
      </View>
    );
  }

  const notice = info ? subscriptionNotice(info) : null;
  const choiceRequired = needsChargesChoice(info);
  const ready = canSubmit({ info, choice, acknowledged, password, phrase, busy });

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Excluir minha conta</Text>
      <Text style={styles.hint}>Você pode excluir sua conta e seus dados aqui no aplicativo, a qualquer momento.</Text>
      {!open ? (
        <Pressable style={styles.outlineDanger} onPress={() => setOpen(true)} accessibilityRole="button">
          <Text style={styles.outlineDangerText}>Quero excluir minha conta</Text>
        </Pressable>
      ) : (
        <View style={{ gap: 12 }}>
          <Text style={styles.warning}>{IRREVERSIBLE_WARNING}</Text>
          <Text style={styles.sub}>O que será excluído</Text>
          {WILL_BE_DELETED.map((line) => <Text key={line} style={styles.hint}>• {line}</Text>)}
          <Text style={styles.sub}>O que permanece</Text>
          {WILL_BE_KEPT.map((line) => <Text key={line} style={styles.hint}>• {line}</Text>)}

          {!info && !loadFailed ? <ActivityIndicator /> : null}
          {loadFailed ? (
            <View style={{ gap: 8 }}>
              <Text style={styles.warning}>Não conseguimos verificar sua assinatura agora. Tente novamente para continuar.</Text>
              <Pressable style={styles.outline} onPress={() => void loadInfo()} accessibilityRole="button"><Text style={styles.outlineText}>Tentar novamente</Text></Pressable>
            </View>
          ) : null}

          {info && notice ? (
            <View style={styles.alertBox}>
              <Text style={styles.alertTitle}>Sua assinatura</Text>
              <Text style={styles.alertText}>{notice}</Text>
              <Text style={styles.alertText}>{EXTERNAL_CHARGES_WARNING}</Text>
              {pendingChargesLines(info).map((line) => <Text key={line} style={[styles.alertText, { fontWeight: '700' }]}>{line}</Text>)}
              {info.subscription.channel === 'asaas' ? (
                <Pressable style={styles.outline} onPress={onOpenBilling} accessibilityRole="button"><Text style={styles.outlineText}>Ver e cancelar minha assinatura antes</Text></Pressable>
              ) : null}
              {info.subscription.channel === 'store' ? (
                <View style={{ gap: 8 }}>
                  {storeCancelGuides(Platform.OS).map((guide) => (
                    <View key={guide.store} style={{ gap: 4 }}>
                      <Text style={styles.alertText}>Para cancelar pela {guide.store}:</Text>
                      {guide.steps.map((step, index) => <Text key={step} style={styles.alertText}>{index + 1}. {step}</Text>)}
                      <Pressable onPress={() => { void Linking.openURL(guide.url).catch(() => undefined); }} accessibilityRole="link"><Text style={styles.link}>{guide.linkLabel}</Text></Pressable>
                    </View>
                  ))}
                </View>
              ) : null}
              {choiceRequired ? (
                <View style={{ gap: 8 }}>
                  <Text style={styles.sub}>O que fazer com a assinatura ao excluir?</Text>
                  {info.subscription.channel === 'asaas' ? (
                    <Choice selected={choice === 'cancel'} onPress={() => { setChoice('cancel'); setAcknowledged(false); }} label="Cancelar minha assinatura e excluir a conta" />
                  ) : null}
                  <Choice
                    selected={choice === 'keep'}
                    onPress={() => setChoice('keep')}
                    label={info.subscription.channel === 'store' ? 'Estou ciente: vou cancelar pela loja e quero excluir a conta' : 'Excluir a conta sem cancelar. Estou ciente de que a cobrança pode continuar'}
                  />
                  {choice === 'keep' ? (
                    <Pressable style={styles.ackBox} onPress={() => setAcknowledged((value) => !value)} accessibilityRole="checkbox" accessibilityState={{ checked: acknowledged }}>
                      <View style={[styles.checkbox, acknowledged && styles.checkboxChecked]}>{acknowledged ? <Text style={styles.checkMark}>✓</Text> : null}</View>
                      <Text style={[styles.alertText, { flex: 1, fontWeight: '700' }]}>{chargesAckText(info.subscription)}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}

          {info ? (
            <View style={{ gap: 8 }}>
              <Text style={styles.sub}>Confirme com a sua senha</Text>
              <TextInput style={styles.input} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="Senha atual" value={password} onChangeText={setPassword} editable={!busy} />
              <Text style={styles.sub}>Digite {CONFIRM_PHRASE} para confirmar</Text>
              <TextInput style={styles.input} autoCapitalize="characters" autoCorrect={false} placeholder={CONFIRM_PHRASE} value={phrase} onChangeText={setPhrase} editable={!busy} />
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable style={[styles.danger, !ready && styles.disabled]} disabled={!ready} onPress={submit} accessibilityRole="button" accessibilityState={{ disabled: !ready }}>
            <Text style={styles.dangerText}>{busy ? 'Excluindo...' : 'Excluir definitivamente'}</Text>
          </Pressable>
          <Pressable onPress={() => { setOpen(false); setPassword(''); setPhrase(''); setChoice(null); setAcknowledged(false); setError(null); }} disabled={busy} accessibilityRole="button">
            <Text style={styles.link}>Cancelar e manter minha conta</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function Choice({ selected, onPress, label }: { selected: boolean; onPress: () => void; label: string }) {
  return (
    <Pressable style={[styles.choice, selected && styles.choiceSelected]} onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }}>
      <View style={[styles.radio, selected && styles.radioSelected]} />
      <Text style={[styles.hint, { flex: 1, color: '#111827' }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 8, borderWidth: 1, borderColor: '#dbe4ea', backgroundColor: '#ffffff', padding: 16, gap: 10 },
  title: { color: '#111827', fontSize: 17, fontWeight: '800' },
  sub: { color: '#111827', fontSize: 14, fontWeight: '800' },
  hint: { color: '#475569', fontSize: 13, lineHeight: 18 },
  warning: { color: DANGER, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  error: { color: DANGER, fontSize: 13, lineHeight: 18 },
  link: { color: PRColors.ocean, fontSize: 13, fontWeight: '700' },
  alertBox: { borderRadius: 8, borderWidth: 1, borderColor: '#f59e0b', backgroundColor: '#fffbeb', padding: 12, gap: 8 },
  alertTitle: { color: '#92400e', fontSize: 14, fontWeight: '800' },
  alertText: { color: '#78350f', fontSize: 13, lineHeight: 18 },
  input: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: '#cbd5e1', paddingHorizontal: 12, fontSize: 15, color: '#111827', backgroundColor: '#ffffff' },
  danger: { minHeight: 48, borderRadius: 8, backgroundColor: DANGER, alignItems: 'center', justifyContent: 'center' },
  dangerText: { color: '#ffffff', fontWeight: '800', fontSize: 15 },
  disabled: { opacity: 0.4 },
  outlineDanger: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: DANGER, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  outlineDangerText: { color: DANGER, fontWeight: '800', fontSize: 15 },
  outline: { minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: PRColors.ocean, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  outlineText: { color: PRColors.ocean, fontWeight: '800', fontSize: 14 },
  ackBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 8, borderWidth: 2, borderColor: DANGER, backgroundColor: '#fef2f2', padding: 12 },
  checkbox: { width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: DANGER, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff' },
  checkboxChecked: { backgroundColor: DANGER },
  checkMark: { color: '#ffffff', fontWeight: '800', fontSize: 14, lineHeight: 16 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 8, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#ffffff', padding: 12 },
  choiceSelected: { borderColor: PRColors.ocean, backgroundColor: '#f0f9ff' },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#94a3b8' },
  radioSelected: { borderColor: PRColors.ocean, backgroundColor: PRColors.ocean },
});
