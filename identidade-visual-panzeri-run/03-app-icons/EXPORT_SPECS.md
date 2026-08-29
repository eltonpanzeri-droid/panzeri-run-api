# Especificações de exportação

Os SVGs são masters. As lojas e o Expo exigem PNGs em vários pontos; exporte sem alterar a composição.

## iOS

- Exportar `app-icon-ios-master.svg` em PNG 1024×1024, sRGB, sem transparência.
- Não arredondar cantos: o iOS aplica sua própria máscara.
- Manter o símbolo dentro da área segura atual.

## Android

- Foreground: exportar `adaptive-icon-foreground.svg` em PNG 432×432 com transparência.
- Background: usar a cor `#071827` ou exportar `adaptive-icon-background.svg` em 432×432.
- Testar máscaras circular, squircle, rounded square e teardrop.
- Para ícone legado, exportar `app-icon-ios-master.svg` em 512×512.

## PWA

- Exportar `pwa-icon-maskable.svg` em 512×512 e 192×192.
- Declarar `purpose: "any maskable"`.

## Splash

- O master é 1290×2796 em Calcário Quente. Em Expo, prefira `resizeMode: "contain"`, fundo `#F4F0E6` e um asset central derivado apenas do símbolo.

## Validação

Antes do release, conferir em aparelho real, modo claro/escuro, tela inicial lotada e visualização da loja em tamanho pequeno.
