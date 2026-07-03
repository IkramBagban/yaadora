import { Text, type TextProps, type TextStyle } from 'react-native';
import { fonts, typeScale, type Palette, type TypeVariant } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

type Tone = keyof Palette;

interface AppTextProps extends TextProps {
  variant?: TypeVariant;
  tone?: Tone;
  /** Italic is only available for serif variants (Instrument Serif ships an italic). */
  italic?: boolean;
  align?: TextStyle['textAlign'];
}

const SERIF_VARIANTS: TypeVariant[] = ['display', 'title', 'serifBody'];

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
    italic && SERIF_VARIANTS.includes(variant) ? fonts.serifItalic : base?.fontFamily;

  return (
    <Text
      {...rest}
      style={[base, { color: colors[tone], fontFamily, textAlign: align }, style]}
    />
  );
}
