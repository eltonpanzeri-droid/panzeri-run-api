import { Platform } from 'react-native';

// Testes físicos (30/10/2026): liberado só no PWA por decisão do treinador. Para liberar também nos aplicativos Android e iOS na próxima
// atualização nativa, basta trocar esta linha (por exemplo, para `true`). Nenhuma outra parte do código depende da plataforma.
export const PHYSICAL_TESTS_ENABLED: boolean = Platform.OS === 'web';
