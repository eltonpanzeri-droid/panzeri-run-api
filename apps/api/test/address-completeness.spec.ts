import * as fs from 'fs';
import * as path from 'path';
import { addressCompleteness } from '../src/common/address-completeness';

// Endereco completo (13/11/2026): so' leitura/aviso; nunca bloqueia. A tela nova exige os campos.
const full = { personal_cep: '30140-071', personal_address_street: 'Rua A', personal_address_number: '10', personal_address_neighborhood: 'Centro', personal_address_city: 'Belo Horizonte', personal_address_state: 'MG' };

describe('endereco completo', () => {
  it('completo: nada falta (complemento e opcional)', () => {
    expect(addressCompleteness(full)).toEqual({ complete: true, missing: [] });
  });
  it('lista exatamente o que falta, em portugues', () => {
    expect(addressCompleteness({ ...full, personal_address_street: '', personal_address_number: undefined })).toEqual({ complete: false, missing: ['rua', 'número'] });
    expect(addressCompleteness({ personal_cep: '30140-071' }).missing).toEqual(['rua', 'número', 'bairro', 'cidade', 'estado']);
    expect(addressCompleteness({}).missing).toEqual(['CEP', 'rua', 'número', 'bairro', 'cidade', 'estado']);
    expect(addressCompleteness(null).complete).toBe(false);
  });
  it('modo manual (sem CEP): cidade e estado substituem o CEP, mas rua, numero e bairro seguem necessarios', () => {
    const { personal_cep: _cep, ...manual } = full;
    expect(addressCompleteness(manual).complete).toBe(true);
    expect(addressCompleteness({ ...manual, personal_address_neighborhood: '  ' }).missing).toEqual(['bairro']);
  });
  it('a entrevista do app exige rua e bairro nos dois caminhos e nao trava quando o CEP vem sem rua/bairro', () => {
    const app = fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', 'App.tsx'), 'utf8');
    expect(app).toContain("filledAddress('personal_address_street') && filledAddress('personal_address_neighborhood')");
    expect(app).toContain('Este CEP não trouxe a rua ou o bairro. Complete para seguir:');
    expect(app).not.toContain('placeholder="Rua/Av. (opcional)"');
    // o servidor continua sem exigir (nao pode travar o ultimo passo dos apps antigos): so' avisa
    const me = fs.readFileSync(path.join(__dirname, '..', 'src', 'me', 'me.service.ts'), 'utf8');
    expect(me).not.toContain('addressCompleteness');
  });
});
