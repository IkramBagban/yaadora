import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { Line } from 'react-native-svg';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { api } from '../api/client';
import type { EntityContextEdge } from '../api/types';
import { entityMeta } from '../lib/entityType';
import { durations } from '../theme/motion';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

const MAX_NEIGHBORS = 12;
const CANVAS_HEIGHT = 300;
const CROSS_FETCH_CAP = 8;

interface SimNode {
  id: string;
  name: string;
  type: string;
  known: boolean;
  focal: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface RenderEdge {
  aId: string;
  bId: string;
  relType?: string;
  cross?: boolean;
}

interface EntityGraphProps {
  focalId: string;
  focalName: string;
  focalType: string;
  edges: EntityContextEdge[];
  onOpen: (entityId: string) => void;
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * A real local knowledge graph: the focal entity and its actual relationship
 * edges, positioned by a small force simulation (nodes repel, links pull) so
 * the layout reflects structure rather than a fixed ring. Known neighbours are
 * tappable to walk the graph. Best-effort background fetches add edges *between*
 * neighbours when they exist, so clusters emerge — the thing that makes it a
 * graph and not a star.
 */
export function EntityGraph({
  focalId,
  focalName,
  focalType,
  edges,
  onOpen,
}: EntityGraphProps) {
  const { colors, dark } = useTheme();
  const [width, setWidth] = useState(0);
  const [crossEdges, setCrossEdges] = useState<RenderEdge[]>([]);

  // The visible neighbourhood: unique neighbours from the focal edges, capped.
  const neighbors = useMemo(() => {
    const seen = new Set<string>();
    const out: EntityContextEdge[] = [];
    for (const e of edges) {
      if (seen.has(e.otherId)) continue;
      seen.add(e.otherId);
      out.push(e);
      if (out.length >= MAX_NEIGHBORS) break;
    }
    return out;
  }, [edges]);

  const visibleIds = useMemo(
    () => new Set<string>([focalId, ...neighbors.map((n) => n.otherId)]),
    [focalId, neighbors],
  );

  // Best-effort: pull each known neighbour's context and keep any edge whose
  // other endpoint is also on screen — those are the neighbour-to-neighbour
  // links. Runs once; failures are silently ignored.
  useEffect(() => {
    let alive = true;
    const known = neighbors.filter((n) => n.otherIsKnownEntity).slice(0, CROSS_FETCH_CAP);
    if (known.length === 0) return;

    void Promise.allSettled(
      known.map((n) => api.getEntityContext(n.otherId)),
    ).then((results) => {
      if (!alive) return;
      const found = new Map<string, RenderEdge>();
      results.forEach((res, i) => {
        if (res.status !== 'fulfilled') return;
        const sourceId = known[i]!.otherId;
        for (const e of res.value.edges) {
          if (e.otherId === focalId) continue; // focal link already drawn
          if (!visibleIds.has(e.otherId)) continue;
          const key = pairKey(sourceId, e.otherId);
          if (!found.has(key)) {
            found.set(key, { aId: sourceId, bId: e.otherId, cross: true });
          }
        }
      });
      setCrossEdges([...found.values()]);
    });

    return () => {
      alive = false;
    };
  }, [neighbors, focalId, visibleIds]);

  // Force-directed layout, computed once positions are measurable.
  const nodes = useMemo<SimNode[]>(() => {
    if (width === 0) return [];
    const cx = width / 2;
    const cy = CANVAS_HEIGHT / 2;

    const sim: SimNode[] = [
      { id: focalId, name: focalName, type: focalType, known: true, focal: true, x: cx, y: cy, vx: 0, vy: 0 },
    ];
    neighbors.forEach((n, i) => {
      const angle = (i / neighbors.length) * Math.PI * 2;
      sim.push({
        id: n.otherId,
        name: n.otherName,
        type: n.otherType,
        known: n.otherIsKnownEntity,
        focal: false,
        x: cx + Math.cos(angle) * 90,
        y: cy + Math.sin(angle) * 90,
        vx: 0,
        vy: 0,
      });
    });

    const links = neighbors.map((n) => ({ a: focalId, b: n.otherId }));
    const idealLen = Math.min(width, CANVAS_HEIGHT) * 0.32;
    const REPULSION = 5200;

    for (let step = 0; step < 160; step++) {
      // Pairwise repulsion.
      for (let i = 0; i < sim.length; i++) {
        for (let j = i + 1; j < sim.length; j++) {
          const a = sim[i]!;
          const b = sim[j]!;
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let dist = Math.hypot(dx, dy) || 0.01;
          const force = REPULSION / (dist * dist);
          dx /= dist;
          dy /= dist;
          a.vx += dx * force;
          a.vy += dy * force;
          b.vx -= dx * force;
          b.vy -= dy * force;
        }
      }
      // Link attraction toward the ideal length.
      for (const link of links) {
        const a = sim.find((n) => n.id === link.a)!;
        const b = sim.find((n) => n.id === link.b)!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const force = (dist - idealLen) * 0.02;
        dx /= dist;
        dy /= dist;
        a.vx += dx * force;
        a.vy += dy * force;
        b.vx -= dx * force;
        b.vy -= dy * force;
      }
      // Integrate with damping; the focal node stays pinned at the centre.
      for (const n of sim) {
        if (n.focal) {
          n.vx = 0;
          n.vy = 0;
          continue;
        }
        n.x += n.vx * 0.16;
        n.y += n.vy * 0.16;
        n.vx *= 0.82;
        n.vy *= 0.82;
        // Keep nodes off the edges (room for the circle + its label).
        n.x = Math.max(46, Math.min(width - 46, n.x));
        n.y = Math.max(40, Math.min(CANVAS_HEIGHT - 44, n.y));
      }
    }
    return sim;
  }, [width, neighbors, focalId, focalName, focalType]);

  const focalEdges = useMemo<RenderEdge[]>(
    () =>
      neighbors.map((n) => ({
        aId: focalId,
        bId: n.otherId,
        relType: n.relType,
      })),
    [neighbors, focalId],
  );

  const posOf = (id: string) => nodes.find((n) => n.id === id);

  if (neighbors.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        style={[
          styles.canvas,
          { backgroundColor: colors.surface, borderColor: colors.hairline },
        ]}
      >
        {width > 0 && nodes.length > 0 && (
          <>
            <Svg width={width} height={CANVAS_HEIGHT} style={StyleSheet.absoluteFill}>
              {[...focalEdges, ...crossEdges].map((edge, i) => {
                const a = posOf(edge.aId);
                const b = posOf(edge.bId);
                if (!a || !b) return null;
                return (
                  <Line
                    key={`${edge.aId}-${edge.bId}-${i}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={edge.cross ? colors.accent : colors.ink3}
                    strokeOpacity={edge.cross ? 0.4 : 0.24}
                    strokeWidth={edge.cross ? 1.5 : 1}
                    strokeDasharray={edge.cross ? '4 4' : undefined}
                  />
                );
              })}
            </Svg>

            {nodes.map((node, i) => {
              const size = node.focal ? 60 : 48;
              const half = size / 2;
              const tint = entityMeta(node.type).color(dark);
              return (
                <Animated.View
                  key={node.id}
                  entering={ZoomIn.delay(node.focal ? 0 : 60 + i * 40)
                    .duration(durations.enter)
                    .springify()
                    .damping(15)}
                  style={[styles.nodeWrap, { left: node.x - half, top: node.y - half, width: size }]}
                >
                  <PressableScale
                    scaleTo={0.92}
                    disabled={node.focal || !node.known}
                    accessibilityRole="button"
                    accessibilityLabel={node.focal ? node.name : `Open ${node.name}`}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      onOpen(node.id);
                    }}
                    style={[
                      styles.node,
                      {
                        width: size,
                        height: size,
                        borderRadius: half,
                        backgroundColor: node.focal ? colors.accent : `${tint}24`,
                        borderColor: node.focal ? colors.accent : `${tint}55`,
                      },
                    ]}
                  >
                    {node.focal ? (
                      <AppText variant="captionMedium" tone="onAccent">
                        {initials(node.name)}
                      </AppText>
                    ) : (
                      <AppText variant="captionMedium" style={{ color: tint }}>
                        {initials(node.name)}
                      </AppText>
                    )}
                  </PressableScale>
                  <AppText
                    variant="caption"
                    tone={node.focal ? 'ink' : 'ink2'}
                    numberOfLines={1}
                    align="center"
                    style={styles.nodeLabel}
                  >
                    {node.name}
                  </AppText>
                </Animated.View>
              );
            })}
          </>
        )}
      </View>

      <Animated.View entering={FadeIn.delay(300).duration(durations.fade)}>
        <AppText variant="caption" tone="ink3" align="center">
          {crossEdges.length > 0
            ? 'Dashed links connect the people & projects around them · tap to explore'
            : 'Tap a connected person or project to explore'}
        </AppText>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.sm,
    marginBottom: space.lg,
  },
  canvas: {
    height: CANVAS_HEIGHT,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  nodeWrap: {
    position: 'absolute',
    alignItems: 'center',
  },
  node: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeLabel: {
    marginTop: space.xs,
    width: 84,
  },
});
