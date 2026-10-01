/* Offline regression: starts a disposable Next app, mocks every API call, never uses a real session.
 * Run: node apps/admin/app/ti/tests/regression.cjs
 * Set PLAYWRIGHT_MODULE to a local playwright package if it is not installed in the runtime bundle.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const admin = path.resolve(root, '../..');
const ts = require(require.resolve('typescript', { paths: [path.resolve(admin, '../..')] }));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'panzeri-ti-test-'));
const artifacts = path.join(temp, 'artifacts');
fs.mkdirSync(artifacts);
const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'data.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const dataModule = { exports: {} };
new Function('module', 'exports', compiled)(dataModule, dataModule.exports);
const data = dataModule.exports;
const continuous = { dataType: 'numeric_continuous', scale: { min: 0, max: 200 } };
const volumeAxis = data.chartAxis(continuous, [6, 50.2, 54.4], true);
assert(volumeAxis.ticks[1] - volumeAxis.ticks[0] <= 5, 'Volume divisions are fine enough to read');
assert(data.chartAxis(continuous, [3], true).max < 5, 'Small volume remains readable');
assert(data.chartAxis(continuous, [6, 50.2, 54.4], true).max < 100, 'Volume uses observed extent');
const signed = data.chartAxis({ ...continuous, scale: { min: -100, max: 100 } }, [-44.7, 10.5], true);
assert(signed.min <= -44.7 && signed.max >= 10.5 && signed.ticks.includes(0));
assert.equal(data.chartAxis(continuous, [3], true, true).max, 200);
assert(data.chartAxis({ dataType: 'numeric_continuous', scale: { min: 0, max: 100, unit: '%' } }, [76, 88, 100], false).max >= 100);
assert(data.chartAxis({ dataType: 'numeric_continuous', scale: { min: 0, max: 3 } }, [0.8, 0.9, 1.1], false).max < 2);
assert.deepEqual(data.chartAxis({ dataType: 'ordinal_scale', scale: { min: 1, max: 5 } }, [1], false).ticks, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);
assert.deepEqual(data.chartViews({ domain: 'training_load', scale: { unit: 'km' } }), ['mixed', 'bars', 'line', 'points']);
assert.deepEqual(data.chartViews({ domain: 'sleep', scale: { min: 1, max: 5 } }), ['line', 'points']);
assert.deepEqual(data.customPeriodRange({ mode: 'dates', start: '2026-08-01', end: '2026-09-30' }, Date.UTC(2026, 8, 30)), [Date.UTC(2026, 7, 1), Date.UTC(2026, 8, 30)]);
assert.deepEqual(data.customPeriodRange({ mode: 'month', month: '2026-08' }, Date.UTC(2026, 8, 30)), [Date.UTC(2026, 7, 1), Date.UTC(2026, 7, 31)]);
assert.deepEqual(data.customPeriodRange({ mode: 'monthRange', start: '2026-05', end: '2026-09' }, Date.UTC(2026, 8, 30)), [Date.UTC(2026, 4, 1), Date.UTC(2026, 8, 30)]);
assert.equal(data.customPeriodRange({ mode: 'dates', start: '2026-09-30', end: '2026-08-01' }), null);
assert.equal(data.customPeriodRange({ mode: 'weeks', count: 8 }, Date.UTC(2026, 8, 30))[0], Date.UTC(2026, 8, 30) - 55 * 86400000);
assert.deepEqual(data.clampWindow([10, 20], [1, 5]), [10, 20], 'Removing a series must not invert the visible date range');
assert.deepEqual(data.clampWindow([10, 20], [15, 25]), [15, 20]);
const people = [{ id: 'fixture-empty', name: 'Aluno sem dados · TESTE', studentCode: 26 }, { id: 'fixture-athlete', name: 'Atleta de teste · DADOS SINTÉTICOS', studentCode: 3 }];
assert.deepEqual(data.matchingStudents(people, 'atleta').map((person) => person.id), ['fixture-athlete'], 'Search shows only matching students');
const today = data.time(new Date().toISOString());
const date = (offset) => new Date(today - offset * 86400000).toISOString();
const definitions = [
  { id: 'training.volumeCompletedTotalKm', domain: 'training_load', constructLabel: 'Volume realizado', dataType: 'numeric_continuous', scale: { min: 0, max: 100, unit: 'km' } },
  { id: 'training.volumeCompletedPrescribedOnlyKm', domain: 'training_load', constructLabel: 'Volume realizado (só sessões prescritas)', dataType: 'numeric_continuous', scale: { min: 0, max: 100, unit: 'km' } },
  { id: 'training.volumePrescribedKm', domain: 'training_load', constructLabel: 'Volume prescrito', dataType: 'numeric_continuous', scale: { min: 0, max: 100, unit: 'km' } },
  { id: 'training.adherencePercent', domain: 'training_load', constructLabel: 'Aderência semanal', dataType: 'numeric_continuous', scale: { min: 0, max: 100, unit: '%' } },
  { id: 'training.acwr', domain: 'training_load', constructLabel: 'ACWR', dataType: 'numeric_continuous', scale: { min: 0, max: 3 } },
  { id: 'training.volumeDiffAbsoluteKm', domain: 'training_load', constructLabel: 'Diferença realizado menos prescrito', dataType: 'numeric_continuous', scale: { min: -100, max: 100, unit: 'km' } },
  { id: 'workout.preSleepQuality', domain: 'sleep', constructLabel: 'Qualidade do sono', dataType: 'ordinal_scale', scale: { min: 1, max: 5 } },
  { id: 'workout.rpe', domain: 'training_response', constructLabel: 'Percepção de esforço (RPE)', dataType: 'ordinal_scale', scale: { min: 1, max: 10 } },
  { id: 'workout.painFlag', domain: 'pain_health', constructLabel: 'Dor relatada', dataType: 'categorical' },
].map((v) => ({ ...v, direction: 'higher_is_more_of_construct' }));
function fixture(id, student, modality) {
  const variable = definitions.find((v) => v.id === id);
  const categorical = variable.dataType === 'categorical';
  const observations = student === 'fixture-empty' ? [] : Array.from({ length: 24 }, (_, i) => ({ timestamp: date(48 - i * 2), value: categorical ? ['leve', 'moderado'][i % 2] : id === 'training.volumeDiffAbsoluteKm' ? i === 23 ? -44.7 : i % 2 ? -5 : 10.5 : id === 'training.acwr' ? 0.8 + i % 4 * 0.1 : id === 'training.adherencePercent' ? 76 + i % 5 * 6 : id.startsWith('training') ? 25 + i % 8 * 4 : id.endsWith('rpe') ? 4 + i % 5 : 1 + i % 4, context: { modality: modality || 'corrida', isPartialWeek: id.startsWith('training') && i === 23 } }));
  if (observations.length && !categorical) observations.push({ timestamp: observations.at(-1).timestamp, value: id === 'training.volumeDiffAbsoluteKm' ? -12 : id === 'training.acwr' ? 0.9 : id === 'training.adherencePercent' ? 90 : id.startsWith('training') ? 12 : 1, context: { modality: modality || 'forca', sessionId: 'second-session-same-day' } });
  const series = observations.map((o) => ({ timestamp: o.timestamp, value: id.startsWith('training') ? 38.588235 : 2.588235, isPartialWindow: true }));
  return { variable, mathApplicable: !categorical, current: observations.length && !categorical ? observations.at(-1).value : null, mean: null, movingAverages: { short_21d: { value: 2.588235, n: 12, isPartialWindow: true } }, movingAverageSeries: categorical ? null : { short_21d: series }, baseline: observations.length && !categorical ? { value: 2.812345, n: 24, isPartialWindow: true } : null, habitualRange: categorical ? null : { lower: 2, upper: 4, median: 3, n: 24, isPartialWindow: true }, trend: { short_21d: { direction: 'stable', n: 12, slopePerDay: 0 } }, availableModalities: ['corrida', 'forca'], observations, evidence: { n: observations.length, observedSpan: { from: observations[0]?.timestamp ?? null, to: observations.at(-1)?.timestamp ?? null }, lastObservationAt: observations.at(-1)?.timestamp ?? null, instrumentVersions: [2], comparabilityWarning: null } };
}
const sample = fixture('workout.preSleepQuality', 'fixture-athlete', '');
assert.equal(data.observationsAt(sample, data.dateKey(sample.observations.at(-1).timestamp)).length, 2, 'Same-day observations must not collapse');
assert.equal(sample.movingAverageSeries.short_21d[0].value, 2.588235, 'Canonical precision is preserved');
assert.equal(data.fmt(2.588235), '2,6');
assert.equal(data.snapshotIsValid({}, 'workout.preSleepQuality'), false);
assert.equal(data.snapshotIsValid(sample, 'workout.preSleepQuality'), true);
const contextEvent = { id: 'synthetic-event', type: 'work', subtype: null, startedAt: date(70), endedAt: date(1), reportedAt: date(69), status: 'resolved', source: 'student_reported', originalText: 'RELATO SINTÉTICO PARA TESTE: semana de trabalho intensa.' };
assert(data.eventOverlaps(contextEvent, [today - 30 * 86400000, today]), 'Events overlapping the range must not disappear');
console.log('PASS display adapter regressions');

fs.mkdirSync(path.join(temp, 'app', 'ti'), { recursive: true });
for (const name of ['studio.tsx', 'data.ts', 'longitudinal-chart.tsx', 'studio.css']) fs.copyFileSync(path.join(root, name), path.join(temp, 'app', 'ti', name));
// The production studio lives inside the Admin tab. This disposable page keeps its
// component-level regression independent from the Admin login flow.
fs.writeFileSync(path.join(temp, 'app', 'ti', 'page.tsx'), "import TrainingIntelligenceStudio from './studio'; export default function Page() { return <TrainingIntelligenceStudio />; }");
fs.copyFileSync(path.join(admin, 'app', 'styles.css'), path.join(temp, 'app', 'styles.css'));
fs.writeFileSync(path.join(temp, 'app', 'layout.tsx'), "import './styles.css'; export default function Layout({children}:{children:React.ReactNode}) { return <html lang=\"pt-BR\"><body>{children}</body></html>; }");
fs.writeFileSync(path.join(temp, 'package.json'), JSON.stringify({ name: 'ti-offline-regression', private: true, version: '1.0.0' }));
fs.writeFileSync(path.join(temp, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', jsx: 'preserve', moduleResolution: 'node', module: 'esnext', esModuleInterop: true, skipLibCheck: true, strict: true }, include: ['app/**/*.tsx', 'app/**/*.ts'] }));
fs.writeFileSync(path.join(temp, 'next.config.mjs'), 'export default { reactStrictMode: true };');
for (const pkg of ['next', 'react', 'react-dom', 'lucide-react', 'typescript', '@types/react', '@types/node']) {
  const location = path.dirname(require.resolve(`${pkg}/package.json`, { paths: pkg === 'typescript' ? [path.resolve(admin, '../..')] : [admin, process.cwd()] }));
  const target = path.join(temp, 'node_modules', pkg);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.symlinkSync(location, target, 'junction');
}
const nextBin = require.resolve('next/dist/bin/next', { paths: [admin] });
const log = fs.openSync(path.join(temp, 'next.log'), 'w');
const server = spawn(process.execPath, [nextBin, 'dev', temp, '-p', '3187', '-H', '127.0.0.1'], { cwd: temp, stdio: ['ignore', log, log], windowsHide: true, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
let browser;
(async () => {
  const playwrightPath = process.env.PLAYWRIGHT_MODULE || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const { chromium } = require(playwrightPath);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let eventFails = false;
  const requests = [];
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname !== new URL(data.API_URL).hostname) return route.abort();
    assert.equal(route.request().method(), 'GET', 'Validation must never write to an API');
    requests.push(url.pathname);
    let body;
    if (url.pathname.endsWith('students-list')) body = people;
    else if (url.pathname.endsWith('variable-legend')) body = definitions;
    else if (url.pathname.endsWith('context-events')) {
      if (eventFails) return route.fulfill({ status: 503, body: 'unavailable', headers: { 'Access-Control-Allow-Origin': '*' } });
      body = url.pathname.includes('fixture-athlete') ? [contextEvent] : [];
    } else if (url.pathname.includes('/observations/')) body = fixture(decodeURIComponent(url.pathname.split('/').at(-1)), url.pathname.split('/')[3], url.searchParams.get('modalities'));
    else return route.abort();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body), headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.addInitScript(() => localStorage.setItem('panzeri_admin_token', 'OFFLINE-FIXTURE-NOT-A-REAL-TOKEN'));
  const base = 'http://127.0.0.1:3187/ti';
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((resolve) => setTimeout(resolve, 500)); }
  await page.goto(base, { waitUntil: 'load', timeout: 90000 });
  await page.getByRole('heading', { name: people[0].name, exact: true }).waitFor({ timeout: 60000 });
  await page.getByLabel('Buscar aluno', { exact: true }).fill('atleta');
  await page.getByRole('heading', { name: people[1].name, exact: true }).waitFor();
  assert.equal(await page.getByLabel('Aluno', { exact: true }).inputValue(), 'fixture-athlete');
  assert.equal(await page.getByLabel('Aluno', { exact: true }).locator('option').count(), 1);
  await page.locator('[data-variable="workout.preSleepQuality"] [data-observation]').first().waitFor();
  assert.equal(await page.locator('[data-variable="workout.preSleepQuality"] [data-observation]').count(), 25);
  assert((await page.locator('[data-variable="workout.preSleepQuality"]').innerText()).includes('1,5'));
  const sleepPanel = page.locator('[data-variable="workout.preSleepQuality"]');
  assert(await sleepPanel.locator('[data-grid-axis="x"]').count() >= 3, 'Vertical grid is present by default');
  assert.equal(await sleepPanel.locator('[data-grid-axis="y"]').count(), 11, 'Every 0.5 scale tick has a horizontal grid line');
  console.log('PASS student identity, requests and complete same-day SVG series');
  await page.getByRole('button', { name: 'Indicador', exact: true }).first().click();
  await page.getByLabel('Buscar indicador', { exact: true }).fill('RPE');
  await page.getByRole('button', { name: /Percepção de esforço/ }).click();
  await page.getByRole('button', { name: 'Investigar', exact: true }).click();
  await page.locator('[data-variable="workout.rpe"] [data-observation]').first().waitFor();
  await page.getByRole('button', { name: 'Comparar', exact: true }).first().click();
  await page.getByLabel('Comparar modalidade de Qualidade do sono', { exact: true }).selectOption('forca');
  await page.locator('[data-variable="workout.preSleepQuality"]').nth(1).waitFor();
  await page.getByLabel('Data de Qualidade do sono', { exact: true }).selectOption(data.dateKey(sample.observations.at(-1).timestamp));
  await page.getByText('Camadas em todos', { exact: true }).click();
  await page.getByRole('button', { name: 'Baseline', exact: true }).click();
  await page.getByRole('button', { name: 'MM60', exact: true }).click();
  await page.getByRole('button', { name: '30 dias', exact: true }).click();
  await page.getByRole('button', { name: 'Tudo', exact: true }).click();
  await page.getByLabel('Início da janela', { exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Restaurar período', exact: true }).click();
  console.log('PASS progressive indicators, modality comparison, cursor, layers and shared zoom');
  await page.getByRole('button', { name: 'Sobrepor compatíveis', exact: true }).click();
  await page.locator('[data-comparison="workout.preSleepQuality"]').waitFor();
  assert.equal(await page.locator('[data-variable="workout.preSleepQuality"]').count(), 1);
  assert(await page.locator('[data-variable="workout.rpe"]').count(), 'Incompatible units remain separate');
  await page.getByLabel('Data de Qualidade do sono', { exact: true }).selectOption(data.dateKey(sample.observations.at(-1).timestamp));
  assert(await page.locator('[data-value-label]').count(), 'Values are labeled on the graph');
  await page.getByRole('button', { name: 'Sobrepor compatíveis', exact: true }).click();
  console.log('PASS compatible overlay, separate incompatible panel and value labels');
  await page.getByRole('button', { name: 'Indicador', exact: true }).first().click();
  await page.getByLabel('Buscar indicador', { exact: true }).fill('prescrito');
  await page.getByRole('button', { name: /Volume prescrito/ }).click();
  await page.getByRole('button', { name: 'Investigar', exact: true }).click();
  await page.locator('[data-variable="training.volumePrescribedKm"] [data-observation]').first().waitFor();
  await page.getByRole('button', { name: 'Sobrepor compatíveis', exact: true }).click();
  const volumePanel = page.locator('[data-variable="training.volumeCompletedTotalKm"]');
  await volumePanel.locator('summary', { hasText: 'Configurar gráfico' }).click();
  const prescribedToggle = volumePanel.getByRole('checkbox', { name: 'Volume prescrito em Volume realizado' });
  await prescribedToggle.check();
  await volumePanel.locator('[data-comparison="training.volumePrescribedKm"]').waitFor();
  assert((await volumePanel.locator('.ti-chart-legend').innerText()).includes('Volume prescrito'));
  assert((await volumePanel.locator('[data-raw-bar] title').first().textContent()).includes('Volume prescrito'), 'Tooltip follows selected layers');
  await prescribedToggle.uncheck();
  assert.equal(await volumePanel.locator('[data-comparison="training.volumePrescribedKm"]').count(), 0);
  assert(!(await volumePanel.locator('[data-raw-bar] title').first().textContent()).includes('Volume prescrito'));
  await prescribedToggle.check();
  await volumePanel.getByLabel('Visualização de Volume realizado').selectOption('bars');
  assert.equal(await volumePanel.locator('[data-raw-line]').count(), 0);
  assert(await volumePanel.locator('[data-raw-bar]').count());
  await volumePanel.getByLabel('Visualização de Volume realizado').selectOption('line');
  assert(await volumePanel.locator('[data-raw-line]').count());
  assert.equal(await volumePanel.locator('[data-raw-bar]').count(), 0);
  await volumePanel.getByLabel('Visualização de Volume realizado').selectOption('points');
  assert.equal(await volumePanel.locator('[data-raw-line]').count(), 0);
  await volumePanel.getByLabel('Visualização de Volume realizado').selectOption('mixed');
  assert(await volumePanel.locator('[data-raw-line]').count() && await volumePanel.locator('[data-raw-bar]').count());
  await volumePanel.getByLabel('Rótulos de Volume realizado').selectOption('off');
  assert.equal(await volumePanel.locator('[data-value-label]').count(), 0);
  await volumePanel.getByLabel('Rótulos de Volume realizado').selectOption('raw');
  await page.getByLabel('Data de Volume realizado').selectOption(data.dateKey(sample.observations.at(-1).timestamp));
  assert(await volumePanel.locator('[data-value-label]').count());
  await volumePanel.getByLabel('Rótulos de Volume realizado').selectOption('average');
  assert(await volumePanel.locator('svg text').filter({ hasText: '38,6' }).count());
  await volumePanel.getByLabel('Rótulos de Volume realizado').selectOption('both');
  assert(await volumePanel.locator('[data-value-label]').count());
  const rawToggle = volumePanel.locator('.ti-settings-grid fieldset label').filter({ hasText: 'Bruto' }).locator('input');
  await rawToggle.uncheck();
  assert.equal(await volumePanel.locator('[data-raw-bar]').count(), 0);
  assert(await volumePanel.locator('[data-comparison="training.volumePrescribedKm"]').count(), 'Prescribed layer does not depend on raw');
  await rawToggle.check();
  assert(await volumePanel.locator('[data-raw-bar]').count());
  const mmToggle = volumePanel.locator('.ti-settings-grid fieldset label').filter({ hasText: 'MM21' }).locator('input');
  await mmToggle.uncheck();
  assert.equal(await volumePanel.locator('[data-derived="short_21d"]').count(), 0);
  await mmToggle.check();
  assert(await volumePanel.locator('[data-derived="short_21d"]').count());
  const habitualToggle = volumePanel.locator('.ti-settings-grid fieldset label').filter({ hasText: 'Faixa habitual' }).locator('input');
  await habitualToggle.uncheck();
  await habitualToggle.check();
  const baselineToggle = volumePanel.locator('.ti-settings-grid fieldset label').filter({ hasText: 'Baseline' }).locator('input');
  await baselineToggle.uncheck();
  await baselineToggle.check();
  const trendToggle = volumePanel.getByRole('checkbox', { name: 'Tendência em Volume realizado' });
  await trendToggle.uncheck();
  assert.equal(await volumePanel.locator('[data-trend-label]').count(), 0);
  await trendToggle.check();
  assert.equal(await volumePanel.locator('[data-trend-label]').count(), 1);
  const mm60Toggle = volumePanel.getByRole('checkbox', { name: 'MM60 em Volume realizado' });
  assert((await mm60Toggle.locator('..').innerText()).includes('Indisponível'));
  await mm60Toggle.check();
  assert((await volumePanel.locator('.ti-chart-legend').innerText()).includes('MM60'));
  await volumePanel.getByRole('button', { name: 'Restaurar padrão' }).click();
  console.log('PASS prescribed/completed overlay, chart views, labels and per-chart layers');
  await page.getByRole('button', { name: 'Personalizar', exact: true }).click();
  await page.getByLabel('Data inicial').fill(date(30).slice(0, 10));
  await page.getByLabel('Data final').fill(date(10).slice(0, 10));
  await page.getByRole('button', { name: 'Aplicar período' }).click();
  assert((await page.locator('#ti-charts .ti-section-head').innerText()).includes(data.dateLabel(date(30), true)));
  assert.equal(await page.getByRole('button', { name: 'Focar dados' }).getAttribute('aria-pressed'), 'false');
  await page.locator('.ti-periods button').last().click();
  await page.getByLabel('Tipo de período').selectOption('weeks');
  await page.getByLabel('Quantidade de períodos').fill('8');
  await page.getByRole('button', { name: 'Aplicar período' }).click();
  await page.locator('.ti-periods button').last().click();
  await page.getByLabel('Tipo de período').selectOption('monthRange');
  await page.getByLabel('Mês inicial').fill('2026-05');
  await page.getByLabel('Mês final').fill('2026-09');
  await page.getByRole('button', { name: 'Aplicar período' }).click();
  assert((await page.locator('#ti-charts .ti-section-head').innerText()).includes('01/05/2026'));
  console.log('PASS custom dates and relative weeks update shared panels');
  await page.getByRole('button', { name: 'Evento', exact: true }).first().click();
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await page.getByRole('button', { name: 'Timeline', exact: true }).first().click();
  await page.locator('.ti-timeline-item').first().click();
  assert((await page.locator('.ti-event-detail').innerText()).includes('RELATO SINTÉTICO'));
  console.log('PASS existing events, original report and source attribution');
  await page.getByRole('button', { name: 'Visão geral', exact: true }).first().click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(artifacts, 'desktop-light.png'), fullPage: true });
  await page.getByLabel('Tema', { exact: true }).selectOption('dark');
  assert(await sleepPanel.locator('[data-grid-axis="x"]').count() >= 3);
  assert.equal(await sleepPanel.locator('[data-grid-axis="y"]').count(), 11);
  await page.screenshot({ path: path.join(artifacts, 'desktop-dark.png'), fullPage: true });
  await page.getByLabel('Tema', { exact: true }).selectOption('softblue');
  assert(await sleepPanel.locator('[data-grid-axis="x"]').count() >= 3);
  assert.equal(await page.locator('.ti-app').evaluate((el) => getComputedStyle(el).getPropertyValue('--ti-bg').trim()), '#eaf2fa');
  await page.reload();
  await page.getByLabel('Tema', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Tema', { exact: true }).inputValue(), 'softblue');
  await page.locator('[data-variable="training.volumeCompletedTotalKm"] .ti-chart-empty').waitFor();
  await page.getByLabel('Aluno', { exact: true }).selectOption('fixture-athlete');
  await page.locator('[data-variable="training.volumeCompletedTotalKm"] [data-observation]').first().waitFor();
  await page.getByLabel('Tema', { exact: true }).selectOption('graphite');
  assert.equal(await page.locator('.ti-app').evaluate((el) => getComputedStyle(el).getPropertyValue('--ti-bg').trim()), '#242e39');
  await page.getByLabel('Tema', { exact: true }).selectOption('system');
  await page.emulateMedia({ colorScheme: 'dark' });
  assert.equal(await page.locator('.ti-app').evaluate((el) => getComputedStyle(el).getPropertyValue('--ti-bg').trim()), '#071627');
  await page.emulateMedia({ colorScheme: 'light' });
  assert.equal(await page.locator('.ti-app').evaluate((el) => getComputedStyle(el).getPropertyValue('--ti-bg').trim()), '#f4f7fb');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No horizontal page overflow at ${width}px`);
    await page.screenshot({ path: path.join(artifacts, `width-${width}.png`), fullPage: true });
  }
  console.log('PASS five themes, local persistence, system preference and desktop/mobile widths');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Remover Volume realizado', exact: true }).click();
  for (const [query, name] of [
    ['só sessões prescritas', 'Volume realizado (só sessões prescritas)'],
    ['Volume realizado', 'Volume realizado'],
    ['Volume prescrito', 'Volume prescrito'],
  ]) {
    await page.getByRole('button', { name: 'Indicador', exact: true }).first().click();
    await page.getByLabel('Buscar indicador', { exact: true }).fill(query);
    await page.locator('.ti-picker-list button').filter({ has: page.locator('b').getByText(name, { exact: true }) }).click();
    await page.getByRole('button', { name: 'Investigar', exact: true }).click();
  }
  await page.locator('[data-variable="training.volumeCompletedPrescribedOnlyKm"] [data-observation]').first().waitFor();
  await page.getByRole('button', { name: 'Sobrepor compatíveis', exact: true }).click();
  const prescribedOnlyPanel = page.locator('[data-variable="training.volumeCompletedPrescribedOnlyKm"]');
  await prescribedOnlyPanel.locator('[data-comparison="training.volumeCompletedTotalKm"]').waitFor();
  await prescribedOnlyPanel.locator('[data-comparison="training.volumePrescribedKm"]').waitFor();
  assert((await prescribedOnlyPanel.locator('.ti-chart-legend').innerText()).includes('Volume prescrito'));
  console.log('PASS all compatible volume indicators overlay when the first panel is prescribed-session volume');
  eventFails = true;
  await page.getByRole('button', { name: 'Atualizar dados', exact: true }).click();
  await page.getByText('Eventos indisponíveis (503).', { exact: true }).first().waitFor();
  assert.equal(errors.length, 0, errors.join('\n'));
  assert(requests.some((url) => url.includes('fixture-athlete/observations/')));
  console.log('PASS failed event request is not presented as an empty result; no runtime exceptions');
  console.log(`ARTIFACTS ${artifacts}`);
})().catch((error) => { console.error(error); console.error(`Debug artifacts: ${temp}`); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  server.kill();
  fs.closeSync(log);
});
