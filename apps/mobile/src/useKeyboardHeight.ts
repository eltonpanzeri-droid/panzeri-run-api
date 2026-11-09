import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import { coveredByKeyboard } from './keyboardLayout';

// Altura atual do teclado (0 com o teclado fechado). Nativo: eventos do Keyboard. Web (PWA/navegador): visualViewport.
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS === 'web') {
      const viewport = typeof window !== 'undefined' ? (window as unknown as { visualViewport?: { height: number; offsetTop: number; addEventListener: (type: string, fn: () => void) => void; removeEventListener: (type: string, fn: () => void) => void } }).visualViewport : undefined;
      if (!viewport) return undefined;
      const update = () => setHeight(coveredByKeyboard(window.innerHeight, viewport.height, viewport.offsetTop));
      viewport.addEventListener('resize', update);
      viewport.addEventListener('scroll', update);
      update();
      return () => {
        viewport.removeEventListener('resize', update);
        viewport.removeEventListener('scroll', update);
      };
    }
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (event) => setHeight(event.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
