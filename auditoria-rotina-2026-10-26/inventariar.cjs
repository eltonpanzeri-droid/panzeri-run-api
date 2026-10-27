const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.cwd();
if(path.basename(root)!=='panzeri-run-api') throw Error('Execute na raiz canonica panzeri-run-api');
const skip=new Set(['node_modules','.git','.pnpm-store','secrets','.aws','.codex','.claude','.tools','.next','assets','play-store-assets']);
const extensions=new Set(['.ts','.tsx','.js','.mjs','.cjs','.prisma','.sql','.md','.json','.bat','.yml','.yaml','.html']);
const pattern=/routine|rotina|availability|disponibilidade|diasDisponiveis|agenda[ _-]?semanal|trainingDays|trainingFrequency|preferredDays|schedulePreference|weekly[ _-]?schedule|hor[aá]rios?|frequ[eê]ncia|restri[cç][aã]o|planejamento|programa[cç][aã]o/ig;
const rows=[],errors=[];
function walk(dir){let entries;try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch(e){errors.push({path:path.relative(root,dir),error:e.code});return;}
for(const entry of entries){if(entry.isSymbolicLink()||entry.name.startsWith('.env')||entry.name.endsWith('.tsbuildinfo'))continue;
const file=path.join(dir,entry.name),rel=path.relative(root,file).replaceAll('\\','/');
if(rel.startsWith('auditoria-rotina-2026-10-26/'))continue;
if(entry.isDirectory()){if(!skip.has(entry.name))walk(file);continue;}
if(!extensions.has(path.extname(file))||fs.statSync(file).size>8000000)continue;
let content;try{content=fs.readFileSync(file,'utf8');}catch(e){errors.push({path:rel,error:e.code});continue;}
const matches=[...content.matchAll(pattern)];if(!matches.length)continue;
const lines=[];content.split(/\r?\n/).forEach((line,i)=>{pattern.lastIndex=0;if(pattern.test(line))lines.push(i+1);});
const category=/\/test\/|\.spec\.|\/tests\//.test(rel)?'teste/mock':/\/migrations\//.test(rel)?'migration':/(^|\/)dist(?:-check)?\//.test(rel)||/\.next-build\//.test(rel)?'artefato compilado':/\.md$/.test(rel)?'documentacao':/^apps\/api\/src\//.test(rel)?'fonte API':/^apps\/mobile\//.test(rel)?'fonte mobile':/^apps\/admin\//.test(rel)?'fonte admin':'outro candidato';
rows.push({path:rel,category,hits:matches.length,lines,sha256:crypto.createHash('sha256').update(content).digest('hex'),directWritePattern:/weeklyAvailability\s*\.\s*(create|createMany|update|updateMany|upsert|deleteMany|delete)\s*\(/.test(content)});
}}
walk(root);const output=path.join(root,'auditoria-rotina-2026-10-26');
fs.writeFileSync(path.join(output,'inventario.json'),JSON.stringify({generatedAt:new Date().toISOString(),root,note:'Somente checkout canonico. Candidatos lexicais nao provam uso em producao. Dependencias, segredos, binarios e auditoria excluidos.',rows,errors},null,2));
const cell=x=>'"'+String(x).replaceAll('"','""')+'"';
fs.writeFileSync(path.join(output,'inventario.csv'),'arquivo;classe;ocorrencias;linhas;escrita_direta;sha256\n'+rows.map(r=>[r.path,r.category,r.hits,r.lines.join(','),r.directWritePattern,r.sha256].map(cell).join(';')).join('\n'));
console.log(JSON.stringify({root,files:rows.length,categories:rows.reduce((a,r)=>(a[r.category]=(a[r.category]||0)+1,a),{}),errors,writeCandidates:rows.filter(r=>r.directWritePattern).map(r=>r.path)},null,2));
