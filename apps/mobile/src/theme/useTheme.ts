import { useColorScheme } from 'react-native';
import { palettes, type Palette } from './tokens';

export interface Theme {
  colors: Palette;
  dark: boolean;
}

export function useTheme(): Theme {
  const dark = useColorScheme() === 'dark';
  return { colors: dark ? palettes.dark : palettes.light, dark };
}
