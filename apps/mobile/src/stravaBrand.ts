import type { ImageSourcePropType } from 'react-native';

// Marca Strava (05/10/2026). As Brand Guidelines do Strava exigem o botao OFICIAL "Connect with Strava" (laranja ou
// branco, 48 px de altura a 1x / 96 px a 2x), sem qualquer alteracao, e o selo "Powered by Strava" ou "Compatible with
// Strava" quando a integracao e' mencionada. Os arquivos oficiais NAO sao reproduzidos por nos: baixe-os no site de
// desenvolvedores do Strava (developers.strava.com/guidelines), coloque em apps/mobile/assets/strava/ e aponte aqui:
//
//   export const STRAVA_CONNECT_BUTTON: ImageSourcePropType | null = require('../assets/strava/btn_strava_connectwith_orange.png');
//   export const STRAVA_COMPATIBLE_LOGO: ImageSourcePropType | null = require('../assets/strava/api_logo_cptblWith_strava_horiz_orange.png');
//
// Enquanto forem null a tela usa um botao de texto PROVISORIO (nao conforme) — nao submeta ao review do Strava assim.
export const STRAVA_CONNECT_BUTTON: ImageSourcePropType | null = null;
export const STRAVA_COMPATIBLE_LOGO: ImageSourcePropType | null = null;
export const STRAVA_BUTTON_HEIGHT = 48;
