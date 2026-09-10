// metro.config.js
//
// Contexto: monorepo pnpm + Expo + Windows.
//
// PROBLEMA RAIZ (confirmado via analise do bundle):
// O pnpm virtual store contem react@18.3.1 (instalada pelo app admin Next.js).
// O Metro inclui watchFolders=[monorepoRoot], entao enxerga esse store.
// O pacote @expo-google-fonts/big-shoulders-display resolve seu peer 'react'
// para react@18.3.1 (a versao disponivel no store pnpm para esse peer).
// Resultado: bundle contem react@18.3.1 E react@19.1.0 simultaneamente.
// react-dom@19 seta o dispatcher via ReactSharedInternals.H (API do React 19),
// mas o useState() do react@18.3.1 le via ReactCurrentDispatcher (API do React 18),
// que fica null → "Invalid hook call" / "Cannot read properties of null (reading 'useState')".
//
// CORRECAO: resolveRequest intercepta qualquer import de 'react' ou 'react/...'
// e forca resolucao a partir do node_modules do proprio app mobile (react@19.1.0),
// sem importar de qual modulo do pnpm store veio a chamada.
//
// watchFolders e nodeModulesPaths garantem que Metro enxerga o store
// do pnpm e resolve dependencias na ordem correta (mobile > raiz do monorepo).

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Permite Metro ver todos os arquivos do monorepo, incluindo o .pnpm store
config.watchFolders = [monorepoRoot];

// Ordem de resolucao: mobile primeiro, raiz do monorepo depois
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// Segue junctions do Windows (equivalentes a symlinks no pnpm)
config.resolver.unstable_enableSymlinks = true;

// CORRECAO PRINCIPAL: forca todo require('react') / require('react/...') a resolver
// pelo node_modules do app mobile (react@19.1.0), impedindo que o react@18.3.1
// do pnpm store (peer do @expo-google-fonts) entre no bundle.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react' || moduleName.startsWith('react/')) {
    return {
      filePath: require.resolve(moduleName, { paths: [projectRoot] }),
      type: 'sourceFile',
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
