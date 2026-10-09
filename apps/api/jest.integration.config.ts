import type { Config } from 'jest';

// Testes de integracao com PostgreSQL local de teste (ver test/integration/pg-guard.ts). Separados da suite padrao.
const config: Config = {
  preset: 'ts-jest',
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: { types: ['node', 'jest'] } }] },
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: '.*\\.int\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testTimeout: 180_000,
  maxWorkers: 1,
};

export default config;
