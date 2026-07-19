import { Text, type TextProps, type TextStyle } from 'react-native';
import { fonts, typeScale, type Palette, type TypeVariant } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

type Tone = keyof Palette;

interface AppTextProps extends TextProps {
  variant?: TypeVariant;
  tone?: Tone;
  /** Italic renders in the regular-weight italic cut (loaded for Geist 400). */
  italic?: boolean;
  align?: TextStyle['textAlign'];
}

export function AppText({
  variant = 'body',
  tone = 'ink',
  italic = false,
  align,
  style,
  ...rest
}: AppTextProps) {
  const { colors } = useTheme();
  const base = typeScale[variant];
  const fontFamily =
    italic && base?.fontFamily === fonts.sans ? fonts.sansItalic : base?.fontFamily;

  return (
    <Text
      {...rest}
      style={[base, { color: colors[tone], fontFamily, textAlign: align }, style]}
    />
  );
}
