import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 24/10/2026 — o formulario "Suas informacoes" do Perfil gravava sex='prefiro_nao_informar' fixo em PUT /me/anamnese, apagando "Feminino" e escondendo o
// "Registrar ciclo menstrual" do menu (isFeminino = savedMe.sex === 'Feminino'). Contrato: nenhum salvamento do app reescreve o sexo com o placeholder fixo,
// e o servidor nunca deixa o placeholder sobrescrever um sexo ja' informado.
const app = readFileSync(join(__dirname, '..', '..', 'mobile', 'App.tsx'), 'utf8');
const service = readFileSync(join(__dirname, '..', 'src', 'me', 'me.service.ts'), 'utf8');

describe('preservacao do sexo (menu do ciclo menstrual)', () => {
  it('o app nunca envia o placeholder como valor fixo de sexo', () => {
    expect(app).not.toMatch(/sex:\s*'prefiro_nao_informar'\s*[,}]/);
    expect(app.match(/sex:\s*savedMe\?\.sex \?\? 'prefiro_nao_informar'/g)?.length).toBeGreaterThanOrEqual(3);
  });
  it('o servidor mantem o sexo ja salvo quando o payload traz o placeholder', () => {
    expect(service).toMatch(/dto\.profile\.sex === 'prefiro_nao_informar' && currentSex \? currentSex : dto\.profile\.sex/);
    expect(service).toMatch(/sex: sexToSave,/);
  });
});
