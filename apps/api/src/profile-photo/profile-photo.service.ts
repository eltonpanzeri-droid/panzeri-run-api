import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Foto de perfil do aluno (21/10/2026). Uma linha por aluno (UserProfilePhoto) e' a referencia central: app do aluno e painel do treinador leem DAQUI, nada e' copiado.
// O app envia JPEG ja' recortado (quadrado), reduzido e comprimido; aqui so' se VALIDA (formato real pelos bytes, tamanho e dimensoes) — o servidor nao reprocessa a imagem.

export const PROFILE_PHOTO_MAX_BYTES = 60 * 1024;
export const PROFILE_PHOTO_MAX_SIDE = 1024;
export const PROFILE_PHOTO_MIN_SIDE = 64;

// Le largura/altura de um JPEG percorrendo os marcadores ate' o quadro SOFn. Devolve null se a estrutura for invalida.
export function jpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) return null;
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    if (marker === 0xff) { offset += 1; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (offset + 9 > buffer.length) return null;
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

export function decodeProfilePhoto(imageBase64: unknown): Buffer {
  if (typeof imageBase64 !== 'string' || imageBase64.length === 0) throw new BadRequestException('Envie a imagem.');
  const clean = imageBase64.replace(/^data:image\/jpeg;base64,/, '');
  if (clean.length > Math.ceil((PROFILE_PHOTO_MAX_BYTES * 4) / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) throw new BadRequestException('Imagem inválida ou grande demais.');
  const buffer = Buffer.from(clean, 'base64');
  if (buffer.length > PROFILE_PHOTO_MAX_BYTES) throw new BadRequestException('A foto precisa ter no máximo 60 KB. Escolha outra imagem.');
  if (buffer[buffer.length - 2] !== 0xff || buffer[buffer.length - 1] !== 0xd9) throw new BadRequestException('Formato de imagem não suportado. Use uma foto JPEG.');
  const size = jpegDimensions(buffer);
  if (!size) throw new BadRequestException('Formato de imagem não suportado. Use uma foto JPEG.');
  if (size.width > PROFILE_PHOTO_MAX_SIDE || size.height > PROFILE_PHOTO_MAX_SIDE || size.width < PROFILE_PHOTO_MIN_SIDE || size.height < PROFILE_PHOTO_MIN_SIDE) throw new BadRequestException('Dimensões de imagem fora do permitido.');
  return buffer;
}

@Injectable()
export class ProfilePhotoService {
  constructor(private readonly prisma: PrismaService) {}

  async set(userId: string, imageBase64: unknown) {
    const buffer = decodeProfilePhoto(imageBase64);
    const row = await this.prisma.userProfilePhoto.upsert({
      where: { userId },
      create: { userId, data: buffer, mimeType: 'image/jpeg', byteSize: buffer.length },
      update: { data: buffer, mimeType: 'image/jpeg', byteSize: buffer.length },
      select: { updatedAt: true },
    });
    return { hasPhoto: true, updatedAt: row.updatedAt.toISOString() };
  }

  // { dataUri, updatedAt } ou { dataUri: null } quando nao ha foto (o cliente mostra o avatar padrao).
  async get(userId: string) {
    const row = await this.prisma.userProfilePhoto.findUnique({ where: { userId }, select: { data: true, mimeType: true, updatedAt: true } });
    if (!row) return { dataUri: null, updatedAt: null };
    return { dataUri: `data:${row.mimeType};base64,${Buffer.from(row.data).toString('base64')}`, updatedAt: row.updatedAt.toISOString() };
  }

  async remove(userId: string) {
    await this.prisma.userProfilePhoto.deleteMany({ where: { userId } });
    return { hasPhoto: false };
  }

  // Para a listagem do painel: quais alunos tem foto e a versao (para cache), sem trazer os bytes.
  async versions(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.prisma.userProfilePhoto.findMany({ where: { userId: { in: userIds } }, select: { userId: true, updatedAt: true } });
    return new Map(rows.map((r) => [r.userId, r.updatedAt.toISOString()]));
  }
}
