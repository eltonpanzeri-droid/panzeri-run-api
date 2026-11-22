import React from 'react';
import { RoutePoint } from './route';

// Versao web: o mapa nativo nao existe no navegador (RouteMap desenha o trajeto sem fundo). Ver NativeMap.native.tsx.
export function NativeMap(_props: { points: RoutePoint[]; drawn: RoutePoint[]; marker: { lat: number; lon: number } | null; height: number; lineColor: string; onReady?: () => void }): React.ReactElement | null {
  return null;
}
