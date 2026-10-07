// Ponte JS para a validacao NATIVA de um AppleCustomWorkoutSpec (WorkoutKit CustomWorkout). Logica pura, com a funcao nativa injetada, para ser
// testada sem React Native. O spec ja vem validado pela API (tradutor Apple): aqui ele segue como JSON, sem nenhuma reinterpretacao, e o resultado
// nativo e' conferido contra o proprio spec (o Swift devolve um "eco" lido do CustomWorkout construido, e ele precisa bater exatamente).
// NADA e' agendado aqui; este modulo ainda nao esta ligado ao botao de envio nem ao WorkoutDelivery.

export interface AppleCustomWorkoutSpecJson {
  specVersion: number;
  translatorVersion: number;
  activity: 'running';
  location: 'outdoor';
  warmup: null;
  cooldown: null;
  blocks: Array<{ iterations: number; steps: Array<{ purpose: 'work' | 'recovery'; goal: { type: 'distance'; meters: number } }> }>;
  source: { canonicalSchemaVersion: number; trainingSessionId: string | null };
  specHash: string;
}

export interface NativeSpecIssue {
  code: string;
  message: string;
  path: string;
}

export interface NativeCustomWorkoutValidation {
  valid: boolean;
  errors: NativeSpecIssue[];
  summary?: {
    activity: string;
    location: string;
    blocks: Array<{ iterations: number; steps: Array<{ purpose: string; meters: number }> }>;
    totalMeters: number;
    serializedBytes: number;
  };
}

export type CustomWorkoutBridgeResult =
  | { ok: true; summary: NonNullable<NativeCustomWorkoutValidation['summary']> }
  // 'native_rejected': o WorkoutKit/Swift recusou (errors traz codigo, caminho e mensagem nativos, sem generalizar);
  // 'echo_mismatch': o nativo aceitou mas o que construiu nao e' identico ao spec (nao deve acontecer: traducao e' mecanica);
  // 'not_supported' / 'native_error': modulo ausente ou excecao inesperada, com a mensagem real preservada.
  | { ok: false; reason: 'native_rejected' | 'echo_mismatch' | 'not_supported' | 'native_error'; errors: NativeSpecIssue[] };

export function validateAppleSpecOnDevice(
  native: { isSupported: boolean; validateCustomWorkoutSpec: (specJson: string) => NativeCustomWorkoutValidation },
  spec: AppleCustomWorkoutSpecJson,
): CustomWorkoutBridgeResult {
  if (!native.isSupported) {
    return { ok: false, reason: 'not_supported', errors: [{ code: 'E_NOT_SUPPORTED', message: 'Disponivel apenas no app nativo do iPhone.', path: '' }] };
  }
  let result: NativeCustomWorkoutValidation;
  try {
    result = native.validateCustomWorkoutSpec(JSON.stringify(spec));
  } catch (error) {
    // Excecao nativa inesperada: preserva a mensagem real (e o codigo, quando o Expo o fornece).
    const code = (error as { code?: unknown } | null)?.code;
    return { ok: false, reason: 'native_error', errors: [{ code: typeof code === 'string' ? code : 'E_NATIVE', message: error instanceof Error ? error.message : String(error), path: '' }] };
  }
  if (!result.valid || !result.summary) {
    return { ok: false, reason: 'native_rejected', errors: result.errors.length > 0 ? result.errors : [{ code: 'E_NATIVE_UNKNOWN', message: 'O nativo recusou o spec sem detalhar o motivo.', path: '' }] };
  }
  const echo = result.summary.blocks;
  const same =
    result.summary.activity === 'running' &&
    result.summary.location === 'outdoor' &&
    echo.length === spec.blocks.length &&
    spec.blocks.every(
      (block, blockIndex) =>
        echo[blockIndex].iterations === block.iterations &&
        echo[blockIndex].steps.length === block.steps.length &&
        block.steps.every((step, stepIndex) => echo[blockIndex].steps[stepIndex].purpose === step.purpose && echo[blockIndex].steps[stepIndex].meters === step.goal.meters),
    );
  if (!same) {
    return { ok: false, reason: 'echo_mismatch', errors: [{ code: 'E_ECHO_MISMATCH', message: 'O CustomWorkout construido nao e identico ao spec recebido.', path: 'blocks' }] };
  }
  return { ok: true, summary: result.summary };
}
