import { readFileSync } from 'fs';
import { join } from 'path';
import { planGeneratedEmail, planGeneratedPush } from '../src/training-plans/plan-generated-notice';

// 18/11/2026 (Elton): todo programa gerado vai tambem por e-mail, qualquer que seja a marca do relogio; quem usa Apple Watch e' lembrada de conferir se os treinos chegaram.
describe('avisos de programa gerado', () => {
  const base = 'Você registrou todos os treinos da semana passada. Parabéns!';

  it('push sem Apple Watch: so a mensagem base', () => {
    expect(planGeneratedPush(base, false)).toEqual({ title: '🏃 Seu novo programa chegou!', message: base });
  });
  it('push com Apple Watch: pede para conferir o relogio e sincronizar se nao chegou', () => {
    const push = planGeneratedPush(base, true);
    expect(push.message.startsWith(base)).toBe(true);
    expect(push.message).toContain('Confira se os treinos da semana chegaram ao seu Apple Watch');
    expect(push.message).toContain('Sincronizar envio de treinos ao relógio');
  });
  it('e-mail para qualquer aluna: saudacao, programa pronto, sem a parte do relogio', () => {
    const mail = planGeneratedEmail({ name: 'Fernanda Souza', baseMessage: base, usesAppleWatch: false });
    expect(mail.subject).toBe('Seu novo programa de treino chegou');
    expect(mail.content).toContain('Olá Fernanda,');
    expect(mail.content).toContain('programa de treino da semana está pronto');
    expect(mail.content).not.toContain('Apple Watch');
  });
  it('e-mail de quem usa Apple Watch leva o pedido de conferir', () => {
    const mail = planGeneratedEmail({ name: 'Volnei', baseMessage: base, usesAppleWatch: true });
    expect(mail.content).toContain('Confira se os treinos da semana chegaram ao seu Apple Watch');
  });
  it('nome vazio nao quebra e o texto nunca diz "plano de treino" nem "motor"', () => {
    const mail = planGeneratedEmail({ name: '  ', baseMessage: base, usesAppleWatch: true });
    expect(mail.content.startsWith('Olá tudo bem,')).toBe(true);
    expect(`${mail.subject} ${mail.content}`.toLowerCase()).not.toMatch(/plano de treino|motor/);
  });
});

describe('ligacao no servico de geracao', () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
  it('o e-mail e o push saem juntos, o e-mail nunca derruba a geracao, e o modulo importa o envio de e-mail', () => {
    const svc = read('src', 'training-plans', 'training-plans.service.ts');
    expect(svc).toContain("planGeneratedPush(notifMessage, usesAppleWatch)");
    expect(svc).toContain("trigger: 'plan_generated'");
    expect(svc).toMatch(/try \{\s*const email = planGeneratedEmail[\s\S]*?\} catch \(error\) \{[\s\S]*?E-mail de programa gerado nao enviado/);
    expect(read('src', 'training-plans', 'training-plans.module.ts')).toContain('MessagingModule');
  });
});
