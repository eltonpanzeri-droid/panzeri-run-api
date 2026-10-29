import React from 'react';
import { Text as NativeText, type TextProps } from 'react-native';
import { accentPt } from './ptAccent';

// Texto do aplicativo com a acentuação da apresentação corrigida (30/10/2026). Textos antigos foram escritos sem acento e muitos também são valores guardados; por isso a correção acontece só
// na hora de exibir: o valor original nunca muda. Só strings viram texto corrigido (filhos que não são texto passam intactos) e textos de uma palavra só ficam como estão, para não alterar nomes.
function fix(node: React.ReactNode): React.ReactNode {
  if (typeof node === 'string') return /\s/.test(node.trim()) ? accentPt(node) : node;
  if (Array.isArray(node)) return node.map((child, index) => (typeof child === 'string' ? <React.Fragment key={index}>{fix(child)}</React.Fragment> : child));
  return node;
}

export const Text = React.forwardRef<NativeText, TextProps>(function Text({ children, ...props }, ref) {
  return <NativeText ref={ref} {...props}>{fix(children)}</NativeText>;
});
