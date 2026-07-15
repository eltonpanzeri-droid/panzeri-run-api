export type GymExerciseGroup = 'quadriceps' | 'posterior' | 'gluteos' | 'panturrilha' | 'quadril' | 'peito' | 'costas' | 'ombros' | 'biceps' | 'triceps' | 'core';
export type GymExerciseLevel = 'base' | 'intermediate' | 'advanced';

export interface GymExercise {
  id: string;
  name: string;
  description: string;
  group: GymExerciseGroup;
  level: GymExerciseLevel;
  videoUrl: null;
}

const squat = 'Mantenha os pes firmes, abdomen contraido e coluna neutra. Desca de forma controlada, mantenha os joelhos alinhados e suba empurrando o chao.';
const hinge = 'Leve o quadril para tras mantendo a coluna neutra e a carga proxima ao corpo. Retorne estendendo o quadril sem arredondar a lombar.';
const machineLeg = 'Ajuste o equipamento, controle toda a amplitude e evite movimentos bruscos ou travar completamente os joelhos.';
const calf = 'Desca controladamente, alongue a panturrilha e eleve os calcanhares, realizando uma breve pausa no ponto mais alto.';
const hip = 'Mantenha o tronco estavel e movimente o quadril sem balancos, respeitando a amplitude disponivel.';
const press = 'Mantenha as escapulas estabilizadas, controle a descida e empurre a carga sem perder o alinhamento dos ombros.';
const pull = 'Mantenha o peito aberto e a coluna neutra. Puxe com a musculatura das costas e evite impulsionar o tronco.';
const shoulder = 'Mantenha o abdomen contraido e o tronco estavel. Controle a subida e principalmente a descida.';
const biceps = 'Mantenha os cotovelos estaveis e evite impulso. Suba controlando a carga e desca lentamente.';
const triceps = 'Mantenha os cotovelos estaveis. Estenda os bracos de forma controlada sem compensar com o tronco.';
const core = 'Mantenha o abdomen contraido, evite tracionar a cabeca e realize o movimento de forma lenta e controlada.';

function item(id: string, name: string, group: GymExerciseGroup, description: string, level: GymExerciseLevel = 'base'): GymExercise {
  return { id, name, group, description, level, videoUrl: null };
}

export const gymExerciseLibrary: GymExercise[] = [
  item('agachamento-barra-livre', 'Agachamento Barra Livre', 'quadriceps', squat, 'advanced'),
  item('agachamento-barra-guiada', 'Agachamento Barra Guiada', 'quadriceps', squat, 'intermediate'),
  item('agachamento-halteres', 'Agachamento Halteres', 'quadriceps', squat),
  item('agachamento-calice', 'Agachamento Calice', 'quadriceps', squat),
  item('bulgaro-livre', 'Agachamento Bulgaro Livre', 'quadriceps', squat, 'intermediate'),
  item('bulgaro-halteres', 'Agachamento Bulgaro com Halteres', 'quadriceps', squat, 'intermediate'),
  item('bulgaro-barra', 'Agachamento Bulgaro com Barra', 'quadriceps', squat, 'advanced'),
  item('bulgaro-guiado', 'Agachamento Bulgaro no Guiado', 'quadriceps', squat, 'intermediate'),
  item('afundo-barra-livre', 'Agachamento Afundo com Barra Livre', 'quadriceps', squat, 'advanced'),
  item('afundo-barra-guiada', 'Agachamento Afundo com Barra Guiada', 'quadriceps', squat, 'intermediate'),
  item('levantamento-terra', 'Levantamento Terra', 'posterior', hinge, 'advanced'),
  item('terra-hexagonal', 'Levantamento Terra Barra Hexagonal', 'posterior', hinge, 'intermediate'),
  item('stiff-halteres', 'Stiff Halteres', 'posterior', hinge),
  item('stiff-barra', 'Stiff Barra', 'posterior', hinge, 'intermediate'),
  item('stiff-unilateral', 'Stiff Unilateral', 'posterior', hinge, 'intermediate'),
  item('elevacao-pelvica-chao', 'Elevacao Pelvica no Chao', 'gluteos', hip),
  item('elevacao-pelvica-chao-unilateral', 'Elevacao Pelvica no Chao Unilateral', 'gluteos', hip, 'intermediate'),
  item('banco-flexor', 'Banco Flexor', 'posterior', machineLeg),
  item('mesa-flexora', 'Mesa Flexora', 'posterior', machineLeg),
  item('banco-extensor', 'Banco Extensor', 'quadriceps', machineLeg),
  item('leg-press', 'Leg Press', 'quadriceps', machineLeg),
  item('hack', 'Hack', 'quadriceps', machineLeg, 'intermediate'),
  item('panturrilha-barra-guiada', 'Panturrilha Barra Guiada', 'panturrilha', calf, 'intermediate'),
  item('panturrilha-guiada-unilateral', 'Panturrilha Barra Guiada Unilateral', 'panturrilha', calf, 'intermediate'),
  item('panturrilha-aparelho-sentado', 'Panturrilha Aparelho Sentado', 'panturrilha', calf),
  item('abducao-quadril-polia', 'Abducao Quadril Polia Baixa', 'quadril', hip),
  item('extensao-quadril-polia', 'Extensao do Quadril Polia Baixa', 'gluteos', hip),
  item('supino-reto-barra', 'Supino Reto Barra', 'peito', press, 'intermediate'),
  item('supino-reto-halteres', 'Supino Reto Halteres', 'peito', press),
  item('supino-inclinado-barra', 'Supino Inclinado Barra', 'peito', press, 'intermediate'),
  item('supino-inclinado-halteres', 'Supino Inclinado Halteres', 'peito', press),
  item('crucifixo-reto', 'Crucifixo Reto', 'peito', press),
  item('crucifixo-inclinado', 'Crucifixo Inclinado', 'peito', press),
  item('crucifixo-crossover', 'Crucifixo Cross Over', 'peito', press, 'intermediate'),
  item('voador', 'Voador', 'peito', press),
  item('flexao-joelhos', 'Flexao de Braco com Joelhos Apoiados', 'peito', press),
  item('flexao-braco', 'Flexao de Braco', 'peito', press, 'intermediate'),
  item('pulley-pronado', 'Pulley Anterior Pronado', 'costas', pull),
  item('pulley-supinado', 'Pulley Anterior Supinado', 'costas', pull),
  item('remada-baixa-pronada', 'Remada Baixa Polia Pronada', 'costas', pull),
  item('remada-baixa-supinada', 'Remada Baixa Polia Supinada', 'costas', pull),
  item('remada-curvada-barra', 'Remada Curvada Barra', 'costas', pull, 'advanced'),
  item('remada-curvada-polia', 'Remada Curvada Polia Baixa', 'costas', pull, 'intermediate'),
  item('crucifixo-inverso-halteres', 'Crucifixo Inverso Halteres', 'costas', pull),
  item('crucifixo-inverso-crossover', 'Crucifixo Inverso Cross Over', 'costas', pull, 'intermediate'),
  item('desenvolvimento-halteres', 'Desenvolvimento Ombros Halteres', 'ombros', shoulder),
  item('desenvolvimento-frente-barra', 'Desenvolvimento Frente Barra', 'ombros', shoulder, 'intermediate'),
  item('abducao-lateral-halteres', 'Abducao Lateral Halteres', 'ombros', shoulder),
  item('abducao-lateral-polia', 'Abducao Lateral Polia Baixa', 'ombros', shoulder, 'intermediate'),
  item('flexao-ombros-halteres', 'Flexao de Ombros Halteres', 'ombros', shoulder),
  item('rosca-direta-barra', 'Rosca Direta Barra', 'biceps', biceps, 'intermediate'),
  item('rosca-direta-halteres', 'Rosca Direta Halteres', 'biceps', biceps),
  item('rosca-martelo-halteres', 'Rosca Martelo Halteres', 'biceps', biceps),
  item('rosca-direta-polia', 'Rosca Direta Polia Baixa', 'biceps', biceps),
  item('rosca-direta-polia-corda', 'Rosca Direta Polia Baixa Corda', 'biceps', biceps),
  item('rosca-scott-barra', 'Rosca Scott Barra', 'biceps', biceps, 'intermediate'),
  item('rosca-inversa-polia', 'Rosca Inversa Polia Baixa', 'biceps', biceps),
  item('rosca-inversa-halteres', 'Rosca Inversa Halteres', 'biceps', biceps),
  item('triceps-pulley', 'Triceps Pulley', 'triceps', triceps),
  item('triceps-coice-polia', 'Triceps Coice Polia Baixa', 'triceps', triceps),
  item('triceps-coice-halteres', 'Triceps Coice Halteres', 'triceps', triceps),
  item('triceps-frances-halteres', 'Triceps Frances Halteres', 'triceps', triceps),
  item('triceps-frances-polia-corda', 'Triceps Frances Polia Baixa Corda', 'triceps', triceps, 'intermediate'),
  item('triceps-testa-polia', 'Triceps Testa Polia Alta', 'triceps', triceps, 'intermediate'),
  item('triceps-testa-halteres', 'Triceps Testa Halteres', 'triceps', triceps),
  item('abdominal-reto', 'Abdominal Reto', 'core', core),
  item('abdominal-obliquo', 'Abdominal Obliquo', 'core', core),
];

export function selectGymExercises(input: { durationMin: number; experience?: string; safetyAdjustment?: boolean; rotation?: number; countAdjustment?: number }) {
  const experience = (input.experience ?? '').toLowerCase();
  const novice = ['nunca', 'poucas', 'voltando', 'menos de 1 ano'].some((term) => experience.includes(term));
  const safeOnly = novice || input.safetyAdjustment;
  const rotations = safeOnly
    ? [
        ['agachamento-calice', 'stiff-halteres', 'elevacao-pelvica-chao', 'supino-reto-halteres', 'pulley-pronado', 'panturrilha-aparelho-sentado', 'abdominal-reto'],
        ['leg-press', 'banco-flexor', 'extensao-quadril-polia', 'flexao-joelhos', 'remada-baixa-pronada', 'panturrilha-aparelho-sentado', 'abdominal-obliquo'],
      ]
    : [
        ['agachamento-barra-guiada', 'stiff-barra', 'banco-extensor', 'supino-reto-barra', 'remada-baixa-pronada', 'desenvolvimento-halteres', 'panturrilha-barra-guiada', 'abdominal-reto'],
        ['leg-press', 'terra-hexagonal', 'bulgaro-halteres', 'supino-inclinado-halteres', 'pulley-supinado', 'abducao-lateral-halteres', 'panturrilha-guiada-unilateral', 'abdominal-obliquo'],
        ['hack', 'stiff-unilateral', 'elevacao-pelvica-chao-unilateral', 'crucifixo-crossover', 'remada-curvada-polia', 'desenvolvimento-frente-barra', 'panturrilha-aparelho-sentado', 'abdominal-reto'],
      ];
  const ids = rotations[(input.rotation ?? 0) % rotations.length];
  const baseCount = input.durationMin >= 75 ? 8 : input.durationMin >= 60 ? 7 : input.durationMin >= 45 ? 6 : 5;
  const count = Math.max(3, Math.min(9, baseCount + (input.countAdjustment ?? 0)));
  return ids
    .map((id) => gymExerciseLibrary.find((exercise) => exercise.id === id))
    .filter((exercise): exercise is GymExercise => Boolean(exercise))
    .slice(0, count);
}

export function isApprovedGymExercise(name: string) {
  return gymExerciseLibrary.some((exercise) => exercise.name === name);
}