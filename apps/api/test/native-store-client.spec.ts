import { isNativeStoreClient } from '../src/billing/native-store-client';

// Ordem de Elton (09/11/2026): quem compra pelo app da loja paga so' pela loja; o servidor nao cria Asaas para o app nativo.
describe('isNativeStoreClient', () => {
  it('reconhece o app nativo do Android e do iPhone', () => {
    expect(isNativeStoreClient('okhttp/4.12.0')).toBe(true);
    expect(isNativeStoreClient('PanzeriRun/1 CFNetwork/1494.0.7 Darwin/23.4.0')).toBe(true);
  });
  it('PWA, navegador e chamadas sem User-Agent continuam liberados', () => {
    expect(isNativeStoreClient('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1')).toBe(false);
    expect(isNativeStoreClient('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36')).toBe(false);
    expect(isNativeStoreClient(undefined)).toBe(false);
    expect(isNativeStoreClient('')).toBe(false);
  });
});
