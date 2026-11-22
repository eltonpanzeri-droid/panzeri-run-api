import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { RoutePoint } from './route';

// Mapa nativo (Apple Mapas no iPhone). 22/11/2026: separado em arquivo `.native` porque `react-native-maps` nao existe na web e quebrava a compilacao do PWA (deploys do panzeri-run-app falharam). Na web vale NativeMap.tsx (nunca usado).
const ROUTE_DOT = '#2DD4BF';

export function NativeMap({ points, drawn, marker, height, lineColor, onReady }: { points: RoutePoint[]; drawn: RoutePoint[]; marker: { lat: number; lon: number } | null; height: number; lineColor: string; onReady?: () => void }) {
  const ref = useRef<MapView>(null);
  const coordinates = useMemo(() => points.map((p) => ({ latitude: p.lat, longitude: p.lon })), [points]);
  const drawnCoordinates = useMemo(() => drawn.map((p) => ({ latitude: p.lat, longitude: p.lon })), [drawn]);
  const fit = useCallback(() => {
    ref.current?.fitToCoordinates(coordinates, { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: false });
  }, [coordinates]);
  useEffect(() => { fit(); }, [fit]);
  return (
    <View style={{ height, borderRadius: 16, overflow: 'hidden' }} pointerEvents="none" collapsable={false}>
      <MapView
        ref={ref} style={StyleSheet.absoluteFill} mapType="standard" userInterfaceStyle="dark" scrollEnabled={false} zoomEnabled={false} rotateEnabled={false} pitchEnabled={false} toolbarEnabled={false}
        showsUserLocation={false} onMapReady={fit} onMapLoaded={() => { fit(); setTimeout(() => onReady?.(), 500); }}
        initialRegion={{ latitude: coordinates[0].latitude, longitude: coordinates[0].longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 }}
      >
        <Polyline coordinates={drawnCoordinates} strokeColor={lineColor} strokeWidth={5} lineCap="round" lineJoin="round" />
        {marker ? <Marker coordinate={{ latitude: marker.lat, longitude: marker.lon }} anchor={{ x: 0.5, y: 0.5 }}><View style={styles.dot} /></Marker> : null}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  dot: { width: 16, height: 16, borderRadius: 8, backgroundColor: ROUTE_DOT, borderWidth: 3, borderColor: '#FFFFFF' },
});
