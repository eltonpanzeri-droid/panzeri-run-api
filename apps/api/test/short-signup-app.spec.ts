import * as fs from 'fs';
import * as path from 'path';
import * as mobile from '../../mobile/src/signup/shortSignup';
import * as server from '../src/common/short-signup';

// Cadastro curto no app (13/11/2026): as regras do app e do servidor precisam concordar, e a ligacao das telas precisa existir.
const read = (relative: string) => fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', relative), 'utf8');

describe('cadastro curto (app × servidor)', () => {
  const cpfs = ['529.982.247-25', '52998224725', '529.982.247-24', '111.111.111-11', '123', '', '000.000.000-00', '168.995.350-09', '16899535009'];
  const phones = ['(11) 91234-5678', '+55 11 91234-5678', '1133334444', '91234-5678', '11812345678', '', '(31) 99253-8375', '5531992538375'];

  it('CPF e telefone: o app e o servidor decidem igual', () => {
    for (const cpf of cpfs) expect({ cpf, valid: mobile.isValidCpf(cpf) }).toEqual({ cpf, valid: server.isValidCpf(cpf) });
    for (const phone of phones) expect({ phone, normalized: mobile.normalizeBrPhone(phone) }).toEqual({ phone, normalized: server.normalizeBrPhone(phone) });
  });

  it('mascaras de digitacao e mensagem do primeiro problema', () => {
    expect(mobile.formatCpfInput('52998224725')).toBe('529.982.247-25');
    expect(mobile.formatCpfInput('5299')).toBe('529.9');
    expect(mobile.formatPhoneInput('11912345678')).toBe('(11) 91234-5678');
    expect(mobile.formatPhoneInput('1133334444')).toBe('(11) 3333-4444');
    expect(mobile.shortSignupProblem({ name: 'A', phone: '11912345678', cpf: '52998224725' })).toContain('nome');
    expect(mobile.shortSignupProblem({ name: 'Ana', phone: '123', cpf: '52998224725' })).toContain('WhatsApp');
    expect(mobile.shortSignupProblem({ name: 'Ana', phone: '11912345678', cpf: '111.111.111-11' })).toContain('CPF');
    expect(mobile.shortSignupProblem({ name: 'Ana Souza', phone: '(11) 91234-5678', cpf: '529.982.247-25' })).toBeNull();
  });

  it('tela de cadastro envia CPF e telefone (so digitos) e valida antes; entrevista completa agora tem barreira e expectativa; o fluxo antigo segue com as 5 perguntas', () => {
    const app = read('App.tsx');
    expect(app).toContain('shortSignupProblem({ name, phone, cpf })');
    expect(app).toContain('cpf: onlyDigits(cpf),');
    expect(app).toContain('phone: onlyDigits(phone),');
    expect(app).toContain("{ ...QUICK_BARRIER_QUESTION, condition: (a) => a.quick_main_barrier === undefined },");
    expect(app).toContain("{ ...QUICK_EXPECTATIONS_QUESTION, condition: (a) => a.quick_expectations === undefined },");
    // o fluxo antigo (apps publicados) segue completo e o resumo pre-pagamento continua encontrando as duas perguntas
    const quick = app.slice(app.indexOf('const quickIntakeQuestions'));
    expect(quick.slice(0, 6000)).toContain('QUICK_BARRIER_QUESTION,');
    expect(app).toContain("quickIntakeQuestions.find((q) => q.key === 'quick_main_barrier')");
    // a rota para o pagamento depende do marco que o servidor ja grava no cadastro curto
    expect(app).toContain('interview?.quickIntakeCompletedAt');
  });
});
