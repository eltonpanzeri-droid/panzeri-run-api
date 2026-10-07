import { canonicalModality } from '../activity-execution/canonical-modality';
import { buildCanonicalWorkout, CanonicalWorkout } from '../training-plans/canonical-workout';
import { AppleCustomWorkoutSpec, AppleTranslationLoss, translateToAppleCustomWorkout } from './apple-custom-workout-spec';

// Elegibilidade de uma TrainingSession para o envio ao Apple Watch (Etapa 7): decide o que o pipeline aprovado
//   TrainingSession -> CanonicalWorkout -> AppleCustomWorkoutSpec (tradutor Apple) -> Swift CustomWorkout -> agendamento
// consegue enviar SEM inventar informacao. A decisao de "o que e' traduzivel" e' do TRADUTOR (uma unica fonte de verdade): esta funcao so'
// acrescenta as condicoes da SESSAO (nao e' extra, ainda nao foi registrada, data de hoje ou futura, distancia da sessao confere). Substitui a
// elegibilidade antiga de "corrida continua de uma parte so'" (SingleGoalWorkout): continuo, varias partes e intervalado agora seguem o mesmo caminho.
// Tudo que o tradutor recusa (tempo, pausa passiva, meta aberta, esteira, etc.) continua indisponivel, com o motivo do tradutor.

// A distancia gravada na sessao tem uma casa decimal; a soma exata do canonico pode diferir de ate' 0,05 km disso.
const SESSION_DISTANCE_TOLERANCE_KM = 0.06;

export interface AppleWorkoutSessionInput {
  id: string;
  modality: string;
  origin: string | null;
  scheduledDate: Date;
  distanceKm: number | null;
  structure: unknown;
  completionStatus?: string | null;
}

export type AppleWorkoutEligibility =
  | {
      eligible: true;
      distanceKm: number;
      scheduledDate: string;
      canonicalWorkout: CanonicalWorkout;
      spec: AppleCustomWorkoutSpec;
      losses: AppleTranslationLoss[];
      canonicalWarningCodes: string[];
    }
  | { eligible: false; reason: string };

export function appleWorkoutEligibility(session: AppleWorkoutSessionInput, todayIso: string): AppleWorkoutEligibility {
  const no = (reason: string): AppleWorkoutEligibility => ({ eligible: false, reason });
  const structure = (session.structure && typeof session.structure === 'object' ? session.structure : {}) as { type?: unknown };

  if (session.origin === 'device_extra' || structure.type === 'extra') return no('sessao_extra');
  // Modalidade pela representacao canonica; 'esteira' (indoor) fica fora desta etapa.
  if (canonicalModality(session.modality) !== 'corrida') return no('modalidade_nao_suportada');
  if (structure.type !== 'run') return no('estrutura_nao_suportada');
  if (session.completionStatus) return no('sessao_ja_registrada');

  const canonicalWorkout = buildCanonicalWorkout({ id: session.id, modality: session.modality, structure: session.structure });
  const translation = translateToAppleCustomWorkout(canonicalWorkout);
  if (!translation.ok) return no(translation.refusals[0].code);

  const distanceKm = Math.round(canonicalWorkout.derived.totalDistanceMeters) / 1000;
  // A distancia da estrutura e a distancia gravada da sessao precisam concordar (senao nao ha "distancia real prescrita" inequivoca).
  if (session.distanceKm != null && Math.abs(session.distanceKm - distanceKm) > SESSION_DISTANCE_TOLERANCE_KM) return no('distancia_inconsistente');

  const scheduledDate = session.scheduledDate.toISOString().slice(0, 10);
  if (scheduledDate < todayIso) return no('data_passada');

  return {
    eligible: true,
    distanceKm,
    scheduledDate,
    canonicalWorkout,
    spec: translation.spec,
    losses: translation.losses,
    canonicalWarningCodes: translation.canonicalWarningCodes,
  };
}
