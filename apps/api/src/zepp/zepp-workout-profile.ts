import { ZEPP_PROFILE_UNCONFIRMED, ZeppWorkoutProfile } from './zepp-workout-spec';

// Perfil CONFIRMADO da Workout V2 da Zepp. HOJE (20/10/2026) NAO HA CONFIRMACAO: as perguntas tecnicas foram enviadas ao Jeff Fu (Zepp Health) e este arquivo so'
// pode receber valores depois da RESPOSTA ESCRITA da Zepp. Cada campo preenchido deve citar a resposta (data e trecho) neste comentario.
//
// Enquanto um campo for `null`, o tradutor RECUSA os passos que dependem dele e nenhum treino e' enviado: nunca se envia prescricao possivelmente errada.
// Para tornar o envio possivel basta editar este perfil (uma unica mudanca de codigo revisada) — o resto do Lote 2 ja' esta pronto e testado com perfis hipoteticos.
//
//   distanceUnit            <- pergunta 2 do e-mail (unidade de durationValue por distancia)
//   paceUnit                <- pergunta 1 (unidade de PACE_LAP)
//   noTargetType            <- pergunta 5 (como expressar passo sem meta)
//   singlePaceAsEqualBounds <- pergunta 1 (pace unico: low === high aceito?)
//   maxNameLength           <- pergunta 6
//   maxStepsPerWorkout      <- pergunta 6
export const ZEPP_WORKOUT_PROFILE: ZeppWorkoutProfile = { ...ZEPP_PROFILE_UNCONFIRMED };

// Campo do evento/FIT da atividade EXECUTADA que traz o `workoutId` do treino publicado (pergunta 14 enviada a Zepp). null = a Zepp ainda nao confirmou que o devolve:
// nenhum vinculo "exato" e' feito e o Panzeri Run usa so' o mecanismo de associacao existente (data, modalidade, distancia — com vinculo "a confirmar" quando ambiguo).
// Quando a Zepp confirmar, preencher com o NOME do campo no registro de `activityFiles` (um unico lugar de codigo, revisado).
export const ZEPP_EXECUTED_WORKOUT_ID_FIELD: string | null = null;
