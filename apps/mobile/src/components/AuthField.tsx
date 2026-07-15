import { useState } from 'react';
import { View, TextInput, StyleSheet, type TextInputProps } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';
import { fonts, radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

type Props = TextInputProps & {
  label: string;
  /** Render as a password field with a show/hide toggle. */
  password?: boolean;
};

/**
 * Labeled text input matching the auth screens. When `password` is set it hides
 * the value and shows an eye toggle. All other TextInput props pass through.
 */
export function AuthField({ label, password, style, editable = true, ...inputProps }: Props) {
  const { colors } = useTheme();
  const [reveal, setReveal] = useState(false);

  return (
    <View>
      <AppText variant="captionMedium" tone="ink2" style={styles.label}>
        {label}
      </AppText>
      <View style={styles.fieldWrap}>
        <TextInput
          style={[
            styles.input,
            {
              color: colors.ink,
              backgroundColor: colors.surface,
              borderColor: colors.hairline,
              paddingRight: password ? space.xxxl + space.sm : space.md,
            },
            style,
          ]}
          placeholderTextColor={colors.ink3}
          editable={editable}
          secureTextEntry={password ? !reveal : inputProps.secureTextEntry}
          {...inputProps}
        />
        {password ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={reveal ? 'Hide password' : 'Show password'}
            onPress={() => setReveal((v) => !v)}
            hitSlop={12}
            style={styles.eye}
          >
            <Feather name={reveal ? 'eye-off' : 'eye'} size={18} color={colors.ink3} />
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    marginTop: space.sm,
    marginBottom: space.sm,
  },
  fieldWrap: {
    justifyContent: 'center',
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    fontSize: 16,
    fontFamily: fonts.sans,
  },
  eye: {
    position: 'absolute',
    right: space.md,
    height: '100%',
    justifyContent: 'center',
  },
});
