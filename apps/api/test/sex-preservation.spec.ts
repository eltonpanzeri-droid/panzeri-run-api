import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateAnamneseDto } from '../src/me/dto/update-anamnese.dto';
import { UpdateProfileDto } from '../src/me/dto/update-profile.dto';
import { normalizeSex, resolveSexToSave } from '../src/me/me.service';

// 24/10/2026 — o formulario "Suas informacoes" do Perfil gravava sex='prefiro_nao_informar' fixo em PUT /me/anamnese, apagando "Feminino" e escondendo o
// "Registrar ciclo menstrual" do menu. A 1a correcao enviava o valor salvo ("Feminino"), mas o DTO so aceitava minusculas: o "Salvar" passaria a dar 400.
// Contrato: o servidor ACEITA os valores canonicos, normaliza, e o placeholder nunca sobrescreve um sexo ja informado.
const app = readFileSync(join(__dirname, '..', '..', 'mobile', 'App.tsx'), 'utf8');
const profile = (sex: string) => ({ name: 'Aluna Teste', email: 'aluna@example.com', birthDate: '1990-06-15', sex, heightCm: 168, weightKg: 62 });
const anamnese = (sex: string) => ({
  profile: profile(sex),
  health: { averageSleep: '7_8', stressLevel: 'moderado', anxietyLevel: 'leve', previousInjuries: '', healthProblems: '', medications: '' },
  preferences: { preferredModalities: ['Corrida'], otherModalities: [], trainingLocations: ['Corrida na rua'], mainGoal: 'Primeiros 10km', experienceLevel: 'iniciante_intermediario' },
});

describe('preservacao do sexo (menu do ciclo menstrual)', () => {
  it.each(['Feminino', 'Masculino', 'feminino', 'masculino', 'outro', 'prefiro_nao_informar'])('PUT /me/profile e /me/anamnese aceitam sex="%s"', (sex) => {
    expect(validateSync(plainToInstance(UpdateProfileDto, profile(sex)))).toHaveLength(0);
    expect(validateSync(plainToInstance(UpdateAnamneseDto, anamnese(sex)))).toHaveLength(0);
  });
  it('valor invalido continua recusado', () => {
    expect(validateSync(plainToInstance(UpdateProfileDto, profile('qualquer')))).not.toHaveLength(0);
  });
  it('o servidor grava o valor canonico e o placeholder nunca apaga um sexo informado', () => {
    expect(normalizeSex('feminino')).toBe('Feminino');
    expect(normalizeSex(' MASCULINO ')).toBe('Masculino');
    expect(resolveSexToSave('prefiro_nao_informar', 'Feminino')).toBe('Feminino');
    expect(resolveSexToSave('prefiro_nao_informar', null)).toBe('prefiro_nao_informar');
    expect(resolveSexToSave('feminino', 'Masculino')).toBe('Feminino'); // escolha explicita vale
    expect(resolveSexToSave('Feminino', 'prefiro_nao_informar')).toBe('Feminino');
  });
  it('o app nunca envia o placeholder fixo e o menu do ciclo nao depende de maiusculas', () => {
    expect(app).not.toMatch(/sex:\s*'prefiro_nao_informar'\s*[,}]/);
    expect(app.match(/sex:\s*savedMe\?\.sex \?\? 'prefiro_nao_informar'/g)?.length).toBeGreaterThanOrEqual(3);
    expect(app).toContain('isFeminino={isFemaleSex(savedMe?.sex)}');
    expect(app).not.toMatch(/savedMe\?\.sex === 'Feminino'/);
  });
});
