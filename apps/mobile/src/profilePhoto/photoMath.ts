// Funcoes puras da foto de perfil (sem React Native), separadas para serem testadas.

export const PHOTO_SIDE = 320;
export const PHOTO_MAX_BYTES = 55 * 1024;
export const QUALITIES = [0.75, 0.6, 0.45, 0.3];

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '')).toUpperCase();
}

// Tamanho em bytes de um base64 (sem decodificar).
export function base64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

// Recorte central quadrado quando a imagem nao e' quadrada (ex.: na web, onde nao ha' editor de recorte).
export function centerSquareCrop(width: number, height: number): { originX: number; originY: number; width: number; height: number } {
  const side = Math.min(width, height);
  return { originX: Math.floor((width - side) / 2), originY: Math.floor((height - side) / 2), width: side, height: side };
}
