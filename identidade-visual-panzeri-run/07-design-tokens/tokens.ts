export const PRColors = {
  mineral: '#071827', limestone: '#F4F0E6', pulse: '#C7F36B', ocean: '#246F91', mist: '#B8E6EF',
  white: '#FFFFFF', stone: '#D9D6CC', slate: '#748692', graphite: '#364B59',
  success: '#187A55', warning: '#A35C00', danger: '#B42318',
} as const;

export const PRFonts = {
  display: 'BigShouldersDisplay_800ExtraBold', bodyRegular: 'PublicSans_400Regular',
  bodyMedium: 'PublicSans_500Medium', bodyBold: 'PublicSans_700Bold',
  bodyExtraBold: 'PublicSans_800ExtraBold', data: 'JetBrainsMono_600SemiBold',
} as const;

export const PRRadius = { xs: 6, sm: 8, md: 12, lg: 20, pill: 999 } as const;
export const PRSpace = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 } as const;

export const PRTheme = {
  light: {
    background: PRColors.limestone, surface: PRColors.white, text: PRColors.mineral,
    textMuted: PRColors.graphite, border: PRColors.stone, action: PRColors.mineral,
    actionAccent: PRColors.pulse, info: PRColors.ocean,
  },
  dark: {
    background: PRColors.mineral, surface: '#102A3A', text: PRColors.limestone,
    textMuted: '#B8CBD4', border: '#315366', action: PRColors.pulse,
    actionAccent: PRColors.mineral, info: PRColors.mist,
  },
} as const;
