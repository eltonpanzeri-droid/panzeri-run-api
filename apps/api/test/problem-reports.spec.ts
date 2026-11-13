import 'reflect-metadata';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProblemReportsService, PROBLEM_MAX_PER_DAY, decodeProblemImage } from '../src/problem-reports/problem-reports.service';

// "Relatar problema" (13/11/2026). Banco e Telegram FALSOS.
// JPEG minimo valido para o leitor de dimensoes (SOI + SOF0 16x16 + EOI).
const tinyJpeg = (() => {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x40, 0x00, 0x40, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9])]);
})();
const b64 = tinyJpeg.toString('base64');

function build(over: { dailyCount?: number } = {}) {
  const reports: any[] = [];
  const images: any[] = [];
  const prisma: any = {
    problemReport: {
      count: jest.fn(async () => over.dailyCount ?? 0),
      create: jest.fn(async ({ data }: any) => { const row = { id: `r${reports.length + 1}`, createdAt: new Date(), ...data, user: { name: 'Lorena Delfim', studentCode: 12 } }; reports.push(row); return row; }),
      findFirst: jest.fn(async ({ where }: any) => reports.find((r) => r.id === where.id && r.userId === where.userId) ?? null),
      findMany: jest.fn(async () => []),
      updateMany: jest.fn(async ({ where }: any) => ({ count: reports.some((r) => r.id === where.id) ? 1 : 0 })),
    },
    problemReportImage: {
      count: jest.fn(async ({ where }: any) => images.filter((i) => i.reportId === where.reportId).length),
      create: jest.fn(async ({ data }: any) => { const row = { id: `i${images.length + 1}`, ...data }; images.push(row); return row; }),
      findFirst: jest.fn(async () => null),
    },
  };
  const telegram = { notifyCoach: jest.fn(async () => undefined) };
  return { service: new ProblemReportsService(prisma, telegram as never), prisma, telegram, reports, images };
}

describe('Relatar problema', () => {
  it('cria o relato, limpa os dados do aparelho e AVISA no Telegram com aluna, aparelho e texto', async () => {
    const { service, telegram, reports } = build();
    const out = await service.create('u1', { type: 'error', message: 'O botão de sincronizar não habilita.', appVersion: '1.0.4', platform: 'ios', osVersion: '18.1', deviceModel: 'iPhone 12', expectedImages: 2 });
    expect(out).toEqual({ id: 'r1' });
    expect(reports[0]).toMatchObject({ userId: 'u1', type: 'error', appVersion: '1.0.4', platform: 'ios', deviceModel: 'iPhone 12' });
    const text = (telegram.notifyCoach.mock.calls as unknown as string[][])[0][0];
    expect(text).toContain('Erro');
    expect(text).toContain('Lorena Delfim');
    expect(text).toContain('0000012');
    expect(text).toContain('iPhone 12');
    expect(text).toContain('O botão de sincronizar não habilita.');
    expect(text).toContain('2 imagem');
  });

  it('o relato fica gravado mesmo se o Telegram falhar', async () => {
    const { service, telegram, reports } = build();
    telegram.notifyCoach.mockRejectedValueOnce(new Error('fora do ar'));
    await expect(service.create('u1', { type: 'suggestion', message: 'Seria bom ter modo escuro.' })).resolves.toEqual({ id: 'r1' });
    expect(reports).toHaveLength(1);
  });

  it('recusa tipo invalido, descricao vazia/curta/enorme e excesso de relatos no dia', async () => {
    const { service } = build();
    await expect(service.create('u1', { type: 'xyz', message: 'texto valido aqui' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create('u1', { type: 'error', message: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create('u1', { type: 'error', message: 'a'.repeat(2001) })).rejects.toBeInstanceOf(BadRequestException);
    const limited = build({ dailyCount: PROBLEM_MAX_PER_DAY });
    await expect(limited.service.create('u1', { type: 'error', message: 'texto valido aqui' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(limited.telegram.notifyCoach).not.toHaveBeenCalled();
  });

  it('imagem: so do proprio relato, JPEG pequeno, no maximo 3', async () => {
    const { service, images } = build();
    await service.create('u1', { type: 'error', message: 'texto valido aqui' });
    await expect(service.addImage('outra', 'r1', b64)).rejects.toBeInstanceOf(NotFoundException);
    for (let i = 0; i < 3; i += 1) await service.addImage('u1', 'r1', `data:image/jpeg;base64,${b64}`);
    expect(images).toHaveLength(3);
    await expect(service.addImage('u1', 'r1', b64)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('decodificacao recusa lixo, imagem grande demais e arquivo que nao e JPEG', () => {
    expect(() => decodeProblemImage('')).toThrow(BadRequestException);
    expect(() => decodeProblemImage('nao e base64!!')).toThrow(BadRequestException);
    expect(() => decodeProblemImage('A'.repeat(200000))).toThrow(BadRequestException);
    expect(() => decodeProblemImage(Buffer.from('PNGnaoJPEG-not-a-jpeg-at-all').toString('base64'))).toThrow(BadRequestException);
    expect(decodeProblemImage(b64).length).toBe(tinyJpeg.length);
  });

  it('treinador: situacao invalida recusada; resolver grava a data; relato inexistente da 404', async () => {
    const { service } = build();
    await service.create('u1', { type: 'error', message: 'texto valido aqui' });
    await expect(service.updateForCoach('r1', { status: 'xx' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateForCoach('r1', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateForCoach('r1', { status: 'resolved', coachNote: 'Corrigido no deploy.' })).resolves.toEqual({ ok: true });
    await expect(service.updateForCoach('nao-existe', { status: 'open' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
