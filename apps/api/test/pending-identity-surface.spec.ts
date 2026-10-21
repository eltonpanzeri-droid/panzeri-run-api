import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ActivityExecutionController } from '../src/activity-execution/activity-execution.controller';
import { CoachController } from '../src/coach/coach.controller';

// Superficie da confirmacao de atividades ambiguas: rotas autenticadas (usuario SEMPRE do JWT, nunca do corpo) e tela do aluno discreta, sem pop-up,
// com os textos e as tres opcoes pedidos. Contrato por leitura do codigo-fonte do app (mesmo padrao dos outros testes de tela).
const mobile = (file: string) => readFileSync(join(__dirname, '..', '..', 'mobile', file), 'utf8');

describe('rotas do aluno', () => {
  const identityConfirmation = { pendingForStudent: jest.fn(async () => []), resolveAsStudent: jest.fn(async () => ({ status: 'resolved' })) };
  const controller = new ActivityExecutionController({} as never, {} as never, identityConfirmation as never);

  it('GET pending-identity e POST pending-identity/resolve existem, atras do guard JWT da classe', () => {
    expect(Reflect.getMetadata('path', ActivityExecutionController.prototype.pendingIdentity)).toBe('pending-identity');
    expect(Reflect.getMetadata('path', ActivityExecutionController.prototype.resolvePendingIdentity)).toBe('pending-identity/resolve');
    expect(Reflect.getMetadata('__guards__', ActivityExecutionController)).toHaveLength(1);
  });

  it('o aluno vem SEMPRE do token: um userId no corpo e ignorado', async () => {
    await controller.pendingIdentity({ sub: 'u1' } as never);
    expect(identityConfirmation.pendingForStudent).toHaveBeenCalledWith('u1');
    const body = { activityLogIds: ['a', 'b'], decision: 'same', userId: 'outro-aluno' };
    await controller.resolvePendingIdentity({ sub: 'u1' } as never, body);
    expect(identityConfirmation.resolveAsStudent).toHaveBeenCalledWith('u1', body);
  });
});

describe('rotas do treinador', () => {
  it('decidir, reverter e indicadores existem no controller protegido por coach/admin', () => {
    expect(Reflect.getMetadata('path', CoachController.prototype.resolveExternalActivityIdentity)).toBe('students/:studentId/external-activities/:activityLogId/identity-decision');
    expect(Reflect.getMetadata('path', CoachController.prototype.revertExternalActivityIdentity)).toBe('students/:studentId/external-activities/:activityLogId/identity-decision/revert');
    expect(Reflect.getMetadata('path', CoachController.prototype.identityQuality)).toBe('data/identity/quality');
    expect(Reflect.getMetadata('roles', CoachController)).toEqual(['coach', 'admin']);
  });

  it('o id do treinador vem do token e vai ao servico junto com o aluno da rota', async () => {
    const coachService = { resolveExternalActivityIdentity: jest.fn(async () => ({})), revertExternalActivityIdentity: jest.fn(async () => ({})) };
    const controller = new CoachController(coachService as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    await controller.resolveExternalActivityIdentity({ sub: 'coach-1' } as never, 'student-1', 'log-1', { decision: 'same' });
    expect(coachService.resolveExternalActivityIdentity).toHaveBeenCalledWith('student-1', 'coach-1', 'log-1', 'same');
    await controller.revertExternalActivityIdentity({ sub: 'coach-1' } as never, 'student-1', 'log-1');
    expect(coachService.revertExternalActivityIdentity).toHaveBeenCalledWith('student-1', 'coach-1', 'log-1');
  });
});

describe('tela do aluno — discreta, sem pop-up, com os textos e as tres opcoes', () => {
  const screen = mobile('home/PendingIdentity.tsx');

  it('textos, titulo e as tres opcoes pedidos', () => {
    expect(screen).toContain('Precisamos confirmar uma atividade');
    expect(screen).toContain('Recebemos dois registros muito semelhantes. Eles representam a mesma atividade física ou são atividades diferentes?');
    expect(screen).toContain('Isso pode acontecer quando recebemos registros de uma mesma atividade por diferentes dispositivos ou aplicativos.');
    for (const label of ['É a mesma atividade', 'São atividades diferentes', 'Responder depois']) expect(screen).toContain(label);
    expect(screen).toContain('Atividades para confirmar');
  });

  it('nunca pop-up/alerta/modal e nunca obrigatorio; "Responder depois" so fecha (nao chama a API)', () => {
    expect(screen).not.toMatch(/Modal|Alert\./);
    expect(screen).toContain('onPress={() => setOpenKey(null)} style={styles.laterButton}');
    expect(screen.match(/fetch\(/g)).toHaveLength(2); // leitura das pendencias + envio da resposta; nada mais
  });

  it('mostra so o que o dado informa: fonte, canal, data/hora, modalidade, distancia e duracao — sem fabricante/dispositivo', () => {
    expect(screen).not.toMatch(/observation.(device|manufacturer|deviceName|deviceModel)/); // nenhum campo de dispositivo/fabricante e' lido nem exibido
    expect(screen).toContain('observation.channelLabel');
    expect(screen).toMatch(/km \? <Text/); // distancia/duracao so aparecem quando existem
    expect(screen).toMatch(/duration \? <Text/);
  });

  it('aviso discreto na Home e secao no Historico, sem bloquear a Home', () => {
    const home = mobile('home/HomeScreen.tsx');
    expect(home).toContain('<PendingIdentityNotice accessToken={accessToken} onOpen={onOpenHistory} />');
    const app = mobile('App.tsx');
    expect(app).toContain('<PendingIdentitySection accessToken={accessToken} onResolved={() => setReloadKey((k) => k + 1)} />');
  });

  it('falha de rede/servidor nunca vira aviso nem bloqueio na leitura das pendencias', () => {
    expect(screen).toMatch(/catch \{\s*setPending\(\[\]\);/);
  });
});
