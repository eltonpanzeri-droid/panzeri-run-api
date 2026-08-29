import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { PRColors } from './tokens';

// Simbolo "Triade Adaptativa" do Panzeri Run — tres colunas com um corte diagonal (o "Intervalo
// Vivo"), representando Planejado / Realizado / Proximo (ver identidade-visual-panzeri-run/
// README.md e 02-logos/symbol-primary.svg, que e' o master vetorial desta mesma forma).
//
// Desenhado como componente (Path direto, react-native-svg) em vez de importar o .svg do pacote
// de marca — evita depender de um transformer de SVG no Metro (react-native-svg-transformer),
// que exigiria mexer na config do bundler; ver aviso em CLAUDE_CODE_HANDOFF.md sobre confirmar
// suporte a SVG antes de adicionar dependencia nova. Fonte de verdade do desenho continua sendo
// o master em identidade-visual-panzeri-run/02-logos/symbol-primary.svg — qualquer ajuste de forma
// deve ser feito nos dois lugares.
const SYMBOL_PATHS = [
  'M39 28H79V83L39 101V28Z',
  'M39 116L79 98V212H39V116Z',
  'M100 28H140V118L100 136V28Z',
  'M100 151L140 133V212H100V151Z',
  'M161 28H201V96L161 114V28Z',
  'M161 129L201 111V212H161V129Z',
];

export function BrandMark({
  size = 32,
  color = PRColors.mineral,
  decorative = true,
  accessibilityLabel,
}: {
  size?: number;
  color?: string;
  /** true (padrao) esconde do leitor de tela — use false + accessibilityLabel quando o simbolo
   * for a unica pista visual de algo (raro; normalmente ha texto ao lado). */
  decorative?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 240 240"
      accessible={!decorative}
      accessibilityLabel={decorative ? undefined : accessibilityLabel}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'yes'}
    >
      {SYMBOL_PATHS.map((d) => (
        <Path key={d} d={d} fill={color} />
      ))}
    </Svg>
  );
}
