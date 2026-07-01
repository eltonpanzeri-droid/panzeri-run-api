import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateAnamneseDto } from './update-anamnese.dto';

function validPayload() {
  return {
    profile: {
      name: 'Aluno Teste',
      email: 'aluno@example.com',
      birthDate: '1990-06-15',
      sex: 'prefiro_nao_informar',
      heightCm: 175,
      weightKg: 72.5,
    },
    health: {
      averageSleep: '7_8',
      stressLevel: 'moderado',
      anxietyLevel: 'leve',
      previousInjuries: '',
      healthProblems: '',
      medications: '',
    },
    preferences: {
      preferredModalities: ['Corrida'],
      otherModalities: [],
      trainingLocations: ['Corrida na rua'],
      mainGoal: 'Primeiros 10km',
      experienceLevel: 'iniciante_intermediario',
    },
    availability: {
      availability: [
        {
          weekday: 1,
          noTraining: false,
          modalities: ['corrida'],
          availableMin: 45,
          modalityDurations: { corrida: 45 },
        },
        {
          weekday: 2,
          noTraining: true,
          modalities: [],
          availableMin: 0,
          modalityDurations: {},
        },
      ],
    },
  };
}

describe('UpdateAnamneseDto', () => {
  it('aceita o formulario completo enviado pelo aplicativo', () => {
    const dto = plainToInstance(UpdateAnamneseDto, validPayload());
    expect(validateSync(dto, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    expect(dto.profile.birthDate).toBeInstanceOf(Date);
  });

  it('rejeita altura fora do intervalo permitido', () => {
    const payload = validPayload();
    payload.profile.heightCm = 50;
    const dto = plainToInstance(UpdateAnamneseDto, payload);
    expect(validateSync(dto)).not.toHaveLength(0);
  });

  it('rejeita data de nascimento invalida', () => {
    const payload = validPayload();
    payload.profile.birthDate = 'data-invalida';
    const dto = plainToInstance(UpdateAnamneseDto, payload);
    expect(validateSync(dto)).not.toHaveLength(0);
  });
});
