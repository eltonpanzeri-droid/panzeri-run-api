import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { decodeProfilePhoto, jpegDimensions, PROFILE_PHOTO_MAX_BYTES, ProfilePhotoService } from '../src/profile-photo/profile-photo.service';
import { ProfilePhotoCoachController } from '../src/profile-photo/profile-photo-coach.controller';
import { ACCOUNT_DELETE_ORDER } from '../src/account-deletion/account-deletion.service';

// Foto de perfil do aluno (21/10/2026): validacao pelos bytes reais, privacidade (so' o dono altera; treinador so' le), referencia central unica e exclusao com a conta.

// JPEG minimo sintetico: SOI, SOF0 (altura x largura), EOI. Basta para o validador (nao para renderizar).
function jpeg(width: number, height: number, padding = 0): Buffer {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x01, 0x01, 0x11, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]), sof, Buffer.alloc(padding, 1), Buffer.from([0xff, 0xd9])]);
}
const b64 = (b: Buffer) => b.toString('base64');

describe('validacao da foto (formato real, tamanho e dimensoes)', () => {
  it('aceita JPEG valido, com ou sem prefixo data:', () => {
    expect(jpegDimensions(jpeg(320, 320))).toEqual({ width: 320, height: 320 });
    expect(decodeProfilePhoto(b64(jpeg(320, 320, 1000)))).toHaveLength(jpeg(320, 320, 1000).length);
    expect(decodeProfilePhoto(`data:image/jpeg;base64,${b64(jpeg(320, 320))}`)).toBeInstanceOf(Buffer);
  });

  it('recusa: vazio, nao-base64, PNG/GIF/texto disfarçado, JPEG truncado, grande demais e dimensoes fora do limite', () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200)]);
    for (const bad of [undefined, null, '', 123, '%%%', b64(png), b64(Buffer.from('<script>alert(1)</script>')), b64(jpeg(320, 320).subarray(0, 12))]) {
      expect(() => decodeProfilePhoto(bad)).toThrow(BadRequestException);
    }
    expect(() => decodeProfilePhoto(b64(jpeg(320, 320, PROFILE_PHOTO_MAX_BYTES)))).toThrow(BadRequestException); // > 60 KB
    expect(() => decodeProfilePhoto(b64(jpeg(4000, 4000)))).toThrow(BadRequestException);
    expect(() => decodeProfilePhoto(b64(jpeg(20, 20)))).toThrow(BadRequestException);
  });
});

function fakePrisma() {
  const rows = new Map<string, any>();
  let clock = 0;
  return {
    rows,
    userProfilePhoto: {
      upsert: jest.fn(async ({ where, create, update }: any) => { const row = { ...(rows.get(where.userId) ?? create), ...(rows.has(where.userId) ? update : {}), updatedAt: new Date(1792540800000 + ++clock * 1000) }; rows.set(where.userId, row); return row; }),
      findUnique: jest.fn(async ({ where }: any) => rows.get(where.userId) ?? null),
      findMany: jest.fn(async ({ where }: any) => [...rows.values()].filter((r) => where.userId.in.includes(r.userId))),
      deleteMany: jest.fn(async ({ where }: any) => { rows.delete(where.userId); return { count: 1 }; }),
    },
    user: { findUnique: jest.fn(async ({ where }: any) => (where.id === 'a1' ? { id: 'a1' } : null)) },
  };
}

describe('servico: uma referencia central por aluno', () => {
  it('salva, substitui (mesma linha, sem duplicar), le como data URI e exclui; sem foto devolve dataUri nulo (avatar padrao)', async () => {
    const prisma = fakePrisma(); const service = new ProfilePhotoService(prisma as never);
    expect(await service.get('a1')).toEqual({ dataUri: null, updatedAt: null });
    const first = await service.set('a1', b64(jpeg(320, 320, 50)));
    const second = await service.set('a1', b64(jpeg(320, 320, 90)));
    expect(prisma.rows.size).toBe(1); // substituir nao cria segunda copia
    expect(second.updatedAt > first.updatedAt).toBe(true); // versao nova => cache dos clientes invalida
    const got = await service.get('a1');
    expect(got.dataUri).toMatch(/^data:image\/jpeg;base64,/);
    expect(Buffer.from(got.dataUri!.split(',')[1], 'base64')).toHaveLength(jpeg(320, 320, 90).length);
    expect(await service.remove('a1')).toEqual({ hasPhoto: false });
    expect((await service.get('a1')).dataUri).toBeNull();
  });

  it('versions() devolve so' + " a versao (nunca os bytes) para a listagem do painel", async () => {
    const prisma = fakePrisma(); const service = new ProfilePhotoService(prisma as never);
    await service.set('a1', b64(jpeg(320, 320)));
    const map = await service.versions(['a1', 'a2']);
    expect([...map.keys()]).toEqual(['a1']);
    expect(typeof map.get('a1')).toBe('string');
    expect((await service.versions([])).size).toBe(0);
  });
});

describe('permissoes e exclusao', () => {
  it('treinador le a foto de um aluno existente (404 se nao existe); a rota do treinador e so de leitura sob guarda coach/admin', async () => {
    const prisma = fakePrisma(); const service = new ProfilePhotoService(prisma as never);
    await service.set('a1', b64(jpeg(320, 320)));
    const controller = new ProfilePhotoCoachController(service, prisma as never);
    expect((await controller.photo('a1')).dataUri).toMatch(/^data:image\/jpeg/);
    await expect(controller.photo('zz')).rejects.toBeInstanceOf(NotFoundException);
    const source = readFileSync(join(__dirname, '..', 'src', 'profile-photo', 'profile-photo-coach.controller.ts'), 'utf8');
    expect(source).toMatch(/@UseGuards\(AuthGuard\('jwt'\), RolesGuard\)\s*@Roles\('coach', 'admin'\)/);
    expect(source).not.toMatch(/@(Put|Post|Patch|Delete)\(/);
  });

  it('as rotas /me/photo usam SEMPRE o id do token (nunca um id da URL), logo o aluno so mexe na propria foto', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'me', 'me.controller.ts'), 'utf8');
    const block = source.slice(source.indexOf("@Get('photo')"), source.indexOf("@Get('observations") > 0 ? source.indexOf("@Get('observations") : undefined);
    expect(block).toContain('this.profilePhoto.get(user.sub)');
    expect(block).toContain('this.profilePhoto.set(user.sub, body?.imageBase64)');
    expect(block).toContain('this.profilePhoto.remove(user.sub)');
    expect(block).not.toMatch(/@Param\(/);
  });

  it('a foto e apagada junto com a conta', () => {
    expect(ACCOUNT_DELETE_ORDER as readonly string[]).toContain('userProfilePhoto');
  });
});
