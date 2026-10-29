import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../PtText';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import { PRColors } from '../../theme/tokens';
import { PHOTO_MAX_BYTES, PHOTO_SIDE, QUALITIES, base64Bytes, centerSquareCrop, initialsOf } from './photoMath';

// Foto de perfil do aluno (21/10/2026). A foto e' UMA so' por aluno, guardada no servidor (GET/PUT/DELETE /me/photo); o app, o cabecalho e o painel do treinador leem a mesma imagem.
// O app corta em quadrado (o editor do sistema, quando existe), reduz para 320 px e comprime em JPEG ate' caber no limite do servidor (60 KB) — o servidor so' valida, nao reprocessa.

export function Avatar({ uri, name, size = 44 }: { uri: string | null; name: string; size?: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      {uri ? <Image source={{ uri }} style={{ width: size, height: size }} accessibilityLabel="Foto de perfil" /> : <Text style={[styles.avatarText, { fontSize: Math.round(size * 0.38) }]}>{initialsOf(name)}</Text>}
    </View>
  );
}

// Carrega a foto do aluno logado (uma vez por sessao) e expoe salvar/remover; a UI sempre mostra o que o servidor confirmou.
export function useProfilePhoto(apiUrl: string, accessToken: string) {
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!accessToken) { setUri(null); return; }
    fetch(`${apiUrl}/me/photo`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { dataUri?: string | null } | null) => { if (alive) setUri(body?.dataUri ?? null); })
      .catch(() => { /* sem foto no cabecalho nao e' erro: mostra as iniciais */ });
    return () => { alive = false; };
  }, [apiUrl, accessToken]);

  return { uri, setUri };
}

export function ProfilePhotoCard({ apiUrl, accessToken, name, uri, onChange }: { apiUrl: string; accessToken: string; name: string; uri: string | null; onChange: (uri: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const pick = useCallback(async () => {
    setMessage('');
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1, exif: false });
      if (picked.canceled || !picked.assets?.[0]) return;
      setBusy(true);
      const asset = picked.assets[0];
      const actions: ImageManipulator.Action[] = [];
      if (asset.width && asset.height && asset.width !== asset.height) actions.push({ crop: centerSquareCrop(asset.width, asset.height) });
      actions.push({ resize: { width: PHOTO_SIDE, height: PHOTO_SIDE } });
      let base64: string | null = null;
      for (const compress of QUALITIES) {
        const result = await ImageManipulator.manipulateAsync(asset.uri, actions, { compress, format: ImageManipulator.SaveFormat.JPEG, base64: true });
        if (result.base64 && base64Bytes(result.base64) <= PHOTO_MAX_BYTES) { base64 = result.base64; break; }
      }
      if (!base64) { setMessage('Não foi possível reduzir esta imagem. Escolha outra foto.'); return; }
      const response = await fetch(`${apiUrl}/me/photo`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ imageBase64: base64 }) });
      if (!response.ok) { setMessage('Não foi possível salvar a foto agora. Tente de novo.'); return; }
      onChange(`data:image/jpeg;base64,${base64}`);
      setMessage('Foto atualizada.');
    } catch {
      setMessage('Não foi possível abrir a galeria. Verifique a permissão de fotos.');
    } finally {
      setBusy(false);
    }
  }, [apiUrl, accessToken, onChange]);

  const remove = useCallback(async () => {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`${apiUrl}/me/photo`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) { setMessage('Não foi possível remover a foto agora.'); return; }
      onChange(null);
      setMessage('Foto removida.');
    } catch {
      setMessage('Não foi possível remover a foto agora.');
    } finally {
      setBusy(false);
    }
  }, [apiUrl, accessToken, onChange]);

  return (
    <View style={styles.card}>
      <Avatar uri={uri} name={name} size={84} />
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>Foto de perfil</Text>
        <Text style={styles.cardHint}>Aparece no seu perfil e para o seu treinador.</Text>
        <View style={styles.actions}>
          <Pressable style={[styles.button, busy && styles.disabled]} disabled={busy} onPress={pick} accessibilityRole="button">
            {busy ? <ActivityIndicator size="small" color={PRColors.white} /> : <Ionicons name="image-outline" size={16} color={PRColors.white} />}
            <Text style={styles.buttonText}>{uri ? 'Trocar foto' : 'Escolher da galeria'}</Text>
          </Pressable>
          {uri ? (
            <Pressable style={[styles.buttonGhost, busy && styles.disabled]} disabled={busy} onPress={remove} accessibilityRole="button">
              <Ionicons name="trash-outline" size={16} color={PRColors.danger} />
              <Text style={styles.buttonGhostText}>Remover</Text>
            </Pressable>
          ) : null}
        </View>
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { backgroundColor: PRColors.mist, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarText: { color: PRColors.ocean, fontWeight: '800' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: PRColors.stone, backgroundColor: PRColors.white, marginBottom: 12 },
  cardBody: { flex: 1, gap: 4 },
  cardTitle: { color: PRColors.mineral, fontSize: 16, fontWeight: '800' },
  cardHint: { color: PRColors.slate, fontSize: 13 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  button: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: PRColors.ocean, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12 },
  buttonText: { color: PRColors.white, fontWeight: '700', fontSize: 14 },
  buttonGhost: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 10 },
  buttonGhostText: { color: PRColors.danger, fontWeight: '700', fontSize: 14 },
  disabled: { opacity: 0.6 },
  message: { color: PRColors.graphite, fontSize: 13, marginTop: 4 },
});
