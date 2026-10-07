// SONDA NATIVA (Etapa 6, temporaria): os tres specs abaixo sao a SAIDA REAL do tradutor Apple da API para os tres casos de referencia (continuo,
// intervalado e misto) — gerados pelo proprio tradutor e protegidos por um teste que compara com ele (test/apple-custom-workout-probe.spec.ts).
// Servem so' para executar validateCustomWorkoutSpec no iPhone real. Nao ha caminho de producao que use este arquivo.
import type { AppleCustomWorkoutSpecJson } from './customWorkoutBridge';

export interface CustomWorkoutProbeCase {
  key: string;
  title: string;
  // O que a sonda quer descobrir neste caso.
  note: string;
  spec: AppleCustomWorkoutSpecJson;
}

export const CUSTOM_WORKOUT_PROBE_CASES: CustomWorkoutProbeCase[] = [
  {
    key: 'continuo',
    title: '1. Contínuo: 1 × [work 8000 m]',
    note: 'IntervalBlock com UM único passo work (o ponto que a Apple não documenta).',
    spec: {
      specVersion: 1,
      translatorVersion: 1,
      activity: 'running',
      location: 'outdoor',
      warmup: null,
      cooldown: null,
      blocks: [{ iterations: 1, steps: [{ purpose: 'work', goal: { type: 'distance', meters: 8000 } }] }],
      source: { canonicalSchemaVersion: 1, trainingSessionId: 'sonda-continuo' },
      specHash: '08438917de343a36c4fec8ba2d7f8ff2df67fb7edd98d8a9dea91616e13dc50c',
    },
  },
  {
    key: 'intervalado',
    title: '2. Intervalado: 6 × [work 400 m, recovery 200 m]',
    note: 'IntervalBlock com work + recovery e 6 iterações.',
    spec: {
      specVersion: 1,
      translatorVersion: 1,
      activity: 'running',
      location: 'outdoor',
      warmup: null,
      cooldown: null,
      blocks: [
        {
          iterations: 6,
          steps: [
            { purpose: 'work', goal: { type: 'distance', meters: 400 } },
            { purpose: 'recovery', goal: { type: 'distance', meters: 200 } },
          ],
        },
      ],
      source: { canonicalSchemaVersion: 1, trainingSessionId: 'sonda-intervalado' },
      specHash: 'ecd918d0d39a2cd31c47dffe17c3f6956d73149e84f7c7084d123738bbabcfb1',
    },
  },
  {
    key: 'misto',
    title: '3. Misto: 1×[work 2000] → 5×[work 1000, recovery 400] → 1×[work 2000]',
    note: 'Três blocos em sequência, dois deles com um único passo work.',
    spec: {
      specVersion: 1,
      translatorVersion: 1,
      activity: 'running',
      location: 'outdoor',
      warmup: null,
      cooldown: null,
      blocks: [
        { iterations: 1, steps: [{ purpose: 'work', goal: { type: 'distance', meters: 2000 } }] },
        {
          iterations: 5,
          steps: [
            { purpose: 'work', goal: { type: 'distance', meters: 1000 } },
            { purpose: 'recovery', goal: { type: 'distance', meters: 400 } },
          ],
        },
        { iterations: 1, steps: [{ purpose: 'work', goal: { type: 'distance', meters: 2000 } }] },
      ],
      source: { canonicalSchemaVersion: 1, trainingSessionId: 'sonda-misto' },
      specHash: 'bd7b3f52d8cbcea2d359cc583824c89c2d011764d41bb321bbd4aef045df2da9',
    },
  },
];
