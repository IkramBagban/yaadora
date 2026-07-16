import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Feather from '@expo/vector-icons/Feather';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { api, ApiError } from '../src/api/client';
import type { EntityListItem } from '../src/api/types';
import { AppText } from '../src/components/AppText';
import { EmptyState } from '../src/components/EmptyState';
import { ModalHeader } from '../src/components/ModalHeader';
import { PressableScale } from '../src/components/PressableScale';
import { createMobileLogger } from '../src/lib/log';
import { hairlineWidth, radius, space } from '../src/theme/tokens';
import { useTheme } from '../src/theme/useTheme';

const log = createMobileLogger('entities');

/**
 * People & projects list (spec 03 P3) — a simple index into the graph. Tapping
 * a person or project opens their entity page.
 */
export default function EntitiesScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<EntityListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'refresh') setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await api.listEntities();
      // People and projects are the tappable kinds worth listing first.
      setItems(
        res.entities.filter((e) => e.type === 'person' || e.type === 'project'),
      );
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Could not load people.';
      log.warn('listEntities failed', { message });
      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load('initial');
  }, [load]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={{ paddingTop: insets.top }}>
        <ModalHeader title="People & projects" />
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + space.xxxl },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load('refresh')}
              tintColor={colors.ink3}
            />
          }
        >
          {error ? (
            <AppText variant="caption" tone="danger" style={styles.error}>
              {error}
            </AppText>
          ) : null}

          {items.length === 0 && !error ? (
            <EmptyState
              title="No people or projects yet"
              caption="As you capture memories that mention people and projects, they'll show up here to explore."
            />
          ) : (
            <View style={styles.list}>
              {items.map((ent, i) => (
                <Animated.View
                  key={ent.id}
                  entering={FadeInDown.delay(i * 30).springify().damping(18).stiffness(220)}
                  layout={LinearTransition.springify().damping(20).stiffness(240)}
                >
                  <PressableScale
                    onPress={() => {
                      void Haptics.selectionAsync();
                      router.push({ pathname: '/entity/[id]', params: { id: ent.id } });
                    }}
                    style={[
                      styles.card,
                      { backgroundColor: colors.surface, borderColor: colors.hairline },
                    ]}
                  >
                    <View
                      style={[styles.avatar, { backgroundColor: colors.surfaceAlt }]}
                    >
                      <Feather
                        name={ent.type === 'project' ? 'box' : 'user'}
                        size={16}
                        color={colors.ink2}
                      />
                    </View>
                    <View style={styles.cardBody}>
                      <AppText variant="body" tone="ink">
                        {ent.canonicalName}
                      </AppText>
                      <AppText variant="caption" tone="ink3" numberOfLines={1}>
                        {ent.profile
                          ? ent.profile
                          : `${ent.type} · mentioned ${ent.mentionCount} time${
                              ent.mentionCount === 1 ? '' : 's'
                            }`}
                      </AppText>
                    </View>
                    <Feather name="chevron-right" size={18} color={colors.ink3} />
                  </PressableScale>
                </Animated.View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: space.lg },
  error: { marginBottom: space.md },
  list: { gap: space.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: hairlineWidth,
    borderRadius: radius.md,
    padding: space.md,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1, gap: 2 },
});
