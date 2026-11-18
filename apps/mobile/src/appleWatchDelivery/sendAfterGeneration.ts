import AsyncStorage from '@react-native-async-storage/async-storage';
import { isAppleHealthSupported } from '../../modules/panzeri-apple-health/src';
import { AUTO_SEND_STORAGE_KEY, syncSummaryMessage } from './autoSendWeekToAppleWatch';
import { makeWatchCall, syncWeekToAppleWatch } from './syncWeekNow';
import { withWatchSendLock } from './watchSendLock';

// Envio ao Apple Watch LOGO QUE A GERACAO TERMINA (18/11/2026, caso Volnei; ordem de Elton): a aluna so' gera o treino com o Panzeri Run aberto, entao o envio nao pode esperar outra abertura.
// Chamado pela tela da semana quando a geracao acaba com sucesso. Mesmas regras de seguranca do envio automatico: so' depois de um envio manual bem-sucedido (permissao do iPhone ja dada), a API decide o
// que e' elegivel, nada ja enviado e' reenviado. Diferente do envio da abertura, o RESULTADO aparece para a aluna (antes falhas eram silenciosas).

export const WATCH_AFTER_GENERATION_FAILED = 'Seu treino está pronto, mas não consegui enviá-lo ao Apple Watch agora. Abra Dispositivos e integrações > Apple Watch e toque em "Sincronizar envio de treinos ao relógio".';

// Devolve o texto para mostrar a aluna, ou null quando nao ha nada a dizer (nao usa Apple Watch, nada novo a enviar).
export async function sendWeekAfterGeneration(apiUrl: string, accessToken: string): Promise<string | null> {
  if (!isAppleHealthSupported) return null;
  try {
    if ((await AsyncStorage.getItem(AUTO_SEND_STORAGE_KEY)) !== '1') return null;
  } catch {
    return null;
  }
  try {
    const summary = await withWatchSendLock(() => syncWeekToAppleWatch(makeWatchCall(apiUrl, accessToken)));
    if (summary.stoppedReason || summary.failed > 0) return `Seu treino está pronto. ${syncSummaryMessage(summary)} Se algum treino não chegar, toque em "Sincronizar envio de treinos ao relógio" em Dispositivos e integrações > Apple Watch.`;
    if (summary.sent > 0) return `Seu treino da semana está pronto e ${summary.sent} treino(s) já seguiram para o Apple Watch. Confira no relógio.`;
    return null;
  } catch {
    return WATCH_AFTER_GENERATION_FAILED;
  }
}
