// "Fontes científicas e metodologia" (Apple 1.4.1, 17/10/2026).
//
// REGRAS DESTE ARQUIVO
// 1. Uma referência só entra em `references` DEPOIS de conferida (título, autores, ano, periódico e DOI ou PubMed conferidos na fonte). Nunca
//    completar metadado de memória.
// 2. O texto de cada tema (`appUse`) descreve o que o APP faz (registros, telas), nunca o que um estudo concluiu: conclusões de estudos pertencem
//    à referência, não a este texto.
// 3. Indicadores do Panzeri Run (média de 21 dias, faixa habitual, escala de aumento de volume etc.) são METODOLOGIA PRÓPRIA, não instrumentos
//    clínicos validados, e nunca aparecem como evidência científica.
// 4. Não altera cálculos, prescrição, IA, prompts, modelos de dados nem regras de treino: é só conteúdo de leitura.

// Conferido em 17/10/2026 (Crossref para DOI; PubMed para PMID): 31 referencias cadastradas, todas distintas.

export type ScientificReference = {
  title: string;
  authors: string;
  year: number;
  journal: string;
  /** DOI sem o prefixo https://doi.org/ (ex.: "10.1136/bjsports-2016-096325"). Pelo menos um entre doi e pubmedId é obrigatório. */
  doi?: string;
  /** PMID numérico do PubMed. */
  pubmedId?: string;
};

export type SourceTheme = {
  id: string;
  title: string;
  /** O que o app FAZ relacionado ao tema (fato sobre o app), em linguagem simples. */
  appUse: string;
  references: ScientificReference[];
};

export const SOURCE_THEMES: SourceTheme[] = [
  {
    id: 'lesoes-ligamentares-joelho',
    title: 'Lesões ligamentares do joelho',
    appUse: 'O app permite relatar dor, inclusive na região do joelho, e leva esse relato à sua treinadora. Ele não diagnostica lesões nem substitui a avaliação de um profissional de saúde.',
    references: [
      { title: "Shedding light on the non-operative treatment of the forgotten side of the knee: rehabilitation of medial collateral ligament injuries—a systematic review", authors: "Svantesson J, Piussi R, Weissglas E, et al.", year: 2024, journal: "BMJ Open Sport & Exercise Medicine", doi: "10.1136/bmjsem-2023-001750" },
      { title: "Medial collateral ligament injuries of the knee: current treatment concepts", authors: "Chen L, Kim PD, Ahmad CS, et al.", year: 2008, journal: "Current Reviews in Musculoskeletal Medicine", doi: "10.1007/s12178-007-9016-x" },
      { title: "A prospective and blinded investigation of magnetic resonance imaging of the knee. Abnormal findings in asymptomatic subjects", authors: "Boden SD, Davis DO, Dina TS, et al.", year: 1992, journal: "Clinical Orthopaedics and Related Research", pubmedId: "1516310" },
      { title: "Natural history of partial anterior cruciate ligament tears: A systematic literature review", authors: "Pujol N, Colombet P, Cucurulo T, et al.", year: 2012, journal: "Orthopaedics & Traumatology: Surgery & Research", doi: "10.1016/j.otsr.2012.09.013" },
    ],
  },
  {
    id: 'neurociencia-comportamento',
    title: 'Neurociência e comportamento',
    appUse: 'O app registra motivação, estresse e estado emocional nos seus feedbacks, para você e sua treinadora acompanharem. Não é uma avaliação psicológica.',
    references: [
      { title: "How do you feel? Interoception: the sense of the physiological condition of the body", authors: "Craig AD", year: 2002, journal: "Nature Reviews Neuroscience", doi: "10.1038/nrn894" },
      { title: "An Insular View of Anxiety", authors: "Paulus MP, Stein MB", year: 2006, journal: "Biological Psychiatry", doi: "10.1016/j.biopsych.2006.03.042" },
      { title: "Self-efficacy: Toward a unifying theory of behavioral change", authors: "Bandura A", year: 1977, journal: "Psychological Review", doi: "10.1037/0033-295X.84.2.191" },
      { title: "Perception of effort in Exercise Science: Definition, measurement and perspectives", authors: "Pageaux B", year: 2016, journal: "European Journal of Sport Science", doi: "10.1080/17461391.2016.1188992" },
    ],
  },
  {
    id: 'intensidade-treinamento',
    title: 'Intensidade do treinamento',
    appUse: 'O app usa o esforço percebido (escala de 1 a 10) que você registra, o volume semanal e a aderência. A média das últimas 3 semanas e a sua faixa habitual são indicadores próprios do Panzeri Run.',
    references: [
      { title: "Quantifying training intensity distribution in elite endurance athletes: is there evidence for an \"optimal\" distribution?", authors: "Seiler KS, Kjerland GØ", year: 2006, journal: "Scandinavian Journal of Medicine & Science in Sports", doi: "10.1111/j.1600-0838.2004.00418.x" },
      { title: "Impact of Training Intensity Distribution on Performance in Endurance Athletes", authors: "Esteve-Lanao J, Foster C, Seiler S, et al.", year: 2007, journal: "Journal of Strength and Conditioning Research", doi: "10.1519/R-19725.1" },
      { title: "Polarized training has greater impact on key endurance variables than threshold, high intensity, or high volume training", authors: "Stöggl T, Sperlich B", year: 2014, journal: "Frontiers in Physiology", doi: "10.3389/fphys.2014.00033" },
      { title: "Comparison of Polarized Versus Other Types of Endurance Training Intensity Distribution on Athletes' Endurance Performance: A Systematic Review with Meta-analysis", authors: "Silva Oliveira P, Boppre G, Fonseca H", year: 2024, journal: "Sports Medicine", doi: "10.1007/s40279-024-02034-z" },
    ],
  },
  {
    id: 'rigidez-tendinea-economia-corrida',
    title: 'Rigidez tendínea e economia de corrida',
    appUse: 'O app mostra o ritmo e a cadência médios das suas corridas, a partir dos seus registros. Ele não mede rigidez tendínea nem economia de corrida.',
    references: [
      { title: "Training-induced increase in Achilles tendon stiffness affects tendon strain pattern during running", authors: "Werkhausen A, Cronin NJ, Albracht K, et al.", year: 2019, journal: "PeerJ", doi: "10.7717/peerj.6764" },
      { title: "Energy cost of running and Achilles tendon stiffness in man and woman trained runners", authors: "Fletcher JR, Pfister TR, MacIntosh BR", year: 2013, journal: "Physiological Reports", doi: "10.1002/phy2.178" },
      { title: "Changes in Achilles tendon stiffness and energy cost following a prolonged run in trained distance runners", authors: "Fletcher JR, MacIntosh BR", year: 2018, journal: "PLOS ONE", doi: "10.1371/journal.pone.0202026" },
      { title: "Effect of habitual running on human Achilles tendon load-deformation properties and cross-sectional area", authors: "Hansen P, Aagaard P, Kjaer M, et al.", year: 2003, journal: "Journal of Applied Physiology", pubmedId: "12937029" },
      { title: "Effects of Plyometric Training on Lower Body Muscle Architecture, Tendon Structure, Stiffness and Physical Performance: A Systematic Review and Meta-analysis", authors: "Ramírez-delaCruz M, Bravo-Sánchez A, Esteban-García P, et al.", year: 2022, journal: "Sports Medicine - Open", doi: "10.1186/s40798-022-00431-0" },
      { title: "Heavy Resistance Training Versus Plyometric Training for Improving Running Economy and Running Time Trial Performance: A Systematic Review and Meta-analysis", authors: "Eihara Y, Takao K, Sugiyama T, et al.", year: 2022, journal: "Sports Medicine - Open", doi: "10.1186/s40798-022-00511-1" },
    ],
  },
  {
    id: 'ritmo-circadiano',
    title: 'Ritmo circadiano',
    appUse: 'O app pergunta sobre o seu sono (duração, qualidade, horário de dormir e de acordar) antes dos treinos, para você e sua treinadora acompanharem.',
    references: [
      { title: "Evidence of a circadian variation in 10-km laboratory running time-trial performance, where a standardised approach has been employed", authors: "Edwards BJ, Boyle BB, Burniston JG, et al.", year: 2025, journal: "Chronobiology International", doi: "10.1080/07420528.2025.2459668" },
      { title: "The Effect of Training at a Specific Time of Day", authors: "Chtourou H, Souissi N", year: 2012, journal: "Journal of Strength and Conditioning Research", doi: "10.1519/JSC.0b013e31825770a7" },
      { title: "Best Time of Day for Strength and Endurance Training to Improve Health and Performance? A Systematic Review with Meta-analysis", authors: "Bruggisser F, Knaier R, Roth R, et al.", year: 2023, journal: "Sports Medicine - Open", doi: "10.1186/s40798-023-00577-5" },
      { title: "Temperature and neuromuscular function", authors: "Racinais S, Oksa J", year: 2010, journal: "Scandinavian Journal of Medicine & Science in Sports", doi: "10.1111/j.1600-0838.2010.01204.x" },
      { title: "Different effects of heat exposure upon exercise performance in the morning and afternoon", authors: "Racinais S", year: 2010, journal: "Scandinavian Journal of Medicine & Science in Sports", doi: "10.1111/j.1600-0838.2010.01212.x" },
      { title: "The Effect of Training at the Same Time of Day and Tapering Period on the Diurnal Variation of Short Exercise Performances", authors: "Chtourou H, Chaouachi A, Driss T, et al.", year: 2012, journal: "Journal of Strength and Conditioning Research", doi: "10.1519/JSC.0b013e3182281c87" },
      { title: "The Impact of Circadian Phenotype and Time since Awakening on Diurnal Performance in Athletes", authors: "Facer-Childs E, Brandstaetter R", year: 2015, journal: "Current Biology", doi: "10.1016/j.cub.2014.12.036" },
      { title: "Human circadian phase–response curves for exercise", authors: "Youngstedt SD, Elliott JA, Kripke DF", year: 2019, journal: "The Journal of Physiology", doi: "10.1113/JP276943" },
    ],
  },
  {
    id: 'exercicio-imunidade',
    title: 'Exercício e imunidade',
    appUse: 'O app não mede imunidade nem diagnostica doenças. Você pode contar à sua treinadora, em "Relatar observação", circunstâncias que possam afetar seus treinos.',
    references: [
      { title: "Exercise, Infection, and Immunity", authors: "Nieman DC", year: 1994, journal: "International Journal of Sports Medicine", doi: "10.1055/s-2007-1021128" },
      { title: "Position statement. Part one: Immune function and exercise", authors: "Walsh NP, Gleeson M, Shephard RJ, et al.", year: 2011, journal: "Exercise Immunology Review", pubmedId: "21446352" },
      { title: "Debunking the Myth of Exercise-Induced Immune Suppression: Redefining the Impact of Exercise on Immunological Health Across the Lifespan", authors: "Campbell JP, Turner JE", year: 2018, journal: "Frontiers in Immunology", doi: "10.3389/fimmu.2018.00648" },
      { title: "Incidence of acute respiratory illnesses in athletes: a systematic review and meta-analysis by a subgroup of the IOC consensus on 'acute respiratory illness in the athlete'", authors: "Derman W, Badenhorst M, Eken MM, et al.", year: 2022, journal: "British Journal of Sports Medicine", doi: "10.1136/bjsports-2021-104737" },
      { title: "Risk factors associated with acute respiratory illnesses in athletes: a systematic review by a subgroup of the IOC consensus on 'acute respiratory illness in the athlete'", authors: "Derman W, Badenhorst M, Eken M, et al.", year: 2022, journal: "British Journal of Sports Medicine", doi: "10.1136/bjsports-2021-104795" },
    ],
  },
];

/** Os três tipos de conteúdo da seção, sempre mostrados separados. */
export const CONTENT_KINDS: Array<{ id: 'evidencia' | 'aplicacao' | 'metodologia'; title: string; text: string }> = [
  { id: 'evidencia', title: 'Evidência científica', text: 'Estudos publicados em periódicos científicos, listados por tema com título, autores, ano, periódico e link (DOI ou PubMed).' },
  { id: 'aplicacao', title: 'Interpretação e aplicação prática', text: 'Como o app se relaciona com cada tema: o que ele registra e mostra para você. É a nossa interpretação do uso, não uma conclusão dos estudos.' },
  { id: 'metodologia', title: 'Metodologia própria do Panzeri Run', text: 'Indicadores criados pelo Panzeri Run para acompanhar o seu treino, como a média das últimas 3 semanas e a sua faixa habitual. Eles não são instrumentos clínicos validados nem substituem orientação profissional.' },
];

export function referenceUrl(reference: ScientificReference): string | null {
  if (reference.doi) return `https://doi.org/${reference.doi}`;
  if (reference.pubmedId) return `https://pubmed.ncbi.nlm.nih.gov/${reference.pubmedId}/`;
  return null;
}

/** Referência completa = todos os campos bibliográficos e um link. Só referências completas são exibidas. */
export function isReferenceComplete(reference: ScientificReference): boolean {
  return Boolean(
    reference.title.trim() && reference.authors.trim() && reference.journal.trim()
    && Number.isInteger(reference.year) && reference.year > 1900 && reference.year <= 2100
    && referenceUrl(reference),
  );
}

export function themesById(ids: string[] | undefined): SourceTheme[] {
  if (!ids || ids.length === 0) return SOURCE_THEMES;
  return SOURCE_THEMES.filter((theme) => ids.includes(theme.id));
}

// Abertura da seção a partir de qualquer tela (links contextuais) sem passar props por todo o app: o App registra o abridor uma vez.
let opener: ((themeIds: string[]) => void) | null = null;
export function registerSourcesOpener(fn: ((themeIds: string[]) => void) | null): void {
  opener = fn;
}
export function openSources(themeIds: string[] = []): void {
  opener?.(themeIds);
}
