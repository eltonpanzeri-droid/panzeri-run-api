# Handoff para Claude Code

## Objetivo

Aplicar gradualmente a nova identidade do Panzeri Run sem alterar regras de negócio, fluxos de pagamento, prescrição, autenticação ou persistência. A mudança é visual e editorial; qualquer mudança funcional precisa de autorização separada.

## Antes de escrever código

1. Leia `README.md`, `00-diagnostico/DIAGNOSTICO_E_RACIONAL.md` e `01-brand-guide/BRAND_GUIDE.md` deste pacote.
2. Leia `PRONTUARIO.md` e as instruções locais do projeto.
3. Crie uma branch específica de identidade visual.
4. Tire capturas de referência das telas atuais nos estados mais importantes.
5. Não faça substituição global de hexadecimais: cores atuais têm significados diferentes.

## Ordem recomendada

### Fase 1 — Fundação

- Copiar `07-design-tokens/tokens.ts` para um módulo de tema do app.
- Instalar/carregar Big Shoulders Display, Public Sans e JetBrains Mono usando pacotes Expo compatíveis.
- Adicionar o símbolo SVG como asset, preservando o master original.
- Criar componentes básicos: `BrandMark`, `BrandWordmark`, `PRText`, `PRCard`, `PRButton`, `PRData`, `IntervalDivider`.
- Definir foco, estados desabilitados e contraste antes de migrar telas.

### Fase 2 — Momentos de marca

Migrar primeiro:

1. splash;
2. ícone do app;
3. onboarding;
4. login/cadastro;
5. cabeçalho e menu;
6. estado de geração do treino;
7. confirmação de treino registrado.

Esses pontos formam a percepção da marca sem colocar em risco a leitura da prescrição.

### Fase 3 — Núcleo de treinamento

- Tela da semana.
- Cards de corrida e força.
- Blocos de prescrição.
- Registro de execução.
- Orientação semanal.
- Relato de dor.
- Progresso e comparação Planejado/Realizado/Próximo.

Manter informações densas em Public Sans e dados em JetBrains Mono. Big Shoulders é reservada para títulos curtos e números de destaque.

### Fase 4 — Ecossistema

- Landing page.
- Painel administrativo.
- E-mails e páginas legais.
- Open Graph, favicon e imagens sociais.

O painel pode ser mais neutro, mas deve compartilhar tokens, tipografia e símbolo.

## Mapeamento inicial de cores

O mapeamento abaixo é ponto de partida, não busca e substituição:

| Uso atual | Novo papel |
|---|---|
| `#111827` / `#0f172a` | Mineral Noturno `#071827` |
| `#f8fafc` | Calcário Quente `#F4F0E6` em fundo; Branco em superfícies |
| `#0f766e` | Azul Profundo `#246F91` para informação e seleção |
| CTA principal azul profundo | Verde Pulso `#C7F36B` quando representar decisão primária |
| `#dbe4ea` / `#e2e8f0` | Pedra Clara `#D9D6CC` |
| `#475569` / `#334155` | Grafite `#364B59` |

Não usar Verde Pulso para alertas de dor ou erro; esses estados têm tokens semânticos próprios.

## Componentes de assinatura

### BrandMark

- Recebe `size`, `color` e `accessibilityLabel`.
- Em contexto decorativo, deve ser oculto do leitor de tela.
- Nunca recriar com caracteres ou três Views aproximadas quando o SVG puder ser usado.

### IntervalDivider

- Linha com uma abertura/ponte diagonal de 24°.
- Usar entre seções editoriais, não entre cada card.

### AdaptiveProgress

- Só usar quando houver estados reais de planejado, realizado e próximo.
- Sempre incluir rótulos; cor sozinha não comunica estado.

### SignatureMotion

- Três tempos, 560 ms no total, easing sem bounce.
- Desativar ou reduzir com preferência de movimento reduzido.

## Diretrizes específicas do app atual

- Substituir o `Ionicons name="pulse"` do onboarding pelo `BrandMark`.
- Unificar o ícone PWA, a marca da landing e o símbolo do onboarding.
- “Recomendação do motor” deve evoluir para linguagem centrada no corredor, como “Orientação da semana”; validar textos com Elton antes de alterar.
- Preservar estrutura dos cards de prescrição e formulários; estilizar depois de garantir legibilidade.
- Não esconder alertas de responsabilidade, dor ou emergência em componentes decorativos.
- Não prometer acompanhamento humano em tempo real.

## Fontes

Pacotes Expo sugeridos, confirmando compatibilidade com a versão atual antes de instalar:

- `@expo-google-fonts/big-shoulders-display`
- `@expo-google-fonts/public-sans`
- `@expo-google-fonts/jetbrains-mono`

Na landing existente, as fontes já estão incorporadas. Reutilizar os arquivos/font-face atuais ou migrar conscientemente; não adicionar chamadas externas desnecessárias.

## SVG no React Native

Confirmar se `react-native-svg` está disponível na versão do Expo. Preferir componente SVG para cor dinâmica e asset PNG apenas onde a plataforma exigir. Não adicionar dependência sem revisar impacto no build Android/iOS.

## Testes mínimos

- PWA em Safari iOS e Chrome Android.
- App nativo em iPhone físico e emulador Android.
- Ícone em máscaras Android distintas.
- Texto aumentado em 200%.
- Leitor de tela nos principais botões.
- Contraste WCAG AA.
- Tema claro/escuro onde aplicável.
- Estados: carregando, erro, bloqueado, pago, entrevista pendente, treino vazio, dor, treino concluído.
- Screenshots comparativos antes/depois.

## Critérios de aceite

- Um único símbolo em app, landing e materiais.
- Nenhuma tela perdeu informação ou ação.
- O sistema parece Panzeri Run mesmo sem o nome visível.
- Verde Pulso é usado com disciplina.
- Dados esportivos permanecem rápidos de ler.
- A marca não parece clínica, academia genérica ou startup de IA.
- Nenhuma regra de negócio foi modificada inadvertidamente.
