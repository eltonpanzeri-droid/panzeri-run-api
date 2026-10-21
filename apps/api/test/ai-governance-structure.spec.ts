import { readdirSync, readFileSync } from 'fs';
import { join, sep } from 'path';

// Testes ESTRUTURAIS da governanca de dados para IA (Central Universal, Lote 1): garantem, lendo o proprio codigo, que nenhum caminho novo ou esquecido leva
// dado de provedor nao autorizado a um agente. Se um destes testes quebrar, a causa e' um caminho que escapou da regra — nao um teste a "ajustar".
const SRC = join(__dirname, '..', 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
const norm = (path: string) => path.split(sep).join('/');
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}
const allFiles = walk(SRC);

describe('todo envio a fornecedor externo de IA passa pela fila unica, que declara o agente', () => {
  it('chamadas ao SDK da Anthropic existem SO nos 4 servicos de agente conhecidos', () => {
    const callers = allFiles.filter((f) => /\bmessages\.(parse|create|stream)\(/.test(readFileSync(f, 'utf8'))).map((f) => norm(f).split('/src/')[1]);
    expect(callers.sort()).toEqual([
      'reassessment/evolution-agent.service.ts',
      'reporter/student-reporter-agent.service.ts',
      'technical-manager/technical-manager-agent.service.ts',
      'training-plans/prescription-agent.service.ts',
    ]);
    // cliente do SDK so' e' criado por esses mesmos servicos
    const sdk = allFiles.filter((f) => /new Anthropic\(/.test(readFileSync(f, 'utf8'))).map((f) => norm(f).split('/src/')[1]);
    expect(sdk.sort()).toEqual(callers.sort());
  });

  it('cada aiQueue.run(...) informa { agent, deviceData } — o compilador ja exige; aqui conferimos os agentes e a declaracao', () => {
    const declared: Array<{ file: string; agent: string; deviceData: boolean }> = [];
    for (const file of allFiles) {
      const text = readFileSync(file, 'utf8');
      const runs = (text.match(/aiQueue\.run\(/g) ?? []).length;
      if (runs === 0) continue;
      const options = [...text.matchAll(/\{ agent: '([a-z_]+)', deviceData: (true|false) \}/g)];
      expect(options.length).toBe(runs);
      for (const m of options) declared.push({ file: norm(file).split('/src/')[1], agent: m[1], deviceData: m[2] === 'true' });
    }
    expect(declared.map((d) => `${d.agent}:${d.deviceData}`).sort()).toEqual([
      'gerente_tecnico:true', 'prontuario:true', 'prontuario_condensacao:true', 'relator:false', 'treinador_dia_corrida:true', 'treinador_dia_forca:true', 'treinador_semana:true',
    ]);
  });

  it('o unico agente que declara deviceData:false (Relator) nao le NENHUM dado de dispositivo', () => {
    for (const rel of ['reporter/student-reporter-agent.service.ts', 'reporter/report-timeline.service.ts']) {
      expect(read(rel)).not.toMatch(/activityLog|rawActivity|executionLinks|evolutionMetric|athleteState|TrainingIntelligence|ActivityTimeSeries|SessionExecution|trainingAnalysis|WeeklyExecution/i);
    }
  });

  it('a fila de IA exige o guarda: o modulo da fila importa a governanca e a fila chama o guarda ANTES de ocupar vaga', () => {
    expect(read('common/ai-queue.module.ts')).toContain('AiGovernanceModule');
    const queue = read('common/ai-queue.service.ts');
    expect(queue.indexOf('assertDeviceData')).toBeGreaterThan(-1);
    expect(queue.indexOf('assertDeviceData')).toBeLessThan(queue.indexOf('await this.acquire()'));
  });
});

describe('os pontos de entrada que montam contexto para agentes rodam dentro do escopo de IA', () => {
  it('Prescritor (geracao da semana e regeneracao de um dia), reavaliacao e Gerente Tecnico abrem o escopo', () => {
    const plans = read('training-plans/training-plans.service.ts');
    expect(plans).toContain('this.withAiScope(userId, () => this.generateWeekLocked(userId, weeklyOverride, options))');
    expect(plans).toContain('this.withAiScope(userId, () => this.regenerateSessionInner(userId, sessionId, options))');
    expect(read('reassessment/reassessment.service.ts')).toContain('runWithAiScope(aiScope, fn)');
    expect(read('technical-manager/technical-manager-agent.service.ts')).toContain('runWithAiScope(scope, converse)');
  });

  it('os modulos desses servicos importam a governanca (sem ela o escopo nao existiria e as chamadas falhariam fechadas)', () => {
    for (const rel of ['training-plans/training-plans.module.ts', 'reassessment/reassessment.module.ts', 'technical-manager/technical-manager.module.ts']) {
      expect(read(rel)).toContain('AiGovernanceModule');
    }
  });

  it('o Prescritor e o Agente de Evolucao so sao chamados a partir desses pontos de entrada', () => {
    const callers = allFiles.filter((f) => /prescriptionAgent\.(proposeWeeklyDecision|proposeStrengthSession|proposeRunSession)\(|evolutionAgent\.(analyze|condenseProfile)\(/.test(readFileSync(f, 'utf8'))).map((f) => norm(f).split('/src/')[1]);
    expect(callers.sort()).toEqual(['reassessment/reassessment.service.ts', 'training-plans/student-profile.service.ts', 'training-plans/training-plans.service.ts']);
  });
});

describe('todo leitor de ActivityLog dos modulos que alimentam IA aplica o escopo — ou declara, no proprio codigo, por que nao e IA', () => {
  const AI_BOUND = [
    'training-plans/training-plans.service.ts', 'training-plans/training-analyst.service.ts', 'training-intelligence/observation-reader.service.ts',
    'evolution/evolution-metric.service.ts', 'activity-execution/execution-analysis.service.ts', 'training-plans/student-profile.service.ts',
    'training-plans/weekly-checkin.service.ts', 'reassessment/reassessment.service.ts',
  ];
  for (const rel of AI_BOUND) {
    it(`${rel}: cada activityLog.find*/count esta sob aiActivityWhere() / ficou na visao para IA (forAi) ou tem a marca "ai-scope: nao-ia (motivo)"`, () => {
      const text = read(rel);
      const queries = [...text.matchAll(/activityLog\.(findMany|findFirst|findUnique|count|aggregate)\(/g)];
      for (const q of queries) {
        const index = q.index ?? 0;
        const after = text.slice(index, index + 420);
        const before = text.slice(Math.max(0, index - 300), index);
        const ok = after.includes('aiActivityWhere()') || after.includes('forAi') || /ai-scope: nao-ia \(/.test(before);
        if (!ok) throw new Error(`${rel}: consulta a ActivityLog sem escopo de IA nem justificativa perto de: ${text.slice(index, index + 120).replace(/\s+/g, ' ')}`);
      }
    });
  }

  it('a lista de modulos auditados cobre todo arquivo (fora dos de ingestao e dos da propria governanca) que le executionLinks.activityLog para montar contexto de IA', () => {
    // Arquivos que alimentam prompts e leem vinculos com atividade: precisam estar na lista auditada ou ter a marca de justificativa.
    const candidates = allFiles.filter((f) => /executionLinks|activityLog\./.test(readFileSync(f, 'utf8')))
      .map((f) => norm(f).split('/src/')[1])
      .filter((rel) => /^(training-plans|training-intelligence|evolution|reassessment|technical-manager|reporter)\//.test(rel));
    for (const rel of candidates) {
      if (AI_BOUND.includes(rel)) continue;
      const text = read(rel);
      // arquivos de apoio puros (tipos/formatacao) ou que so escrevem; qualquer leitura nova precisa entrar em AI_BOUND ou ser anotada
      const reads = /(activityLog|executionLink)\.(findMany|findFirst|findUnique)\(/.test(text);
      if (reads && !/ai-scope: nao-ia \(/.test(text)) throw new Error(`${rel} le atividades/vinculos mas nao esta na lista auditada nem tem justificativa`);
    }
  });
});

describe('invariantes da trava de envio externo', () => {
  it('a lista de provedores liberados e a trava dupla existem no codigo e a lista so tem a Zepp (liberada em 21/10/2026)', () => {
    const text = read('ai-governance/ai-data-eligibility.service.ts');
    expect(text).toMatch(/export const EXTERNAL_AI_APPROVED_PROVIDERS: readonly string\[\] = \['zepp'\];/);
    expect(text).toContain('_EXTERNAL_AI_ENABLED');
  });

  it('nenhum arquivo de producao define a variavel de liberacao com valor (nem em exemplos)', () => {
    for (const file of allFiles) expect(readFileSync(file, 'utf8')).not.toMatch(/ZEPP_EXTERNAL_AI_ENABLED\s*=\s*['"]?true/i);
  });

  it('o conector Zepp nunca declara a capacidade webhook (o recebimento e o controlador com segredo) e so declara eventos/sync quando recebe os servicos', () => {
    const connector = read('zepp/zepp.connector.ts');
    expect(connector).not.toMatch(/webhook:/);
    expect(connector).toContain('deps.events');
  });
});
