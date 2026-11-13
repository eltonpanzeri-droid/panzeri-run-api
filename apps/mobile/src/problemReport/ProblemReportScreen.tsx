import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Text } from '../PtText';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { PRColors } from '../../theme/tokens';
import {
  PROBLEM_IMAGE_ATTEMPTS, PROBLEM_IMAGE_MAX_BYTES, PROBLEM_MAX_IMAGES, PROBLEM_MESSAGE_MAX, PROBLEM_TYPE_OPTIONS, STATUS_LABELS,
  base64Bytes, buildDeviceInfo, canSubmitReport, submitFeedbackText, type ProblemType,
} from './problemReportLogic';

// "Relatar problema" (13/11/2026): a aluna escolhe o tipo, descreve e (opcional) anexa ate 3 imagens. O servidor avisa o treinador no Telegram e guarda no painel.
// Os dados do aparelho (sistema, modelo, versao do app) seguem junto, sem identificadores do aparelho.
interface MyReport { id: string; typeLabel: string; message: string; status: string; createdAt: string }

export function ProblemReportScreen({ apiUrl, accessToken }: { apiUrl: string; accessToken: string }) {
  const [type, setType] = useState<ProblemType | null>(null);
  const [message, setMessage] = useState('');
  const [images, setImages] = useState<Array<{ uri: string; base64: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [mine, setMine] = useState<MyReport[] | null>(null);
  const sending = useRef(false);

  const loadMine = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/me/problem-reports`, { headers: { Authorization: `Bearer ${accessToken}` } });
      setMine(response.ok ? ((await response.json()) as MyReport[]) : []);
    } catch {
      setMine([]);
    }
  }, [apiUrl, accessToken]);
  useEffect(() => { void loadMine(); }, [loadMine]);

  async function addImage() {
    if (images.length >= PROBLEM_MAX_IMAGES || busy) return;
    setResult(null);
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1, exif: false });
      if (picked.canceled || !picked.assets?.[0]) return;
      setBusy(true);
      const asset = picked.assets[0];
      let base64: string | null = null;
      for (const attempt of PROBLEM_IMAGE_ATTEMPTS) {
        const resize = asset.width && asset.width > attempt.width ? [{ resize: { width: attempt.width } }] : [];
        const out = await ImageManipulator.manipulateAsync(asset.uri, resize, { compress: attempt.compress, format: ImageManipulator.SaveFormat.JPEG, base64: true });
        if (out.base64 && base64Bytes(out.base64) <= PROBLEM_IMAGE_MAX_BYTES) { base64 = out.base64; break; }
      }
      if (!base64) { setResult({ ok: false, text: 'Não consegui reduzir esta imagem. Escolha outra.' }); return; }
      setImages((current) => [...current, { uri: `data:image/jpeg;base64,${base64}`, base64: base64 as string }]);
    } catch {
      setResult({ ok: false, text: 'Não foi possível abrir a imagem agora.' });
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (sending.current || !canSubmitReport(type, message, busy)) return;
    sending.current = true; // evita envio duplo por toque repetido
    setBusy(true);
    setResult(null);
    try {
      const device = buildDeviceInfo({ platform: Platform.OS, osVersion: Platform.OS === 'web' ? null : Device.osVersion ?? Platform.Version, deviceModel: Platform.OS === 'web' ? null : Device.modelName, appVersion: Constants.expoConfig?.version });
      const response = await fetch(`${apiUrl}/me/problem-reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ type, message: message.trim(), expectedImages: images.length, ...device }),
      });
      if (!response.ok) {
        setResult({ ok: false, text: response.status === 403 ? 'Você já enviou muitos relatos hoje. Tente de novo amanhã.' : 'Não foi possível enviar agora. Seu texto continua aqui; tente de novo.' });
        return;
      }
      const created = (await response.json()) as { id: string };
      let sent = 0;
      for (const image of images) {
        try {
          const upload = await fetch(`${apiUrl}/me/problem-reports/${created.id}/images`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ imageBase64: image.base64 }) });
          if (upload.ok) sent += 1;
        } catch { /* a imagem que falhar nao derruba o relato, que ja' foi enviado */ }
      }
      setResult({ ok: true, text: submitFeedbackText(sent, images.length) });
      setType(null); setMessage(''); setImages([]);
      void loadMine();
    } catch {
      setResult({ ok: false, text: 'Não foi possível enviar agora. Seu texto continua aqui; tente de novo.' });
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  const ready = canSubmitReport(type, message, busy);
  return (
    <View style={{ gap: 16 }}>
      <View style={styles.card}>
        <Text style={styles.label}>Fale com a gente</Text>
        <Text style={styles.title}>Relatar problema</Text>
        <Text style={styles.hint}>Conte o que aconteceu. O Elton recebe o seu relato e acompanha. Enviamos junto o modelo do aparelho, o sistema e a versão do Panzeri Run, para ajudar a achar o problema.</Text>

        <Text style={styles.fieldLabel}>Tipo</Text>
        {PROBLEM_TYPE_OPTIONS.map((option) => {
          const on = type === option.id;
          return (
            <Pressable key={option.id} onPress={() => setType(option.id)} disabled={busy} accessibilityRole="radio" accessibilityState={{ checked: on }} style={[styles.option, on && styles.optionOn]}>
              <Text style={styles.radio}>{on ? '◉' : '○'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.optionTitle}>{option.label}</Text>
                <Text style={styles.hint}>{option.hint}</Text>
              </View>
            </Pressable>
          );
        })}

        <Text style={styles.fieldLabel}>O que aconteceu</Text>
        <TextInput
          style={styles.input}
          value={message}
          onChangeText={setMessage}
          editable={!busy}
          multiline
          maxLength={PROBLEM_MESSAGE_MAX}
          placeholder="Descreva o problema: o que você tentou fazer e o que apareceu."
          placeholderTextColor={PRColors.slate}
          textAlignVertical="top"
        />
        <Text style={styles.counter}>{message.length}/{PROBLEM_MESSAGE_MAX}</Text>

        <Text style={styles.fieldLabel}>Imagens (opcional, até {PROBLEM_MAX_IMAGES})</Text>
        <View style={styles.thumbs}>
          {images.map((image, index) => (
            <View key={index} style={styles.thumbWrap}>
              <Image source={{ uri: image.uri }} style={styles.thumb} accessibilityLabel={`Imagem ${index + 1} anexada`} />
              <Pressable onPress={() => setImages((current) => current.filter((_, i) => i !== index))} disabled={busy} accessibilityRole="button" accessibilityLabel={`Remover imagem ${index + 1}`} style={styles.thumbRemove}><Text style={styles.thumbRemoveText}>✕</Text></Pressable>
            </View>
          ))}
          {images.length < PROBLEM_MAX_IMAGES ? (
            <Pressable onPress={() => void addImage()} disabled={busy} accessibilityRole="button" style={styles.addImage}><Text style={styles.addImageText}>+ Anexar imagem</Text></Pressable>
          ) : null}
        </View>

        <Pressable onPress={() => void submit()} disabled={!ready} accessibilityRole="button" style={[styles.button, !ready && styles.buttonDisabled]}>
          {busy ? <ActivityIndicator size="small" color={PRColors.white} /> : null}
          <Text style={styles.buttonText}>{busy ? 'Enviando…' : 'Enviar relato'}</Text>
        </Pressable>
        {result ? <Text style={[styles.result, result.ok ? styles.ok : styles.problem]}>{result.text}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Meus relatos</Text>
        {mine === null ? <ActivityIndicator /> : mine.length === 0 ? <Text style={styles.hint}>Você ainda não enviou nenhum relato.</Text> : mine.map((report) => (
          <View key={report.id} style={styles.reportRow}>
            <Text style={styles.optionTitle}>{report.typeLabel} · {STATUS_LABELS[report.status] ?? report.status}</Text>
            <Text style={styles.hint} numberOfLines={2}>{report.message}</Text>
            <Text style={styles.counter}>{new Date(report.createdAt).toLocaleDateString('pt-BR')}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: PRColors.white, borderRadius: 16, padding: 16, gap: 10, borderWidth: 1, borderColor: PRColors.stone },
  label: { fontSize: 12, letterSpacing: 1, color: PRColors.ocean, textTransform: 'uppercase' },
  title: { fontSize: 20, fontWeight: '700', color: PRColors.mineral },
  hint: { fontSize: 13, lineHeight: 18, color: PRColors.graphite },
  fieldLabel: { fontSize: 14, fontWeight: '700', color: PRColors.mineral, marginTop: 6 },
  option: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 10, borderRadius: 12, borderWidth: 1, borderColor: PRColors.stone },
  optionOn: { borderColor: PRColors.ocean, backgroundColor: '#EAF4F8' },
  optionTitle: { fontSize: 14, fontWeight: '700', color: PRColors.mineral },
  radio: { fontSize: 18, color: PRColors.ocean },
  input: { minHeight: 120, borderWidth: 1, borderColor: PRColors.stone, borderRadius: 12, padding: 12, fontSize: 15, color: PRColors.mineral },
  counter: { fontSize: 12, color: PRColors.slate, textAlign: 'right' },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  thumbWrap: { width: 84, height: 84 },
  thumb: { width: 84, height: 84, borderRadius: 10 },
  thumbRemove: { position: 'absolute', top: -6, right: -6, width: 24, height: 24, borderRadius: 12, backgroundColor: PRColors.danger, alignItems: 'center', justifyContent: 'center' },
  thumbRemoveText: { color: PRColors.white, fontSize: 12, fontWeight: '700' },
  addImage: { height: 84, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: PRColors.ocean, alignItems: 'center', justifyContent: 'center' },
  addImageText: { color: PRColors.ocean, fontSize: 13, fontWeight: '700' },
  button: { flexDirection: 'row', gap: 8, justifyContent: 'center', alignItems: 'center', backgroundColor: PRColors.mineral, borderRadius: 12, paddingVertical: 14, marginTop: 8 },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: PRColors.white, fontSize: 15, fontWeight: '700' },
  result: { fontSize: 14, lineHeight: 20 },
  ok: { color: PRColors.success },
  problem: { color: PRColors.danger },
  reportRow: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: PRColors.stone, gap: 2 },
});
