import { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  ENTITY_TYPE_ORDER,
  entityMeta,
  type EntityType,
} from '../src/lib/entityType';
import { createMobileLogger } from '../src/lib/log';
import { hairlineWidth, radius, space } from '../src/theme/tokens';
import { useTheme } from '../src/theme/useTheme';

const log = createMobileLogger('entities');

type Filter = 'all' | EntityType;

/**
 * Your world — the index into the memory graph. Every kind of node the second
 * brain knows: people, places, orgs, projects, topics, events. Filter by kind;
 * tap any node to open its page (profile, facts, connections, local graph).
 */
export default function EntitiesScreen() {
  const { colors, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<EntityListItem[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'refresh') setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await api.listEntities();
      setItems(res.entities);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Could not load your world.';
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

  // Only offer chips for kinds that actually exist, in canonical order.
  const presentTypes = useMemo(() => {
    const seen = new Set(items.map((e) => e.type));
    return ENTITY_TYPE_ORDER.filter((t) => seen.has(t));
  }, [items]);

  const visible = useMemo(
    () => (filter === 'all' ? items : items.filter((e) => e.type === filter)),
    [items, filter],
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={{ paddingTop: insets.top }}>
        <ModalHeader title="Your world" />
      </View>

      {!loading && presentTypes.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          style={styles.chipsRow}
        >
          <FilterChip
            label="All"
            active={filter === 'all'}
            onPress={() => setFilter('all')}
          />
          {presentTypes.map((t) => {
            const meta = entityMeta(t);
            return (
              <FilterChip
                key={t}
                label={meta.plural}
                icon={meta.icon}
                color={meta.color(dark)}
                active={filter === t}
                onPress={() => setFilter(t)}
              />
            );
          })}
        </ScrollView>
      )}

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

          {visible.length === 0 && !error ? (
            <EmptyState
              title="Nothing here yet"
              caption="As you capture memories that mention people, places, projects, and moments, they'll show up here to explore."
            />
          ) : (
            <View style={styles.list}>
              {visible.map((ent, i) => {
                const meta = entityMeta(ent.type);
                const tint = meta.color(dark);
                return (
                  <Animated.View
                    key={ent.id}
                    entering={FadeInDown.delay(Math.min(i, 10) * 30)
                      .springify()
                      .damping(18)
                      .stiffness(220)}
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
                      <View style={[styles.avatar, { backgroundColor: `${tint}1F` }]}>
                        <Feather name={meta.icon} size={16} color={tint} />
                      </View>
                      <View style={styles.cardBody}>
                        <AppText variant="body" tone="ink">
                          {ent.canonicalName}
                        </AppText>
                        <AppText variant="caption" tone="ink3" numberOfLines={1}>
                          {ent.profile
                            ? ent.profile
                            : `${meta.label} · mentioned ${ent.mentionCount} time${
                                ent.mentionCount === 1 ? '' : 's'
                              }`}
                        </AppText>
                      </View>
                      <Feather name="chevron-right" size={18} color={colors.ink3} />
                    </PressableScale>
                  </Animated.View>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function FilterChip({
  label,
  icon,
  color,
  active,
  onPress,
}: {
  label: string;
  icon?: keyof typeof Feather.glyphMap;
  color?: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <PressableScale
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      style={[
        styles.chip,
        {
          backgroundColor: active ? colors.ink : colors.surface,
          borderColor: active ? colors.ink : colors.hairline,
        },
      ]}
    >
      {icon && (
        <Feather name={icon} size={12} color={active ? colors.bg : (color ?? colors.ink2)} />
      )}
      <AppText variant="captionMedium" tone={active ? 'bg' : 'ink2'}>
        {label}
      </AppText>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  chipsRow: { flexGrow: 0 },
  chips: {
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 1,
    height: 32,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: hairlineWidth,
  },
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
