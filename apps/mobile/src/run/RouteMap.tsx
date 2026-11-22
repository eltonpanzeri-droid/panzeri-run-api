import React, { useEffect, useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { NativeMap } from './NativeMap';
import Svg, { Circle, Polyline as SvgPolyline } from 'react-native-svg';
import { RoutePoint, projectToBox } from './route';

// Mapa do percurso (21/11/2026). No iPhone usa o mapa nativo da Apple (sem custo e sem chave); no Android e no navegador desenha so' o trajeto (sem mapa de fundo) ate haver uma chave de mapa do Android.
// O percurso aparece INTEIRO, do primeiro ao ultimo ponto. `upTo` (0..1) desenha so' o trecho ja' percorrido, para o replay; `marker` e' a posicao atual do replay.
export const ROUTE_COLOR = '#2DD4BF';

type Props = {
  points: RoutePoint[];
  height: number;
  upTo?: number; // fracao do percurso desenhada (1 = tudo)
  marker?: { lat: number; lon: number } | null;
  onReady?: () => void; // mapa carregado (o cartao so' pode ser capturado depois disso)
  forceSketch?: boolean; // desenho sem mapa (cartao "sem fundo")
  lineColor?: string;
};

const useNativeMap = Platform.OS === 'ios';

export function RouteMap({ points, height, upTo = 1, marker = null, onReady, forceSketch = false, lineColor = ROUTE_COLOR }: Props) {
  const drawn = useMemo(() => points.slice(0, Math.max(2, Math.ceil(points.length * Math.min(1, Math.max(0, upTo))))), [points, upTo]);
  if (points.length === 0) return <View style={[styles.empty, { height }]} />;
  if (!useNativeMap || forceSketch) return <Sketch points={points} drawn={drawn} marker={marker} height={height} lineColor={lineColor} onReady={onReady} />;
  return <NativeMap points={points} drawn={drawn} marker={marker} height={height} lineColor={lineColor} onReady={onReady} />;
}

function Sketch({ points, drawn, marker, height, lineColor, onReady }: { points: RoutePoint[]; drawn: RoutePoint[]; marker: { lat: number; lon: number } | null; height: number; lineColor: string; onReady?: () => void }) {
  const width = 320;
  const all = useMemo(() => projectToBox([...points, ...(marker ? [{ lat: marker.lat, lon: marker.lon }] : [])], width, height, 16), [points, marker, height]);
  const path = all.slice(0, points.length);
  const shown = path.slice(0, drawn.length).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const markerXY = marker ? all[all.length - 1] : null;
  useEffect(() => { onReady?.(); }, [onReady]);
  return (
    <View style={{ height, alignItems: 'center', justifyContent: 'center' }} collapsable={false}>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <SvgPolyline points={path.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
        <SvgPolyline points={shown} fill="none" stroke={lineColor} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
        {path.length > 0 ? <Circle cx={path[0].x} cy={path[0].y} r={5} fill="#FFFFFF" /> : null}
        {markerXY ? <Circle cx={markerXY.x} cy={markerXY.y} r={7} fill={lineColor} stroke="#FFFFFF" strokeWidth={3} /> : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 16 },
});
