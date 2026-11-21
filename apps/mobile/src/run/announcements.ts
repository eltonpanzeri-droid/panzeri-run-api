// Avisos falados de transicao entre etapas (copiado do Panz Fit, 21/11/2026). Funcoes puras de texto.
import { ExecutableStep } from './workout';

function spokenDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} ${seconds === 1 ? 'segundo' : 'segundos'}`;
  const minuteText = `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
  return seconds === 0 ? minuteText : `${minuteText} e ${seconds} ${seconds === 1 ? 'segundo' : 'segundos'}`;
}

export function workoutPhaseLabel(step: Pick<ExecutableStep, 'phase'>) {
  switch (step.phase) {
    case 'recovery-active': return 'PAUSA ATIVA';
    case 'recovery-passive': return 'PAUSA PASSIVA';
    case 'work': return 'SÉRIE';
    case 'continuous': return 'CONTÍNUO';
    case 'warmup': return 'AQUECIMENTO';
    case 'cooldown': return 'VOLTA À CALMA';
  }
}

export function transitionAnnouncement(step: ExecutableStep | null, nextExists: boolean) {
  if (!step) return nextExists ? 'Iniciar próxima etapa.' : 'Treino estruturado concluído.';
  if (step.phase === 'recovery-active') {
    const amount = step.completion.kind === 'distance'
      ? `${Math.ceil(step.completion.meters)} ${Math.ceil(step.completion.meters) === 1 ? 'metro' : 'metros'}`
      : step.completion.kind === 'duration'
        ? spokenDuration(step.completion.seconds)
        : '';
    return `Iniciar pausa ativa${amount ? `, ${amount}` : ''}.`;
  }
  if (step.phase === 'recovery-passive') {
    const amount = step.completion.kind === 'duration'
      ? spokenDuration(step.completion.seconds)
      : step.completion.kind === 'distance'
        ? `${Math.ceil(step.completion.meters)} ${Math.ceil(step.completion.meters) === 1 ? 'metro' : 'metros'}`
        : '';
    return `Iniciar pausa passiva${amount ? `, ${amount}` : ''}.`;
  }
  if (step.phase === 'work') {
    return step.repeat
      ? `Iniciar série ${step.repeat.iteration} de ${step.repeat.count}.`
      : 'Iniciar série.';
  }
  return `Iniciar ${step.name}.`;
}
