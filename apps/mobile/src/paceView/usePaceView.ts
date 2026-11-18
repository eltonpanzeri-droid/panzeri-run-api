import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';
import type { PaceView } from './paceText';

// Escolha do aluno (ritmo ou velocidade), guardada no aparelho e compartilhada por todos os cartoes de treino abertos. Falha de leitura/gravacao nunca derruba a tela: fica o ritmo.
const KEY = 'panzeri_pace_view';
let current: PaceView = 'pace';
let loaded = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export function setPaceView(view: PaceView) {
  current = view;
  notify();
  AsyncStorage.setItem(KEY, view).catch(() => undefined);
}

export function usePaceView(): PaceView {
  const value = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => current);
  useEffect(() => {
    if (loaded) return;
    loaded = true;
    AsyncStorage.getItem(KEY).then((stored) => { if ((stored === 'speed' || stored === 'pace') && stored !== current) { current = stored; notify(); } }).catch(() => undefined);
  }, []);
  return value;
}
