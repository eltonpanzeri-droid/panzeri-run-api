// metro.config.js
//
// Contexto: monorepo pnpm + Expo. O pnpm armazena dependencias em
// node_modules/.pnpm usando junctions (symlinks no Windows). O Metro nao segue
// junctions corretamente por padrao: ao resolver 'react' ou 'react-dom' de dentro
// de um pacote no .pnpm, ele pode criar um modulo com ID diferente do que o App
// importou diretamente, resultando em duas instancias distintas no bundle e
// "Invalid hook call" / "Cannot read properties of null (reading 'useState')".
//
// A correcao abaixo:
// 1. Adiciona watchFolders com a raiz do monorepo para Metro enxergar a estrutura
//    completa de node_modules e resolver junctions corretamente.
// 2. Define nodeModulesPaths com ordem explicita (mobile primeiro, raiz segundo)
//    para evitar ambiguidade de resolucao em pacotes hoisted.
// 3. Usa resolveRequest para forcar 'react' e 'react-dom' a resolverem sempre
//    para a instancia de apps/mobile/node_modules, independente de qual arquivo
//    (incluindo arquivos dentro de .pnpm) esta importando.
//
// Referencia: https://docs.expo.dev/guides/monorepos/

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
// Raiz do monorepo (dois niveis acima de apps/mobile)
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Permite Metro ver todos os arquivos do monorepo, incluindo o .pnpm store
config.watchFolders = [monorepoRoot];

// 2. Ordem de resolucao: mobile primeiro (dependencias locais), raiz depois (hoisted)
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// 3. Instancia unica de React e React DOM para todo o bundle.
// Sem isso, arquivos dentro do .pnpm podem receber um modulo com ID diferente
// mesmo que o arquivo fisico seja o mesmo, quebrando os hooks do React.
const reactPath = path.resolve(projectRoot, 'node_modules/react');
const reactDomPath = path.resolve(projectRoot, 'node_modules/react-dom');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react') {
    return { type: 'sourceFile', filePath: require.resolve(reactPath) };
  }
  if (moduleName === 'react-dom' || moduleName === 'react-dom/client' || moduleName === 'react-dom/server') {
    const subPath = moduleName.includes('/') ? moduleName.split('/').slice(1).join('/') : '';
    const targetPath = subPath
      ? path.resolve(reactDomPath, subPath)
      : reactDomPath;
    return { type: 'sourceFile', filePath: require.resolve(targetPath) };
  }
  // Delegacao padrao para todos os outros modulos
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
