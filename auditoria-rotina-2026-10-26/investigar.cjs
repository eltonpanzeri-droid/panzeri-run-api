/* Auditoria: executa trechos REAIS extraidos por AST, sem importar/bootstrapar a API.
 * Persistencia, rede, Telegram e IA sao substituidos por doubles em memoria.
 * Nao abre banco nem le .env. Nao equivale a teste PostgreSQL/HTTP/dispositivo.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = process.argv[2];
if (!root) throw new Error('Informe a arvore de fontes a auditar.');
const ts = require(require.resolve('typescript', { paths: [root] }));
const hashes = {};
function source(rel) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  hashes[rel] = crypto.createHash('sha256').update(text).digest('hex');
  return ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}
function funcs(file) { return file.statements.filter(ts.isFunctionDeclaration).map(n => n.getText(file)).join('\n'); }
function method(file, cls, names) {
  const c = file.statements.find(n => ts.isClassDeclaration(n) && n.name.text === cls);
  return c.members.filter(n => ts.isMethodDeclaration(n) && names.includes(n.name.getText(file))).map(n => n.getText(file)).join('\n');
}
function namedConstants(file, names) {
  return file.statements.filter(ts.isVariableStatement).filter(n => n.declarationList.declarations.some(d => names.includes(d.name.getText(file)))).map(n => n.getText(file)).join('\n');
}
function build(code, globals, expose) {
  const out = ts.transpileModule(code + '\n globalThis.auditExports={' + expose.join(',') + '};', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true }
  }).outputText;
  const context = { exports: {}, ...globals };
  vm.runInNewContext(out, context, { timeout: 3000 });
  return context.auditExports;
}
const clone = x => structuredClone(x);
class BadRequestException extends Error {}
const logger = { log() {}, warn() {}, error() {} };
const meSrc = source('apps/api/src/me/me.service.ts');
const rulesSrc = source('apps/api/src/me/availability.rules.ts');
const coachSrc = source('apps/api/src/coach/coach.service.ts');
const mobileSrc = source('apps/mobile/App.tsx');
const methodologySrc = source('apps/api/src/training-plans/training-methodology.ts');
const planSrc = source('apps/api/src/training-plans/training-plans.service.ts');
const agentSrc = source('apps/api/src/technical-manager/technical-manager-agent.service.ts');
const observationsSrc = source('apps/api/src/observations/observations.service.ts');
const sharedGlobals = { BadRequestException, formatStudentCode: () => 'SINTETICO', hasSubscriptionAccess: () => false, console: { log() {}, warn() {} } };
const meCode = namedConstants(meSrc, ['INTERVIEW_WEEK_DAYS', 'WEEKDAY_TO_INTERVIEW_KEY']) + '\n' + funcs(meSrc) + '\n' + funcs(rulesSrc) + '\nclass MeSubject {' + method(meSrc, 'MeService', ['updateAvailability', 'availability', 'syncAvailabilityFromInterview', 'completeRoutineFromInterview', 'updateAnamnese']) + '}';
const { MeSubject } = build(meCode, sharedGlobals, ['MeSubject']);
const { CoachSubject } = build(funcs(rulesSrc) + '\nclass CoachSubject {' + method(coachSrc, 'CoachService', ['updateStudentAvailability']) + '}', sharedGlobals, ['CoachSubject']);
const { AgentSubject } = build('class AgentSubject {' + method(agentSrc, 'TechnicalManagerAgentService', ['buildTools', 'gatherStudentContext']) + '}', { ...sharedGlobals, stripRoutineKeysFromAnswers: x => x, sanitizeInterviewAnswers: x => x, neutralizeSessionsForAi: x => x }, ['AgentSubject']);
const { ObservationSubject } = build('class ObservationSubject {' + method(observationsSrc, 'ObservationsService', ['create']) + '}', { ...sharedGlobals, STUDENT_REPORT_SOURCE_TYPES: { STUDENT_OBSERVATION: 'student_observation' } }, ['ObservationSubject']);
const { PlanSubject } = build(funcs(planSrc)+'\nclass PlanSubject {'+method(planSrc,'TrainingPlansService',['regenerateSessionInner'])+'}', {
  ...sharedGlobals, InternalServerErrorException: Error, sanitizeInterviewAnswers:x=>x, stripRoutineKeysFromAnswers:x=>x,
  isCurrentlyRunning:()=>false, estimatePaceFromAnswers:()=>null, formatDirectiveForAgent:x=>x,formatObservationForAgent:x=>x, PANZERI_METHODOLOGY_VERSION:'audit-synthetic', buildEvidenceIndex:x=>x, sourceProvidersOf:()=>[]
}, ['PlanSubject']);
const mobile = build(mobileSrc.statements.filter(n=>ts.isFunctionDeclaration(n) && ['routineFromSavedAvailability','routineToAvailability','normalizeModality','labelFromSavedModality'].includes(n.name?.text)).map(n=>n.getText(mobileSrc)).join('\n'), {
  API_URL: 'https://synthetic.invalid', defaultRoutineDays: [1,2,3,4,5,6,0].map(weekday => ({ weekday, label: String(weekday), modalities: ['Sem treinos'], minutesByModality: {} })),
  fetch: async () => { throw new Error('NETWORK_BLOCKED'); }
}, ['routineFromSavedAvailability', 'routineToAvailability', 'normalizeModality']);
const methodology = build(funcs(methodologySrc) + '\n' + namedConstants(methodologySrc, ['INTERVIEW_DAY_KEYS','ROUTINE_ANSWER_SUFFIXES','ROUTINE_STATIC_KEYS','ROUTINE_PER_DAY_KEYS']), sharedGlobals, ['computeRunSlots']);
const planHelpers = build(funcs(planSrc), sharedGlobals, ['planMatchesAvailability']);
// Extracao literal da selecao de disponibilidade dentro de generateWeekLocked.
const locked = planSrc.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'TrainingPlansService').members.find(n => n.name?.getText(planSrc) === 'generateWeekLocked');
const selectionStatements = locked.body.statements.filter(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => ['adjustedAvailability','rawAvailableDays'].includes(d.name.getText(planSrc)))).map(n => n.getText(planSrc)).join('\n');
function selectGeneration(availability, weeklyOverride) { return build('function select(){' + selectionStatements + '; return rawAvailableDays;}', { availability, weeklyOverride }, ['select']).select(); }

// As operacoes sao lazy, como PrismaPromise. Transacao serializa operacoes e faz rollback no double.
class Op { constructor(run){ this.run=run; } then(ok,bad){ return Promise.resolve().then(this.run).then(ok,bad); } }
class MemoryDb {
  constructor(rows=[]) {
    this.rows=clone(rows); this.userRow={ id:'synthetic', name:'Sintetico', studentCode:null, subscriptionStatus:'pending' }; this.interview={ answers:{ routine_modality_choice:'corrida', monday_run_time:'from_45_to_60', wednesday_run_time:'from_45_to_60', friday_run_time:'from_45_to_60' } };
    this.user={ findUnique:async()=>clone(this.userRow), findUniqueOrThrow:async()=>clone(this.userRow), update:({data})=>new Op(()=>{Object.assign(this.userRow,clone(data));return clone(this.userRow);}) };
    this.weeklyAvailability={
      findMany:async({orderBy}={})=>clone(orderBy?[...this.rows].sort((a,b)=>a.weekday-b.weekday):this.rows),
      deleteMany:()=>new Op(()=>{this.rows=[];return {count:0};}),
      create:({data})=>new Op(()=>{if(this.failWrite)throw new Error('SYNTHETIC_WRITE_FAILURE');if(this.rows.some(r=>r.weekday===data.weekday))throw new Error('SYNTHETIC_UNIQUE');this.rows.push(clone(data));return clone(data);})
    };
    this.trainingPlan={ findFirst:async()=>({id:'already-delivered',sessions:[],name:'Programa'}) };
    this.onboardingInterview={ findUnique:async()=>clone(this.interview) };
    this.fitnessTest={findMany:async()=>[]}; this.studentDirective={findMany:async()=>[]};
    this.studentObservation={ create:async({data})=>({id:'synthetic-note',createdAt:new Date(),...data}) };
  }
  async $transaction(ops){
    if(this.pauseNext){const wait=this.pauseNext;this.pauseNext=null;await wait;}
    const before=clone(this.rows),user=clone(this.userRow);
    try{const out=[];for(const op of ops)out.push(await op);return out;}catch(e){this.rows=before;this.userRow=user;throw e;}
  }
}
function subject(db){return Object.assign(new MeSubject(),{prisma:db,logger,trainingPlans:{generateFirstWeekIfNeeded:async()=>{}},telegram:{notifyCoach:async()=>{}},forwardRoutineObservation:async()=>{}});}
const day=(weekday,min=40)=>({weekday,noTraining:false,modalities:['corrida'],availableMin:min,modalityDurations:{corrida:min}});
const days=rows=>rows.map(r=>r.weekday).sort((a,b)=>a-b);
const eq=(a,b)=>assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)));
const results=[];
async function check(id,description,fn){try{const evidence=await fn();results.push({id,description,execution:'EXECUTED',assertions:'PASS',evidence});}catch(e){results.push({id,description,execution:'EXECUTED',assertions:'FAIL',error:String(e.stack)});}}
(async()=>{
  await check('A','Metodo real salva ter/qui/dom e rele do armazenamento em memoria',async()=>{const db=new MemoryDb([day(1),day(3)]);const me=subject(db);await me.updateAvailability('synthetic',{availability:[day(2),day(4),day(0)]});eq(days(await me.availability('synthetic')),[0,2,4]);return {product:'EXPECTED_BEHAVIOR',persisted:days(db.rows)};});
  await check('B','Tres alteracoes sequenciais; a ultima prevalece',async()=>{const db=new MemoryDb();const me=subject(db);for(const list of [[1,3],[2,4],[0,2,4]])await me.updateAvailability('synthetic',{availability:list.map(x=>day(x))});eq(days(db.rows),[0,2,4]);return {product:'EXPECTED_BEHAVIOR'};});
  await check('C1','Selecao real da geracao usa WA atual sem override',async()=>{eq(days(selectGeneration([day(2),day(4),day(0)])),[0,2,4]);eq(methodology.computeRunSlots([day(2),day(4)]).map(r=>r.weekday),[2,4]);return {product:'EXPECTED_BEHAVIOR',scope:'selecao e slots, nao uma geracao completa'};});
  await check('C2','Override antigo prevalece sobre WA nova sem modificar WA',async()=>{const current=[day(2),day(4),day(0)];eq(days(selectGeneration(current,[day(1),day(3)])),[1,3]);eq(days(current),[0,2,4]);return {product:'REPRODUCED_RISK',generatedInputs:[1,3],storedCurrent:[0,2,4]};});
  await check('C3','WA sem dias ativos ativa rotina padrao hardcoded',async()=>{eq(days(selectGeneration([])),[1,2,4,6]);return {product:'REPRODUCED_RISK',fallback:[1,2,4,6]};});
  await check('C4','Freshness aceita snapshot de override mesmo discordando da WA',async()=>{assert.equal(planHelpers.planMatchesAvailability({weeklyOverrideUsed:true,availabilityDays:[day(1)]},[day(2)]),true);return {product:'REPRODUCED_RISK'};});
  await check('D','Regeneracao real de sessao conserva dia/duracao antigos sem ler WA',async()=>{
    const db=new MemoryDb([day(2,20),day(4,20)]);let reads=0;db.weeklyAvailability.findMany=async()=>{reads++;return clone(db.rows);};
    db.fitnessTest.findFirst=async()=>null;db.reassessment={findFirst:async()=>null};
    const session={id:'s',userId:'synthetic',planId:'p',weekday:1,scheduledDate:new Date('2099-01-05T00:00:00Z'),modality:'corrida',durationMin:60,completion:null,title:'Corrida',notes:null,sessionType:null,structure:{},distanceKm:10,paceMinSec:'6:00/km'};
    db.trainingSession={findFirst:async()=>clone(session),update:async({data})=>Object.assign(session,clone(data))};db.$queryRaw=async()=>[];db.$transaction=async fn=>fn(db);db.studentObservation.findMany=async()=>[];
    let params;const trace={collectProvenance:async()=>({}),collectExecutionProvenance:async()=>({}),persistDayRegeneration:async()=>{}};
    const p=Object.assign(new PlanSubject(),{prisma:db,logger,requireTrace:()=>trace,reassessmentService:{getLatestValidEvolutionReport:async()=>null},
      loadStudentInformationContext:async()=>({studentProfileSummary:null,studentReports:[],pendingStudentReports:[],pendingProfileEvents:[],gaps:[],pendingProfileEventCodes:[]}),
      painReports:{computeSafetyTier:async()=>({tier:'normal'})},prescriptionAgent:{proposeRunSession:async input=>{params=input;return {declared:null};}},
      runPrescription:durationMin=>({distanceKm:10,representativePaceSecondsPerKm:360,durationMin})});
    const result=await p.regenerateSessionInner('synthetic','s');assert.equal(reads,0);assert.equal(params.durationMin,60);assert.equal(result.weekday,1);
    return {product:'REPRODUCED_OLD_SESSION_BASIS',scope:'metodo real; decisao IA e trilha substituidas; sem rede',waDays:[2,4],regeneratedWeekday:result.weekday,minutesSent:params.durationMin};
  });
  await check('E1','Ferramentas reais do chat nao incluem atualizacao de WA',async()=>{const a=new AgentSubject();const names=a.buildTools('synthetic').map(t=>t.spec.name);eq(names,['get_student_context','save_directive','deactivate_directive']);return {product:'MISSING_CAPABILITY',tools:names};});
  await check('E2','Consulta real de contexto do chat rele WA atual',async()=>{const db=new MemoryDb([day(2),day(4)]);const a=Object.assign(new AgentSubject(),{prisma:db});const c=await a.gatherStudentContext('synthetic');eq(c.disponibilidadeOperacionalAtual.map(d=>d.diaDaSemana),[2,4]);return {product:'EXPECTED_BEHAVIOR',scope:'ferramenta, sem conversar com LLM'};});
  await check('F','Hidratacao real mobile a partir de uma nova leitura preserva dias',async()=>{const db=new MemoryDb([day(2),day(4),day(0)]);const fresh=subject(db);const hydrated=mobile.routineFromSavedAvailability(await fresh.availability('synthetic'));const payload=mobile.routineToAvailability(hydrated);eq(days(payload.filter(d=>!d.noTraining)),[0,2,4]);return {product:'EXPECTED_BEHAVIOR',scope:'funcoes puras, nao reinicio de dispositivo'};});
  await check('G1','Concluir entrevista antiga preserva WA atual',async()=>{const db=new MemoryDb([day(2),day(4),day(0)]);const r=await subject(db).syncAvailabilityFromInterview('synthetic',true);assert.equal(r.preserved,true);eq(days(db.rows),[0,2,4]);return {product:'EXPECTED_BEHAVIOR'};});
  await check('G2','Reparo force restaura dias antigos da entrevista',async()=>{const db=new MemoryDb([day(2),day(4),day(0)]);await subject(db).syncAvailabilityFromInterview('synthetic',false,true,{force:true});eq(days(db.rows.filter(r=>!r.noTraining)),[1,3,5]);return {product:'REPRODUCED_OVERWRITE',scope:'operacao explicita de reparo; nao gatilho automatico'};});
  await check('G3','WA toda em descanso nao e protegida por existing_routine_preserved',async()=>{const db=new MemoryDb([0,1,2,3,4,5,6].map(weekday=>({...day(weekday),noTraining:true,modalities:[],availableMin:0,modalityDurations:{}})));await subject(db).syncAvailabilityFromInterview('synthetic',true);eq(days(db.rows.filter(r=>!r.noTraining)),[1,3,5]);return {product:'REPRODUCED_OVERWRITE',scope:'reenvio de complete-routine apos pausa total'};});
  await check('H','Escrita antiga atrasada sobrescreve escrita nova sem conflito',async()=>{const db=new MemoryDb([day(1),day(3)]);let release;db.pauseNext=new Promise(r=>release=r);const me=subject(db);const old=me.updateAvailability('synthetic',{availability:[day(1),day(3)]});await new Promise(r=>setImmediate(r));await me.updateAvailability('synthetic',{availability:[day(2),day(4),day(0)]});eq(days(db.rows),[0,2,4]);release();await old;eq(days(db.rows),[1,3]);return {product:'REPRODUCED_OVERWRITE',scope:'interleaving controlado com double, nao concorrencia PostgreSQL'};});
  await check('I','Enviar apenas um dia substitui a semana inteira',async()=>{const db=new MemoryDb([day(2),day(4),day(0)]);await subject(db).updateAvailability('synthetic',{availability:[day(2,70)]});eq(days(db.rows),[2]);return {product:'REPRODUCED_REPLACEMENT',scope:'PUT e replacement, nao patch'};});
  await check('I2','Validacao real aceita modalidade desconhecida e minutos negativos',async()=>{const {validateAvailability}=build(funcs(rulesSrc),sharedGlobals,['validateAvailability']);validateAvailability([{weekday:2,noTraining:false,modalities:['qualquer'],availableMin:-40,modalityDurations:{qualquer:-40}}]);return {product:'REPRODUCED_VALIDATION_GAP',scope:'validator de negocio; DTO tambem nao limita min/modalidades'};});
  await check('J','Observacao textual de rotina nao atualiza WA',async()=>{const db=new MemoryDb([day(1),day(3)]);const o=Object.assign(new ObservationSubject(),{prisma:db,telegram:{notifyCoach:async()=>{}},reportTimeline:{record:async()=>{}}});await o.create('synthetic',{content:'Agora posso correr somente terca, quinta e domingo.'});eq(days(db.rows),[1,3]);return {product:'NO_ROUTINE_COMMAND',scope:'registro de relato, sem inferencia LLM'};});
  await check('K','Edicao real do treinador grava dias mas nao atualiza lastRoutineChangeAt',async()=>{const db=new MemoryDb([day(1)]);const coach=Object.assign(new CoachSubject(),{prisma:db,logger,assertStudent:async()=>{},trainingPlans:{generateFirstWeekIfNeeded:async()=>{}}});await coach.updateStudentAvailability('synthetic',{availability:[day(2),day(4)],applyNow:false});eq(days(db.rows),[2,4]);assert.equal(db.userRow.lastRoutineChangeAt,undefined);return {product:'EXPECTED_WRITE_WITH_AUDIT_GAP'};});
  await check('L1','Falha de gravacao rejeita operacao e preserva estado anterior no double',async()=>{const db=new MemoryDb([day(1)]);db.failWrite=true;await assert.rejects(subject(db).updateAvailability('synthetic',{availability:[day(2)]}),/SYNTHETIC_WRITE_FAILURE/);eq(days(db.rows),[1]);return {product:'EXPECTED_BEHAVIOR',scope:'rollback do double, nao PostgreSQL'};});
  await check('L2','Erro no relato apos commit devolve falha apesar da rotina gravada',async()=>{const db=new MemoryDb([day(1)]);const me=subject(db);me.forwardRoutineObservation=async()=>{throw new Error('SYNTHETIC_POST_COMMIT_FAILURE');};await assert.rejects(me.updateAvailability('synthetic',{availability:[day(2)],observation:'troca de rotina'}),/SYNTHETIC_POST_COMMIT_FAILURE/);eq(days(db.rows),[2]);return {product:'REPRODUCED_POST_COMMIT_ERROR'};});
  await check('UI1','Conversao mobile altera modalidade legada bike para corrida',async()=>{const data=mobile.routineToAvailability(mobile.routineFromSavedAvailability([{...day(2),modalities:['bike'],modalityDurations:{bike:50}}]));eq(data.find(d=>d.weekday===2).modalities,['corrida']);return {product:'REPRODUCED_LOSSY_ROUNDTRIP'};});
  const output={generatedAt:new Date().toISOString(),sourceRoot:root,method:'AST source-extracted execution; in-memory doubles; no network/database/LLM',results,hashes};
  fs.writeFileSync(path.join(__dirname,'resultados.json'),JSON.stringify(output,null,2));
  console.log(JSON.stringify({total:results.length,assertionsPassed:results.filter(r=>r.assertions==='PASS').length,assertionsFailed:results.filter(r=>r.assertions==='FAIL').length,results},null,2));
  if(results.some(r=>r.assertions==='FAIL'))process.exitCode=1;
})();
