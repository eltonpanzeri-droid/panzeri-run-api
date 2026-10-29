// Acentuação de textos exibidos ao aluno (30/10/2026). Textos antigos do aplicativo foram escritos sem acento e os mesmos textos também são VALORES guardados (respostas da entrevista, objetivos),
// que não podem mudar. Este módulo corrige só a APRESENTAÇÃO: o valor guardado continua o original e o rótulo mostrado passa por aqui. Idempotente (texto já acentuado não muda) e restrito a
// palavras sem ambiguidade (ex.: não traduz "e" solto, que pode ser "é" ou "e").
const WORDS: Record<string, string> = {
  voce: 'você',
  voces: 'vocês',
  nao: 'não',
  tambem: 'também',
  ja: 'já',
  so: 'só',
  ate: 'até',
  entao: 'então',
  sera: 'será',
  serao: 'serão',
  estao: 'estão',
  sao: 'são',
  tera: 'terá',
  podera: 'poderá',
  ficara: 'ficará',
  voltara: 'voltará',
  mes: 'mês',
  ultimo: 'último',
  ultima: 'última',
  ultimos: 'últimos',
  ultimas: 'últimas',
  proximo: 'próximo',
  proxima: 'próxima',
  proximos: 'próximos',
  proximas: 'próximas',
  minimo: 'mínimo',
  minima: 'mínima',
  maximo: 'máximo',
  maxima: 'máxima',
  numero: 'número',
  numeros: 'números',
  rapido: 'rápido',
  rapida: 'rápida',
  facil: 'fácil',
  dificil: 'difícil',
  saude: 'saúde',
  medico: 'médico',
  medica: 'médica',
  agua: 'água',
  exercicio: 'exercício',
  exercicios: 'exercícios',
  musculacao: 'musculação',
  informacao: 'informação',
  informacoes: 'informações',
  configuracao: 'configuração',
  configuracoes: 'configurações',
  notificacao: 'notificação',
  notificacoes: 'notificações',
  alteracao: 'alteração',
  alteracoes: 'alterações',
  avaliacao: 'avaliação',
  avaliacoes: 'avaliações',
  situacao: 'situação',
  opcao: 'opção',
  opcoes: 'opções',
  atencao: 'atenção',
  conexao: 'conexão',
  conclusao: 'conclusão',
  descricao: 'descrição',
  cobranca: 'cobrança',
  usuario: 'usuário',
  periodo: 'período',
  periodos: 'períodos',
  historico: 'histórico',
  tecnico: 'técnico',
  tecnica: 'técnica',
  basico: 'básico',
  basica: 'básica',
  distancia: 'distância',
  distancias: 'distâncias',
  duracao: 'duração',
  frequencia: 'frequência',
  cardiaca: 'cardíaca',
  cardiaco: 'cardíaco',
  recuperacao: 'recuperação',
  previsao: 'previsão',
  area: 'área',
  razao: 'razão',
  orientacao: 'orientação',
  orientacoes: 'orientações',
  preparacao: 'preparação',
  execucao: 'execução',
  prescricao: 'prescrição',
  adaptacao: 'adaptação',
  progressao: 'progressão',
  sessao: 'sessão',
  sessoes: 'sessões',
  decisao: 'decisão',
  versao: 'versão',
  paciencia: 'paciência',
  experiencia: 'experiência',
  ciencia: 'ciência',
  diferenca: 'diferença',
  esforco: 'esforço',
  forca: 'força',
  coracao: 'coração',
  cabeca: 'cabeça',
  lesao: 'lesão',
  lesoes: 'lesões',
  ha: 'há',
  alem: 'além',
  apos: 'após',
  porem: 'porém',
  proprio: 'próprio',
  propria: 'própria',
  proprios: 'próprios',
  proprias: 'próprias',
  unico: 'único',
  unica: 'única',
  possivel: 'possível',
  impossivel: 'impossível',
  necessario: 'necessário',
  obrigatorio: 'obrigatório',
  disponivel: 'disponível',
  indisponivel: 'indisponível',
  util: 'útil',
  uteis: 'úteis',
  valido: 'válido',
  valida: 'válida',
  invalido: 'inválido',
  invalida: 'inválida',
  seguranca: 'segurança',
  confianca: 'confiança',
  mudanca: 'mudança',
  cansaco: 'cansaço',
  alimentacao: 'alimentação',
  hidratacao: 'hidratação',
  condicao: 'condição',
  condicoes: 'condições',
  calendario: 'calendário',
  genero: 'gênero',
  endereco: 'endereço',
  residencia: 'residência',
  profissao: 'profissão',
  ocupacao: 'ocupação',
  comeco: 'começo',
  comecar: 'começar',
  comecou: 'começou',
  preco: 'preço',
  servico: 'serviço',
  servicos: 'serviços',
  beneficio: 'benefício',
  beneficios: 'benefícios',
  proteina: 'proteína',
  proteinas: 'proteínas',
  evolucao: 'evolução',
  competicao: 'competição',
  musculos: 'músculos',
  musculo: 'músculo',
  articulacao: 'articulação',
  articulacoes: 'articulações',
  inicio: 'início',
  horario: 'horário',
  horarios: 'horários',
  terca: 'terça',
  sabado: 'sábado',
  cartao: 'cartão',
  credito: 'crédito',
  debito: 'débito',
  codigo: 'código',
  pagina: 'página',
  paginas: 'páginas',
  video: 'vídeo',
  videos: 'vídeos',
  audio: 'áudio',
  botao: 'botão',
  icone: 'ícone',
  concluido: 'concluído',
  concluida: 'concluída',
  concluidos: 'concluídos',
  concluidas: 'concluídas',
  excluido: 'excluído',
  excluida: 'excluída',
  gravacao: 'gravação',
  relatorio: 'relatório',
  relatorios: 'relatórios',
  analise: 'análise',
  analises: 'análises',
  medias: 'médias',
  media: 'média',
  sequencia: 'sequência',
  consequencia: 'consequência',
  tres: 'três',
  ola: 'olá',
  obrigatoria: 'obrigatória',
  historia: 'história',
  memoria: 'memória',
  saudavel: 'saudável',
  possiveis: 'possíveis',
  medio: 'médio', fisica: 'física',
  fisico: 'físico',
  fisicas: 'físicas',
  fisicos: 'físicos',
  habitos: 'hábitos',
  habito: 'hábito',
  centimetros: 'centímetros',
  centimetro: 'centímetro',
  quilometros: 'quilômetros',
  quilometro: 'quilômetro',
  tenis: 'tênis',
  gravida: 'grávida',
  ninguem: 'ninguém',
  alguem: 'alguém',
  mae: 'mãe',
  irmao: 'irmão',
  familia: 'família',
  diagnostico: 'diagnóstico',
  tendao: 'tendão',
  inchaco: 'inchaço',
};

const SUFFIX: Array<[RegExp, string | null]> = [[/cao$/i, 'ção'], [/coes$/i, 'ções'], [/ssao$/i, 'ssão'], [/ssoes$/i, 'ssões'], [/ncia$/i, null], [/ivel$/i, 'ível'], [/avel$/i, 'ável'], [/ario$/i, 'ário'], [/ioes$/i, 'iões']];

function suffixFix(word: string): string | null {
  if (word.length < 6 || /[0-9_]/.test(word)) return null;
  for (const [re, to] of SUFFIX) {
    if (!re.test(word)) continue;
    if (to === null) {
      if (/ancia$/i.test(word)) return word.replace(/ancia$/i, 'ância');
      if (/encia$/i.test(word)) return word.replace(/encia$/i, 'ência');
      return null;
    }
    return word.replace(re, to);
  }
  return null;
}

function fixWord(match: string): string {
  const lower = match.toLowerCase();
  const to = WORDS[lower] ?? suffixFix(lower);
  if (!to) return match;
  if (match === match.toUpperCase() && match.length > 2) return to.toUpperCase();
  if (match[0] === match[0].toUpperCase()) return to[0].toUpperCase() + to.slice(1);
  return to;
}

const PHRASES: Array<[RegExp, string | ((...args: string[]) => string)]> = [
  [/\b(Qual|Quando|Onde|Quem|Como|O que|Isso|Esse|Essa|Este|Esta|Aqui|Tudo|Ela|Ele|Que|Nada|Algo) e (o|a|um|uma|seu|sua|muito|mais|menos|importante|possivel|necessario|obrigatorio|opcional|recomendado|hora|seguro|normal|comum|essencial|melhor|pior|fundamental|igual|diferente)\b/g, (_m, a, b) => `${a} é ${b}`],
  [/\b(e|E) (importante|possivel|necessario|obrigatorio|recomendado|essencial|fundamental|normal|comum|seguro|hora de|feito|feita|calculado|calculada|processado|processada|renovada|renovado|liberado|liberada|gerado|gerada|salvo|salva|enviado|enviada|usado|usada|mostrado|mostrada|registrado|registrada)\b/g, (_m, _a, b) => `é ${b}`],
  [/\bpor mes\b/g, 'por mês'], [/\btodo mes\b/g, 'todo mês'], [/\bo que e\b/g, 'o que é'],
];

const cache = new Map<string, string>();
export function accentPt(text: string): string {
  if (!text || !/[A-Za-z]/.test(text)) return text;
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  let out = text.replace(/\b[A-Za-zÀ-ÿ]+\b/g, (word) => (/[À-ÿ]/.test(word) ? word : fixWord(word)));
  for (const [re, rep] of PHRASES) out = out.replace(re, rep as never);
  if (cache.size > 2000) cache.clear();
  cache.set(text, out);
  return out;
}

// Pergunta da entrevista pronta para exibir: módulo, enunciado, ajuda e rótulos de opções acentuados. Os valores (chave, valor da opção, módulo usado em comparações) NÃO mudam: só o que o aluno lê.
export function localizeQuestion<Q extends { module: string; prompt: string; help?: string; options?: unknown[] }>(question: Q): Q {
  const options = question.options?.map((item) => {
    if (typeof item === 'string') return { label: accentPt(item), value: item };
    const object = item as { label?: string; ack?: string; ackFragment?: string };
    return { ...object, label: accentPt(object.label ?? ''), ...(object.ack ? { ack: accentPt(object.ack) } : {}), ...(object.ackFragment ? { ackFragment: accentPt(object.ackFragment) } : {}) };
  });
  return { ...question, prompt: accentPt(question.prompt), ...(question.help ? { help: accentPt(question.help) } : {}), ...(options ? { options } : {}) };
}
