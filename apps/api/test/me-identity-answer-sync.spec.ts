import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MeService } from '../src/me/me.service';

// Melhorias pos-Bloco 3 (04/10/2026) — divergencia identificada: fixModule (correcao de "Dados
// pessoais" apos o onboarding, acionado por "Conta" -> "Editar dados") so gravava em
// OnboardingInterview.answers (JSON), nunca em User.phone/cpf/education/address — a fonte que
// cobranca/Telegram/painel de fato leem. saveOnboardingAnswer agora sincroniza so' o campo User
// correspondente a' chave editada, sem recalcular os demais (nunca sobrescreve um campo correto
// com um valor ausente/antigo do JSON) e sem tocar nome/nascimento/sexo/altura/peso (fonte propria:
// /me/profile via Conta, /me/anamnese via Perfil).

function buildService(overrides: {
  existingAnswers?: Record<string, unknown>;
  userUpdateImpl?: (args: unknown) => unknown;
  hasPreferences?: boolean;
} = {}) {
  const { existingAnswers = {}, userUpdateImpl, hasPreferences = true } = overrides;
  const preferencesUpdate = jest.fn().mockResolvedValue({});
  const userUpdate = jest.fn().mockImplementation(userUpdateImpl ?? (() => Promise.resolve({})));
  const prisma = {
    onboardingInterview: {
      findUnique: jest.fn().mockResolvedValue({ answers: existingAnswers }),
      upsert: jest.fn().mockImplementation(({ update }: { update: unknown }) => Promise.resolve(update)),
    },
    user: { update: userUpdate },
    userPreferences: { findUnique: jest.fn().mockResolvedValue(hasPreferences ? { userId: 'user-1' } : null), update: preferencesUpdate },
  };
  const noop = {} as never;
  const service = new MeService(prisma as never, noop, noop, noop, noop);
  return { service, userUpdate, preferencesUpdate };
}

describe('MeService.saveOnboardingAnswer — sincronizacao de identidade com User (correcao pos-Bloco 3)', () => {
  it('personal_phone: sincroniza User.phone com o valor recem-editado', async () => {
    const { service, userUpdate } = buildService();
    await service.saveOnboardingAnswer('user-1', { key: 'personal_phone', value: '11999990000', currentStep: 3 });
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { phone: '11999990000' } });
  });

  it('personal_education: sincroniza User.education, inclusive para null (aluno limpou o campo)', async () => {
    const { service, userUpdate } = buildService();
    await service.saveOnboardingAnswer('user-1', { key: 'personal_education', value: null, currentStep: 3 });
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { education: null } });
  });

  it('personal_cpf valido: sincroniza User.cpf normalizado', async () => {
    const { service, userUpdate } = buildService();
    await service.saveOnboardingAnswer('user-1', { key: 'personal_cpf', value: '111.444.777-35', currentStep: 3 });
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { cpf: expect.any(String) } });
  });

  it('personal_cpf invalido: nunca grava lixo em User.cpf (nao inventa)', async () => {
    const { service, userUpdate } = buildService();
    await service.saveOnboardingAnswer('user-1', { key: 'personal_cpf', value: '123', currentStep: 3 });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('personal_cpf duplicado (P2002): erro claro em vez de 500 generico', async () => {
    const { service } = buildService({
      userUpdateImpl: () => { throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }); },
    });
    await expect(service.saveOnboardingAnswer('user-1', { key: 'personal_cpf', value: '111.444.777-35', currentStep: 3 }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('chave de endereco: sincroniza User.address com o resumo completo (reusa as mesmas chaves existentes, nao so a editada)', async () => {
    const { service, userUpdate } = buildService({
      existingAnswers: { personal_address_city: 'Sao Paulo', personal_address_state: 'SP' },
    });
    await service.saveOnboardingAnswer('user-1', { key: 'personal_address_street', value: 'Rua das Flores', currentStep: 3 });
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { address: expect.stringContaining('Rua das Flores') } });
  });

  it('chave que NAO e de identidade (ex: objective): nunca toca em User; a correcao do objetivo atualiza o objetivo OPERACIONAL (UserPreferences.mainGoal)', async () => {
    const { service, userUpdate, preferencesUpdate } = buildService();
    await service.saveOnboardingAnswer('user-1', { key: 'objective', value: 'Correr 10km', currentStep: 3 });
    expect(userUpdate).not.toHaveBeenCalled();
    expect(preferencesUpdate).toHaveBeenCalledWith({ where: { userId: 'user-1' }, data: { mainGoal: 'Correr 10km' } });
  });

  it('antes da primeira conclusao (sem preferencias) o objetivo da entrevista nao cria nem altera preferencias', async () => {
    const { service, preferencesUpdate } = buildService({ hasPreferences: false });
    await service.saveOnboardingAnswer('user-1', { key: 'objective', value: 'Correr 10km', currentStep: 3 });
    expect(preferencesUpdate).not.toHaveBeenCalled();
  });

  it('nome/nascimento/sexo/altura/peso nunca sincronizam aqui (fonte propria em Conta/Perfil)', async () => {
    const { service, userUpdate } = buildService();
    await service.saveOnboardingAnswer('user-1', { key: 'personal_name', value: 'Nome Novo', currentStep: 3 });
    await service.saveOnboardingAnswer('user-1', { key: 'personal_birth_date', value: '2000-01-01', currentStep: 3 });
    await service.saveOnboardingAnswer('user-1', { key: 'personal_sex', value: 'Feminino', currentStep: 3 });
    expect(userUpdate).not.toHaveBeenCalled();
  });
});
