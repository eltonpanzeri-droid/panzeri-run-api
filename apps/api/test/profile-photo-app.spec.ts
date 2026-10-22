import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PHOTO_MAX_BYTES, PHOTO_SIDE, base64Bytes, centerSquareCrop, initialsOf } from '../../mobile/src/profilePhoto/photoMath';
import { PROFILE_PHOTO_MAX_BYTES } from '../src/profile-photo/profile-photo.service';

// Foto de perfil no app (21/10/2026): contas puras do recorte/compressao e a fiacao (cabecalho e Perfil leem a MESMA foto do servidor).
const mobile = (p: string) => readFileSync(join(__dirname, '..', '..', 'mobile', p), 'utf8');

describe('foto de perfil no app', () => {
  it('o limite do app fica abaixo do limite do servidor (a foto enviada nunca e recusada por tamanho)', () => {
    expect(PHOTO_MAX_BYTES).toBeLessThan(PROFILE_PHOTO_MAX_BYTES);
    expect(PHOTO_SIDE).toBe(320);
  });

  it('recorte central quadrado para imagem retrato e paisagem; quadrada nao precisa', () => {
    expect(centerSquareCrop(1000, 1500)).toEqual({ originX: 0, originY: 250, width: 1000, height: 1000 });
    expect(centerSquareCrop(1600, 900)).toEqual({ originX: 350, originY: 0, width: 900, height: 900 });
    expect(centerSquareCrop(500, 500)).toEqual({ originX: 0, originY: 0, width: 500, height: 500 });
  });

  it('tamanho do base64 sem decodificar e iniciais do avatar padrao', () => {
    const buf = Buffer.alloc(1001, 7);
    expect(base64Bytes(buf.toString('base64'))).toBe(1001);
    expect(base64Bytes(Buffer.alloc(1000).toString('base64'))).toBe(1000);
    expect(initialsOf('Maria da Silva')).toBe('MS');
    expect(initialsOf('  elton ')).toBe('E');
    expect(initialsOf('')).toBe('?');
  });

  it('fiacao: cabecalho e Perfil usam o mesmo estado vindo de GET /me/photo; envio/remocao so em /me/photo; plugin de fotos no app.json', () => {
    const app = mobile('App.tsx');
    expect(app).toContain('useProfilePhoto(API_URL, accessToken)');
    expect(app).toContain('photoUri={profilePhotoUri}');
    expect(app).toContain('<ProfilePhotoCard apiUrl={API_URL} accessToken={accessToken} name={userName} uri={profilePhotoUri} onChange={setProfilePhotoUri} />');
    const card = mobile('src/profilePhoto/ProfilePhoto.tsx');
    expect(card).toContain('/me/photo');
    expect(card).not.toMatch(/\/coach\//);
    expect(card).toContain("method: 'PUT'");
    expect(card).toContain("method: 'DELETE'");
    expect(mobile('app.json')).toContain('"expo-image-picker"');
  });
});
