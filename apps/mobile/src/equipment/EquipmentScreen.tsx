import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import { PRColors } from '../../theme/tokens';
import { PHOTO_MAX_BYTES, PHOTO_SIDE, QUALITIES, base64Bytes, centerSquareCrop } from '../profilePhoto/photoMath';

// Equipamentos do aluno (23/10/2026): Tenis | Relogios. Tudo que aparece aqui vem pronto da API (km, pace, faixas, provas confirmadas): o app nunca recalcula nada.
// Ausencia de dado aparece como "—", nunca como zero. A correcao de um relogio nao apaga a origem tecnica do dado (so' a API guarda os dois lados).

interface ShoeSummary {
  id: string; brand: string; model: string; version: string | null; nickname: string | null; hasPhoto: boolean; status: 'active' | 'retired';
  startedUsingAt: string; retiredAt: string | null; workoutsCount: number; totalDistanceKm: number; averageKmPerWorkout: number | null;
  firstUsedAt: string | null; lastUsedAt: string | null;
}
interface ShoeStats {
  runsCount: number; runsWithDistance: number; runsWithoutDistance: number; totalDistanceKm: number;
  avgPace: { label: string; runs: number; distanceKm: number; durationSec: number } | null;
  marathons: { confirmed: number; candidates: number }; halfMarathons: { confirmed: number; candidates: number };
  bands: Array<{ key: string; label: string; count: number; distanceKm: number }>;
  runsOver30Km: number; kmByMonth: Array<{ month: string; km: number; runs: number }>; firstRunDate: string | null; lastRunDate: string | null;
}
interface ShoeDetail extends ShoeSummary { stats: ShoeStats; retrospective: string | null }
interface DeviceView {
  id: string; platform: string; platformLabel: string; sourceDetail: string | null; manufacturer: string | null;
  manufacturerSource: 'manual' | 'dispositivo_informou' | 'plataforma_exclusiva' | null; model: string | null; modelSource: 'manual' | 'dispositivo_informou' | null;
  technicalId?: string | null; deviceType: string | null; firstSeenAt: string | null; lastSeenAt: string | null; activityCount: number;
  observed: { manufacturer: string | null; model: string | null; name: string | null }; corrected: boolean;
}
interface PlatformView {
  provider: string; name: string; state: string; stateLabel: string; lastSyncAt: string | null; activityCount: number | null;
  categories: Array<{ id: string; label: string; authorized: boolean | null; count: number | null; lastAt: string | null }>;
}

const TYPE_LABEL: Record<string, string> = { relogio: 'Relógio', telefone: 'Telefone', pulseira: 'Pulseira', cinta: 'Cinta', anel: 'Anel', outro: 'Outro' };
const dash = '—';
const shoeName = (s: Pick<ShoeSummary, 'brand' | 'model' | 'version'>) => [s.brand, s.model, s.version].filter(Boolean).join(' ');
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : dash);
const fmtKm = (km: number | null | undefined) => (km == null ? dash : String(Math.round(km * 10) / 10).replace('.', ',') + ' km');
// Data de inicio de uso e' so' um dia (guardada a meia-noite UTC): mostrar em UTC evita voltar um dia no fuso do Brasil.
const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : dash);
const monthLabel = (month: string) => month.slice(5) + '/' + month.slice(0, 4);

function dateToInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + d.getUTCFullYear();
}
function todayInput(): string {
  const n = new Date();
  return String(n.getDate()).padStart(2, '0') + '/' + String(n.getMonth() + 1).padStart(2, '0') + '/' + n.getFullYear();
}
function inputToIso(value: string): string | null {
  const m = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? d.toISOString() : null;
}

const manufacturerSourceText = (d: DeviceView): string => {
  if (d.manufacturerSource === 'manual') return 'corrigido por você';
  if (d.manufacturerSource === 'plataforma_exclusiva') return 'pela plataforma, que atende uma só marca';
  if (d.manufacturerSource === 'dispositivo_informou') return 'informado pelo aparelho';
  return '';
};

// Miniatura carregada sob demanda (a lista nao baixa todas as fotos de uma vez).
function ShoeThumb({ apiUrl, accessToken, shoe, size }: { apiUrl: string; accessToken: string; shoe: ShoeSummary; size: number }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!shoe.hasPhoto) { setUri(null); return; }
    fetch(`${apiUrl}/me/shoes/${shoe.id}/photo`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { dataUri?: string | null } | null) => { if (alive) setUri(b?.dataUri ?? null); })
      .catch(() => { /* sem foto nao e' erro */ });
    return () => { alive = false; };
  }, [apiUrl, accessToken, shoe.id, shoe.hasPhoto]);
  return (
    <View style={[st.thumb, { width: size, height: size, borderRadius: size / 4 }]}>
      {uri ? <Image source={{ uri }} style={{ width: size, height: size }} accessibilityLabel="Foto do tênis" /> : <Ionicons name="footsteps-outline" size={size * 0.5} color={PRColors.slate} />}
    </View>
  );
}

export function EquipmentScreen({ apiUrl, accessToken }: { apiUrl: string; accessToken: string }) {
  const [section, setSection] = useState<'tenis' | 'relogios'>('tenis');
  return (
    <View style={st.section}>
      <Text style={st.label}>Equipamentos</Text>
      <View style={st.switchRow}>
        {(['tenis', 'relogios'] as const).map((id) => (
          <Pressable key={id} style={[st.switchChip, section === id && st.switchChipOn]} onPress={() => setSection(id)} accessibilityRole="button">
            <Text style={[st.switchText, section === id && st.switchTextOn]}>{id === 'tenis' ? 'Tênis' : 'Relógios'}</Text>
          </Pressable>
        ))}
      </View>
      {section === 'tenis' ? <ShoesSection apiUrl={apiUrl} accessToken={accessToken} /> : <DevicesSection apiUrl={apiUrl} accessToken={accessToken} />}
    </View>
  );
}

// ── TENIS ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function ShoesSection({ apiUrl, accessToken }: { apiUrl: string; accessToken: string }) {
  const auth = { Authorization: `Bearer ${accessToken}` };
  const [active, setActive] = useState<ShoeSummary[]>([]);
  const [retired, setRetired] = useState<ShoeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [showRetired, setShowRetired] = useState(false);
  const [mode, setMode] = useState<'list' | 'form' | 'detail'>('list');
  const [editing, setEditing] = useState<ShoeSummary | null>(null);
  const [detail, setDetail] = useState<ShoeDetail | null>(null);
  const [retro, setRetro] = useState<string | null>(null);
  const [confirmRetire, setConfirmRetire] = useState(false);
  const [busy, setBusy] = useState(false);
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [version, setVersion] = useState('');
  const [nickname, setNickname] = useState('');
  const [startedUsingAt, setStartedUsingAt] = useState(todayInput());
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${apiUrl}/me/shoes`, { headers: auth });
      if (r.ok) {
        const data = (await r.json()) as { active: ShoeSummary[]; retired: ShoeSummary[] };
        setActive(data.active); setRetired(data.retired);
      }
    } catch { setMessage('Não consegui carregar seus tênis.'); } finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, accessToken]);
  useEffect(() => { void load(); }, [load]);

  async function openDetail(id: string) {
    setMode('detail'); setDetail(null); setRetro(null); setConfirmRetire(false); setMessage('');
    try {
      const r = await fetch(`${apiUrl}/me/shoes/${id}`, { headers: auth });
      if (r.ok) setDetail((await r.json()) as ShoeDetail); else setMessage('Não consegui carregar o detalhe deste tênis.');
    } catch { setMessage('Sem conexão. Tente novamente.'); }
  }

  function openForm(shoe: ShoeSummary | null) {
    setEditing(shoe); setBrand(shoe?.brand ?? ''); setModel(shoe?.model ?? ''); setVersion(shoe?.version ?? ''); setNickname(shoe?.nickname ?? '');
    setStartedUsingAt(shoe ? dateToInput(shoe.startedUsingAt) : todayInput()); setPhotoBase64(null); setRemovePhoto(false); setMessage(''); setMode('form');
  }

  async function pickPhoto() {
    setMessage('');
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1, exif: false });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      const actions: ImageManipulator.Action[] = [];
      if (asset.width && asset.height && asset.width !== asset.height) actions.push({ crop: centerSquareCrop(asset.width, asset.height) });
      actions.push({ resize: { width: PHOTO_SIDE, height: PHOTO_SIDE } });
      for (const compress of QUALITIES) {
        const result = await ImageManipulator.manipulateAsync(asset.uri, actions, { compress, format: ImageManipulator.SaveFormat.JPEG, base64: true });
        if (result.base64 && base64Bytes(result.base64) <= PHOTO_MAX_BYTES) { setPhotoBase64(result.base64); setRemovePhoto(false); return; }
      }
      setMessage('Não foi possível reduzir esta imagem. Escolha outra foto.');
    } catch { setMessage('Não foi possível abrir a galeria. Verifique a permissão de fotos.'); }
  }

  async function saveShoe() {
    if (!brand.trim() || !model.trim()) { setMessage('Informe marca e modelo.'); return; }
    const iso = inputToIso(startedUsingAt);
    if (!iso) { setMessage('Data de início de uso inválida.'); return; }
    setBusy(true); setMessage('');
    try {
      const r = await fetch(editing ? `${apiUrl}/me/shoes/${editing.id}` : `${apiUrl}/me/shoes`, {
        method: editing ? 'PATCH' : 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand: brand.trim(), model: model.trim(), version: version.trim() || undefined, nickname: nickname.trim() || undefined, startedUsingAt: iso }),
      });
      if (!r.ok) { setMessage('Não consegui salvar o tênis.'); return; }
      const saved = (await r.json()) as ShoeSummary;
      let photoFailed = false;
      if (photoBase64) {
        const p = await fetch(`${apiUrl}/me/shoes/${saved.id}/photo`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ imageBase64: photoBase64 }) });
        photoFailed = !p.ok;
      } else if (removePhoto && editing?.hasPhoto) {
        await fetch(`${apiUrl}/me/shoes/${saved.id}/photo`, { method: 'DELETE', headers: auth });
      }
      await load();
      if (photoFailed) { setMessage('O tênis foi salvo, mas a foto não pôde ser enviada agora.'); }
      setMode('list');
    } catch { setMessage('Sem conexão. Tente novamente.'); } finally { setBusy(false); }
  }

  async function retire(id: string) {
    setBusy(true);
    try {
      const r = await fetch(`${apiUrl}/me/shoes/${id}/retire`, { method: 'POST', headers: auth });
      if (!r.ok) { setMessage('Não consegui aposentar este tênis.'); return; }
      const body = (await r.json()) as { retrospective?: string | null };
      setRetro(body.retrospective ?? null);
      setConfirmRetire(false);
      await load();
      await openDetail(id);
      setRetro(body.retrospective ?? null);
    } catch { setMessage('Sem conexão. Tente novamente.'); } finally { setBusy(false); }
  }

  async function reactivate(id: string) {
    setBusy(true);
    try {
      const r = await fetch(`${apiUrl}/me/shoes/${id}/reactivate`, { method: 'POST', headers: auth });
      if (!r.ok) { setMessage('Não consegui reativar este tênis.'); return; }
      await load();
      await openDetail(id);
    } catch { setMessage('Sem conexão. Tente novamente.'); } finally { setBusy(false); }
  }

  function askRetire(id: string) {
    if (Platform.OS === 'web') { setConfirmRetire(true); return; }
    Alert.alert('Aposentar tênis', 'O tênis sai da lista de uso, mas todo o histórico continua guardado. Você pode reativá-lo quando quiser.', [
      { text: 'Cancelar', style: 'cancel' }, { text: 'Aposentar', onPress: () => { void retire(id); } },
    ]);
  }

  const card = (shoe: ShoeSummary) => (
    <Pressable key={shoe.id} style={st.shoeCard} onPress={() => openDetail(shoe.id)} accessibilityRole="button" accessibilityLabel={`Abrir detalhes de ${shoeName(shoe)}`}>
      <ShoeThumb apiUrl={apiUrl} accessToken={accessToken} shoe={shoe} size={44} />
      <View style={{ flex: 1 }}>
        <Text style={st.shoeTitle} numberOfLines={1}>{shoeName(shoe)}</Text>
        <Text style={st.muted}>{shoe.workoutsCount > 0 ? fmtKm(shoe.totalDistanceKm) + ' acumulados' : 'Sem corridas ainda'}</Text>
      </View>
      <View style={[st.pill, shoe.status === 'active' ? st.pillOn : st.pillOff]}>
        <Text style={[st.pillText, { color: shoe.status === 'active' ? '#2E7D4F' : '#8A8578' }]}>{shoe.status === 'active' ? 'Em uso' : 'Aposentado'}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={PRColors.slate} />
    </Pressable>
  );

  if (mode === 'form') {
    return (
      <View>
        <Text style={st.title}>{editing ? 'Editar tênis' : 'Novo tênis'}</Text>
        <TextInput style={st.input} placeholder="Marca (ex: ASICS)" value={brand} onChangeText={setBrand} />
        <TextInput style={st.input} placeholder="Modelo (ex: Novablast)" value={model} onChangeText={setModel} />
        <TextInput style={st.input} placeholder="Versão (opcional, ex: 5)" value={version} onChangeText={setVersion} />
        <TextInput style={st.input} placeholder="Apelido (opcional)" value={nickname} onChangeText={setNickname} />
        <Text style={st.hint}>Comecei a usar em</Text>
        <TextInput style={st.input} placeholder="dd/mm/aaaa" value={startedUsingAt} onChangeText={setStartedUsingAt} />
        <Text style={st.hint}>Foto (opcional)</Text>
        <View style={st.row}>
          {photoBase64 ? <Image source={{ uri: `data:image/jpeg;base64,${photoBase64}` }} style={st.preview} /> : editing?.hasPhoto && !removePhoto ? <ShoeThumb apiUrl={apiUrl} accessToken={accessToken} shoe={editing} size={64} /> : <View style={[st.thumb, { width: 64, height: 64, borderRadius: 16 }]}><Ionicons name="image-outline" size={26} color={PRColors.slate} /></View>}
          <Pressable style={st.btnGhost} onPress={pickPhoto}><Text style={st.btnGhostText}>{photoBase64 || (editing?.hasPhoto && !removePhoto) ? 'Trocar foto' : 'Escolher da galeria'}</Text></Pressable>
          {(photoBase64 || (editing?.hasPhoto && !removePhoto)) ? <Pressable onPress={() => { setPhotoBase64(null); setRemovePhoto(true); }}><Text style={[st.btnGhostText, { color: PRColors.danger }]}>Remover</Text></Pressable> : null}
        </View>
        {message ? <Text style={st.message}>{message}</Text> : null}
        <View style={[st.row, { marginTop: 14 }]}>
          <Pressable style={st.btnGhost} onPress={() => { setMode('list'); setMessage(''); }}><Text style={st.btnGhostText}>Cancelar</Text></Pressable>
          <Pressable style={[st.btn, { flex: 1 }, busy && st.disabled]} disabled={busy} onPress={saveShoe}><Text style={st.btnText}>{busy ? 'Salvando...' : 'Salvar'}</Text></Pressable>
        </View>
      </View>
    );
  }

  if (mode === 'detail') {
    if (!detail) {
      return (<View><Pressable onPress={() => setMode('list')}><Text style={st.back}>{'< Tênis'}</Text></Pressable>{message ? <Text style={st.message}>{message}</Text> : <ActivityIndicator color={PRColors.ocean} />}</View>);
    }
    const s = detail.stats;
    const maxBand = Math.max(1, ...s.bands.map((b) => b.count));
    const maxMonth = Math.max(1, ...s.kmByMonth.map((m) => m.km));
    const retrospective = detail.status === 'retired' ? retro ?? detail.retrospective : null;
    return (
      <View>
        <Pressable onPress={() => { setMode('list'); void load(); }}><Text style={st.back}>{'< Tênis'}</Text></Pressable>
        <View style={st.row}>
          <ShoeThumb apiUrl={apiUrl} accessToken={accessToken} shoe={detail} size={64} />
          <View style={{ flex: 1 }}>
            <Text style={st.title}>{shoeName(detail)}</Text>
            {detail.nickname ? <Text style={st.muted}>{detail.nickname}</Text> : null}
            <Text style={st.muted}>{detail.status === 'active' ? 'Em uso' : 'Aposentado'} · desde {fmtDay(detail.startedUsingAt)}{detail.retiredAt ? ` · aposentado em ${fmtDate(detail.retiredAt)}` : ''}</Text>
          </View>
        </View>

        {retrospective ? <View style={st.retro}><Text style={st.retroText}>{retrospective}</Text></View> : null}

        <View style={st.stats}>
          <View style={st.stat}><Text style={st.hint}>Quilometragem total</Text><Text style={st.statValue}>{s.runsWithDistance > 0 ? fmtKm(s.totalDistanceKm) : dash}</Text></View>
          <View style={st.stat}><Text style={st.hint}>Corridas</Text><Text style={st.statValue}>{s.runsCount > 0 ? s.runsCount : dash}</Text></View>
          <View style={st.stat}><Text style={st.hint}>Pace médio</Text><Text style={st.statValue}>{s.avgPace ? s.avgPace.label : dash}</Text></View>
          <View style={st.stat}><Text style={st.hint}>Maratonas</Text><Text style={st.statValue}>{s.marathons.confirmed}</Text></View>
          <View style={st.stat}><Text style={st.hint}>Meias-maratonas</Text><Text style={st.statValue}>{s.halfMarathons.confirmed}</Text></View>
        </View>
        {s.avgPace ? <Text style={st.note}>Pace calculado pelo tempo e distância totais de {s.avgPace.runs} {s.avgPace.runs === 1 ? 'corrida' : 'corridas'}, não pela média dos paces.</Text> : null}
        {s.marathons.candidates > 0 || s.halfMarathons.candidates > 0 ? (
          <Text style={st.note}>
            {[s.marathons.candidates > 0 ? `${s.marathons.candidates} ${s.marathons.candidates === 1 ? 'corrida' : 'corridas'} de ~42 km sem prova cadastrada` : null,
              s.halfMarathons.candidates > 0 ? `${s.halfMarathons.candidates} ${s.halfMarathons.candidates === 1 ? 'corrida' : 'corridas'} de ~21 km sem prova cadastrada` : null].filter(Boolean).join(' · ')}
            {' '}(não contam como prova).
          </Text>
        ) : null}
        {s.runsWithoutDistance > 0 ? <Text style={st.note}>{s.runsWithoutDistance} {s.runsWithoutDistance === 1 ? 'corrida sem distância registrada' : 'corridas sem distância registrada'} (não entram na quilometragem).</Text> : null}

        <Text style={[st.label, { marginTop: 16 }]}>Corridas por distância</Text>
        {s.runsWithDistance === 0 ? <Text style={st.muted}>Ainda não há corridas com distância neste tênis.</Text> : s.bands.map((b) => (
          <View key={b.key} style={st.barRow}>
            <Text style={st.barLabel}>{b.label}</Text>
            <View style={st.barTrack}><View style={[st.barFill, { width: `${Math.round((b.count / maxBand) * 100)}%` }]} /></View>
            <Text style={st.barValue}>{b.count}</Text>
          </View>
        ))}

        {s.kmByMonth.length >= 2 ? (
          <>
            <Text style={[st.label, { marginTop: 16 }]}>Quilometragem por mês</Text>
            {s.kmByMonth.map((m) => (
              <View key={m.month} style={st.barRow}>
                <Text style={st.barLabel}>{monthLabel(m.month)}</Text>
                <View style={st.barTrack}><View style={[st.barFill, { width: `${Math.round((m.km / maxMonth) * 100)}%` }]} /></View>
                <Text style={st.barValue}>{fmtKm(m.km)}</Text>
              </View>
            ))}
          </>
        ) : null}

        {message ? <Text style={st.message}>{message}</Text> : null}
        {confirmRetire ? (
          <View style={st.confirm}>
            <Text style={st.muted}>O tênis sai da lista de uso, mas todo o histórico continua guardado. Você pode reativá-lo quando quiser.</Text>
            <View style={[st.row, { marginTop: 8 }]}>
              <Pressable style={st.btnGhost} onPress={() => setConfirmRetire(false)}><Text style={st.btnGhostText}>Cancelar</Text></Pressable>
              <Pressable style={[st.btn, { flex: 1 }, busy && st.disabled]} disabled={busy} onPress={() => retire(detail.id)}><Text style={st.btnText}>Aposentar tênis</Text></Pressable>
            </View>
          </View>
        ) : (
          <View style={[st.row, { marginTop: 16 }]}>
            <Pressable style={[st.btnGhost, { flex: 1 }]} onPress={() => openForm(detail)}><Text style={st.btnGhostText}>Editar</Text></Pressable>
            {detail.status === 'active' ? (
              <Pressable style={[st.btnGhost, { flex: 1 }, busy && st.disabled]} disabled={busy} onPress={() => askRetire(detail.id)}><Text style={st.btnGhostText}>Aposentar tênis</Text></Pressable>
            ) : (
              <Pressable style={[st.btn, { flex: 1 }, busy && st.disabled]} disabled={busy} onPress={() => reactivate(detail.id)}><Text style={st.btnText}>Reativar tênis</Text></Pressable>
            )}
          </View>
        )}
      </View>
    );
  }

  return (
    <View>
      <View style={[st.row, { justifyContent: 'space-between', marginBottom: 10 }]}>
        <Text style={st.title}>Meus tênis</Text>
        <Pressable style={st.btn} onPress={() => openForm(null)}><Text style={st.btnText}>+ Novo</Text></Pressable>
      </View>
      {message ? <Text style={st.message}>{message}</Text> : null}
      {loading ? <ActivityIndicator color={PRColors.ocean} /> : null}
      {!loading && active.length === 0 ? <Text style={st.muted}>Nenhum tênis em uso. Toque em "+ Novo" para cadastrar.</Text> : null}
      {active.map(card)}
      {retired.length > 0 ? (
        <View style={{ marginTop: 12 }}>
          <Pressable onPress={() => setShowRetired((v) => !v)}><Text style={st.label}>{showRetired ? 'Ocultar' : 'Ver'} aposentados ({retired.length})</Text></Pressable>
          {showRetired ? retired.map(card) : null}
        </View>
      ) : null}
    </View>
  );
}

// ── RELOGIOS ───────────────────────────────────────────────────────────────────────────────────────────────────────
function DevicesSection({ apiUrl, accessToken }: { apiUrl: string; accessToken: string }) {
  const auth = { Authorization: `Bearer ${accessToken}` };
  const [devices, setDevices] = useState<DeviceView[]>([]);
  const [platforms, setPlatforms] = useState<PlatformView[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [editId, setEditId] = useState<string | 'new' | null>(null);
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${apiUrl}/me/equipment/devices`, { headers: auth });
      if (r.ok) { const data = (await r.json()) as { devices: DeviceView[]; platforms: PlatformView[] }; setDevices(data.devices); setPlatforms(data.platforms); }
      else setMessage('Não consegui carregar seus relógios.');
    } catch { setMessage('Sem conexão. Tente novamente.'); } finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, accessToken]);
  useEffect(() => { void load(); }, [load]);

  function startEdit(device: DeviceView | null) {
    setEditId(device ? device.id : 'new'); setManufacturer(device?.manufacturer ?? ''); setModel(device?.model ?? ''); setMessage('');
  }

  async function save() {
    if (!manufacturer.trim() && !model.trim()) { setMessage('Informe o fabricante e/ou o modelo.'); return; }
    setBusy(true); setMessage('');
    try {
      const r = await fetch(editId === 'new' ? `${apiUrl}/me/equipment/devices` : `${apiUrl}/me/equipment/devices/${editId}`, {
        method: editId === 'new' ? 'POST' : 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ manufacturer: manufacturer.trim(), model: model.trim() }),
      });
      if (!r.ok) { setMessage('Não consegui salvar agora.'); return; }
      setEditId(null);
      await load();
    } catch { setMessage('Sem conexão. Tente novamente.'); } finally { setBusy(false); }
  }

  const form = (
    <View style={st.confirm}>
      <TextInput style={st.input} placeholder="Fabricante (ex: Garmin)" value={manufacturer} onChangeText={setManufacturer} />
      <TextInput style={st.input} placeholder="Modelo (ex: Forerunner 265)" value={model} onChangeText={setModel} />
      <Text style={st.note}>A correção fica registrada à parte: a origem técnica que veio do aparelho ou da plataforma não é apagada.</Text>
      {message ? <Text style={st.message}>{message}</Text> : null}
      <View style={[st.row, { marginTop: 8 }]}>
        <Pressable style={st.btnGhost} onPress={() => { setEditId(null); setMessage(''); }}><Text style={st.btnGhostText}>Cancelar</Text></Pressable>
        <Pressable style={[st.btn, { flex: 1 }, busy && st.disabled]} disabled={busy} onPress={save}><Text style={st.btnText}>{busy ? 'Salvando...' : 'Salvar'}</Text></Pressable>
      </View>
    </View>
  );

  return (
    <View>
      <View style={[st.row, { justifyContent: 'space-between', marginBottom: 10 }]}>
        <Text style={st.title}>Meus relógios</Text>
        <Pressable style={st.btn} onPress={() => startEdit(null)}><Text style={st.btnText}>Adicionar relógio</Text></Pressable>
      </View>
      {editId === 'new' ? form : null}
      {loading ? <ActivityIndicator color={PRColors.ocean} /> : null}
      {!loading && message && editId === null ? <Text style={st.message}>{message}</Text> : null}
      {!loading && devices.length === 0 ? <Text style={st.muted}>Ainda não identificamos nenhum relógio. Assim que uma atividade chegar por uma plataforma conectada, ele aparece aqui; você também pode adicionar o seu.</Text> : null}
      {devices.map((d) => (
        <View key={d.id} style={st.deviceCard}>
          <Text style={st.shoeTitle}>{[d.manufacturer, d.model].filter(Boolean).join(' ') || 'Aparelho não identificado'}</Text>
          {d.deviceType ? <Text style={st.muted}>{TYPE_LABEL[d.deviceType] ?? d.deviceType}</Text> : null}
          <Text style={st.kv}><Text style={st.k}>Fabricante: </Text>{d.manufacturer ?? dash}{d.manufacturer && manufacturerSourceText(d) ? ` (${manufacturerSourceText(d)})` : ''}</Text>
          <Text style={st.kv}><Text style={st.k}>Modelo: </Text>{d.model ?? 'Modelo não identificado'}{d.model && d.modelSource === 'manual' ? ' (corrigido por você)' : d.model ? ' (informado pelo aparelho)' : ''}</Text>
          {!d.model && d.technicalId ? <Text style={st.note}>Identificador técnico recebido (não é um nome comercial): {d.technicalId}</Text> : null}
          <Text style={st.kv}><Text style={st.k}>Plataforma: </Text>{d.platformLabel}</Text>
          {d.platform !== 'manual' ? (
            <>
              <Text style={st.kv}><Text style={st.k}>Última atividade recebida: </Text>{fmtDate(d.lastSeenAt)}</Text>
              <Text style={st.kv}><Text style={st.k}>Atividades recebidas: </Text>{d.activityCount > 0 ? d.activityCount : dash}</Text>
            </>
          ) : <Text style={st.muted}>Informado por você, sem integração.</Text>}
          {d.corrected && (d.observed.manufacturer || d.observed.model || d.observed.name) ? (
            <Text style={st.note}>Origem técnica preservada: {[d.observed.manufacturer, d.observed.model ?? d.observed.name].filter(Boolean).join(' ')}.</Text>
          ) : null}
          {editId === d.id ? form : (
            <Pressable onPress={() => startEdit(d)} style={{ marginTop: 6 }}><Text style={st.link}>{d.manufacturer && d.model ? 'Corrigir' : 'Informar/corrigir'}</Text></Pressable>
          )}
        </View>
      ))}

      {platforms.length > 0 ? (
        <>
          <Text style={[st.label, { marginTop: 16 }]}>Plataformas conectadas</Text>
          {platforms.map((p) => (
            <View key={p.provider} style={st.deviceCard}>
              <View style={[st.row, { justifyContent: 'space-between' }]}>
                <Text style={st.shoeTitle}>{p.name}</Text>
                <View style={[st.pill, p.state === 'connected' ? st.pillOn : st.pillOff]}><Text style={[st.pillText, { color: p.state === 'connected' ? '#2E7D4F' : '#8A8578' }]}>{p.stateLabel}</Text></View>
              </View>
              <Text style={st.kv}><Text style={st.k}>Última sincronização: </Text>{fmtDate(p.lastSyncAt)}</Text>
              {p.activityCount != null && p.activityCount > 0 ? <Text style={st.kv}><Text style={st.k}>Atividades recebidas: </Text>{p.activityCount}</Text> : null}
              {p.categories.length > 0 ? (
                <View style={{ marginTop: 4 }}>
                  <Text style={st.k}>Informações:</Text>
                  {p.categories.map((c) => (
                    <Text key={c.id} style={st.kv}>
                      {c.label}: {c.authorized === true ? 'autorizado' : c.authorized === false ? 'não autorizado' : 'sem autorização registrada'}
                      {c.count != null && c.count > 0 ? ` · ${c.count} recebido${c.count === 1 ? '' : 's'}` : ''}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          ))}
        </>
      ) : null}
      <Text style={st.note}>Fabricante, modelo e plataforma são coisas diferentes: por exemplo, a Samsung (fabricante) faz o Galaxy Watch (modelo), que envia os dados pelo Health Connect (plataforma).</Text>
    </View>
  );
}

const st = StyleSheet.create({
  section: { gap: 4 },
  label: { color: PRColors.ocean, fontSize: 13, fontWeight: '800', marginBottom: 6, textTransform: 'uppercase' },
  title: { color: PRColors.mineral, fontSize: 18, fontWeight: '800' },
  back: { color: PRColors.ocean, fontWeight: '800', marginBottom: 8 },
  muted: { color: PRColors.slate, fontSize: 13 },
  hint: { color: PRColors.slate, fontSize: 12, marginTop: 8, marginBottom: 4 },
  note: { color: PRColors.slate, fontSize: 12, marginTop: 6 },
  message: { color: PRColors.graphite, fontSize: 13, marginTop: 8 },
  switchRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  switchChip: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: PRColors.stone, backgroundColor: PRColors.white },
  switchChipOn: { backgroundColor: PRColors.ocean, borderColor: PRColors.ocean },
  switchText: { color: PRColors.graphite, fontWeight: '700' },
  switchTextOn: { color: PRColors.white },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  input: { borderWidth: 1, borderColor: PRColors.stone, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: PRColors.white, color: PRColors.mineral, marginTop: 8 },
  btn: { backgroundColor: PRColors.ocean, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center' },
  btnText: { color: PRColors.white, fontWeight: '700' },
  btnGhost: { borderRadius: 10, borderWidth: 1, borderColor: PRColors.stone, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center', backgroundColor: PRColors.white },
  btnGhostText: { color: PRColors.ocean, fontWeight: '700' },
  link: { color: PRColors.ocean, fontWeight: '700', fontSize: 13 },
  disabled: { opacity: 0.6 },
  shoeCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: PRColors.stone, backgroundColor: PRColors.white, marginBottom: 8 },
  shoeTitle: { color: PRColors.mineral, fontWeight: '700', fontSize: 15 },
  thumb: { backgroundColor: PRColors.limestone, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  preview: { width: 64, height: 64, borderRadius: 16 },
  pill: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999 },
  pillOn: { backgroundColor: '#E8F3EC' },
  pillOff: { backgroundColor: '#EFEDE8' },
  pillText: { fontSize: 11, fontWeight: '700' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: PRColors.stone, backgroundColor: PRColors.white, marginTop: 12 },
  stat: { minWidth: 100 },
  statValue: { color: PRColors.mineral, fontSize: 18, fontWeight: '800' },
  retro: { backgroundColor: '#E8F3EC', borderRadius: 12, padding: 12, marginTop: 12 },
  retroText: { color: '#1F5E3C', fontSize: 14, fontWeight: '600' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  barLabel: { width: 108, color: PRColors.graphite, fontSize: 12 },
  barTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: PRColors.limestone, overflow: 'hidden' },
  barFill: { height: 10, backgroundColor: PRColors.ocean },
  barValue: { width: 62, textAlign: 'right', color: PRColors.graphite, fontSize: 12, fontWeight: '700' },
  confirm: { borderWidth: 1, borderColor: PRColors.stone, borderRadius: 12, padding: 12, backgroundColor: PRColors.white, marginTop: 12 },
  deviceCard: { borderWidth: 1, borderColor: PRColors.stone, borderRadius: 12, padding: 12, backgroundColor: PRColors.white, marginBottom: 8, gap: 2 },
  kv: { color: PRColors.graphite, fontSize: 13 },
  k: { color: PRColors.slate, fontWeight: '700' },
});
