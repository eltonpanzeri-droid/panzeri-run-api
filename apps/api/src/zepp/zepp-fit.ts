// Compatibilidade (10/11/2026): o leitor de FIT virou o modulo neutro src/fit/fit-reader.ts (Zepp, COROS e Wahoo o usam). Estes sao os nomes antigos da Zepp, mantidos para nao mexer em quem ja' importa daqui.
import { DEFAULT_FIT_PROFILE, FitReadError, modalityFromFit, readFitActivity, type FitActivity, type FitPoint, type FitProfile } from '../fit/fit-reader';

export type ZeppFitProfile = FitProfile;
export type ZeppFitPoint = FitPoint;
export type ZeppFitActivity = FitActivity;
export const ZEPP_FIT_PROFILE = DEFAULT_FIT_PROFILE;
export const ZeppFitError = FitReadError;
export type ZeppFitError = FitReadError;
export const readZeppFit = readFitActivity;
export { modalityFromFit };
