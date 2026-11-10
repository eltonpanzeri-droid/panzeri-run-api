import AsyncStorage from '@react-native-async-storage/async-storage';

// (10/11/2026, decisao de Elton de 31/10) As autorizacoes do envio de treinos ao relogio e da analise por IA (Atlas) sao pedidas NA MESMA TELA da conexao, desmarcadas, cada uma com o texto e a versao
// proprios. O servidor so' aceita conceder essas finalidades DEPOIS de conectada a conta (cada uma sobre o proprio texto), entao a escolha da aluna fica guardada no aparelho enquanto ela autoriza no site do
// fabricante e e' enviada, uma por vez, assim que a conexao aparece como ativa. Nada e' concedido sem o aceite marcado na tela; escolha antiga (mais de 2 horas) e' descartada.
const TTL_MS = 2 * 60 * 60 * 1000;
const key = (provider: string) => `pr:pendingPurposeGrants:${provider}`;

export async function savePendingPurposeGrants(provider: string, ids: string[]): Promise<void> {
  try {
    if (ids.length === 0) await AsyncStorage.removeItem(key(provider));
    else await AsyncStorage.setItem(key(provider), JSON.stringify({ ids, at: Date.now() }));
  } catch { /* sem armazenamento: a aluna autoriza depois, na tela da propria autorizacao */ }
}

export async function takePendingPurposeGrants(provider: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(key(provider));
    if (!raw) return [];
    await AsyncStorage.removeItem(key(provider));
    const parsed = JSON.parse(raw) as { ids?: unknown; at?: unknown };
    if (!Array.isArray(parsed.ids) || typeof parsed.at !== 'number' || Date.now() - parsed.at > TTL_MS) return [];
    return parsed.ids.filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}
