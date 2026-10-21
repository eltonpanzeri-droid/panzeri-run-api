import { ZEPP_PROFILE_UNCONFIRMED, ZeppWorkoutProfile } from './zepp-workout-spec';

// Perfil da Workout V2 da Zepp. Preenchido SO' com o que a Zepp CONFIRMOU por escrito (resposta oficial de Jeff Fu, Zepp Health, recebida em 21/10/2026) somado ao que o
// "Workout V2 Schema" publica (devopen.zepp.com/docs/data-apis/workout-v2-schema). Nada abaixo e' inventado:
//   - tempo em SEGUNDOS (o schema ja' dizia; confirmado);
//   - distancia em METROS                                              -> distanceUnit = 'm'
//   - pace: a meta de ritmo e' VELOCIDADE em m/s (maior valor = mais rapido) -> paceUnit = 'm_per_s' (targetType continua `PACE_LAP`, valor do schema)
//   - FC em BPM absolutos, potencia em watts absolutos (o Panzeri Run hoje so' envia meta de pace; estes alvos nao sao usados);
//   - duracao, distancia, FC, potencia, cadencia e repeticoes: inteiros; velocidade pode ter decimais;
//   - `workoutDate`: AAAA-MM-DD, na data LOCAL do atleta (o Panzeri Run guarda a data local do treino);
//   - recuperacao caminhando: etapa de RECUPERACAO dentro de um treino de corrida (intensity RECOVERY/REST do schema).
//
// Continuam `null` (NAO confirmados e NAO publicados) — o passo que depende deles e' RECUSADO e o treino nao e' enviado, nunca adivinhado:
//   noTargetType            como expressar um passo SEM meta (ex.: pausa passiva ou caminhada sem pace): o schema exige targetType e targetValueLow/High e nao lista valor "sem meta"
//   singlePaceAsEqualBounds pace unico (faixa com low === high)
//   maxNameLength           limite do nome do treino (o Panzeri Run encurta conservadoramente por conta propria)
//   maxStepsPerWorkout      limite de passos
export const ZEPP_WORKOUT_PROFILE: ZeppWorkoutProfile = {
  ...ZEPP_PROFILE_UNCONFIRMED,
  distanceUnit: 'm',
  paceUnit: 'm_per_s',
};

// A Zepp CONFIRMOU (21/10/2026) que o Activity Event e o FIT NAO trazem o `workoutId` publicado. Portanto NAO existe campo para vincular atividade a treino publicado e o
// Panzeri Run nao depende dele: a associacao prescrito x executado usa SOMENTE o mecanismo existente (data, modalidade, horario e caracteristicas da sessao; inferencia
// automatica e confirmacao do aluno/treinador sao registradas de forma distinta). Permanentemente null.
export const ZEPP_EXECUTED_WORKOUT_ID_FIELD: string | null = null;
