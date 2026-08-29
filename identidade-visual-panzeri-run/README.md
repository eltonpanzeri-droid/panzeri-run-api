# Panzeri Run — Sistema de Marca

Entrega de identidade visual e kit de implementação, criada a partir da auditoria do produto real em 29 de agosto de 2026.

## Ideia central

O Panzeri Run não entrega uma sequência rígida de treinos. Ele interpreta continuamente a diferença entre o que foi planejado e o que aconteceu para decidir o próximo passo.

Essa ideia se torna visível na **Tríade Adaptativa**:

1. **Planejado** — a referência inicial.
2. **Realizado** — a realidade, que pode sair do alinhamento.
3. **Próximo** — a decisão seguinte, reorganizada a partir do que foi vivido.

O vazio diagonal em cada marca recebe o nome de **Intervalo Vivo**. É por ele que entram contexto, feedback, esforço, rotina, dor e evolução.

## Estrutura da pasta

- `00-diagnostico/` — auditoria e justificativa estratégica.
- `01-brand-guide/` — regras completas e guia rápido.
- `02-logos/` — assinaturas, símbolos e versões monocromáticas em SVG.
- `03-app-icons/` — masters para iOS, Android, PWA e splash.
- `04-graphic-system/` — padrões, divisores e elementos de composição.
- `05-social-templates/` — modelos editáveis para feed, Stories e capas.
- `06-web-assets/` — favicon, Open Graph e marca para a landing page.
- `07-design-tokens/` — cores, tipografia, espaçamento e tokens para web/React Native.
- `08-implementation/` — instruções e ordem de implementação para Claude Code.

## Regra de ouro

A marca deve comunicar **direção com adaptação**, nunca velocidade vazia. A Tríade não é um gráfico de crescimento, um pódio nem três barras decorativas. Sempre existe uma relação legível entre referência, realidade e próxima decisão.

## Primeiros arquivos para implementação

1. Leia `08-implementation/CLAUDE_CODE_HANDOFF.md`.
2. Use `07-design-tokens/tokens.ts` no app mobile e `tokens.css` na landing page.
3. Use `02-logos/symbol-primary.svg` como fonte vetorial principal do símbolo.
4. Gere PNGs de produção a partir dos masters SVG de `03-app-icons/` nos tamanhos exigidos pelas lojas.
5. Faça a migração visual tela a tela; não substitua todas as cores de forma cega.

## Status

Este pacote define a direção de marca e fornece masters vetoriais e tokens. A implementação no produto não faz parte desta entrega e deve ser feita em uma branch separada, com validação visual e de acessibilidade.
