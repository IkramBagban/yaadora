import { memo, useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import type { RelationFlowEdge } from './graphModel';

/**
 * Bezier relation edge: stroke width scales with strength, dashed + faded
 * when the relation isn't active. Hovering (widened invisible hit path)
 * shows a small tooltip with the relation type.
 */
function RelationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<RelationFlowEdge>) {
  const [hovered, setHovered] = useState(false);
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  if (!data) return null;
  const inactive = data.status !== 'active';
  const stroke = hovered ? 'var(--c-accent)' : inactive ? 'var(--c-ink3)' : 'var(--c-ink2)';

  return (
    <>
      <g
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* invisible widened path so thin edges are still hoverable */}
        <path d={path} fill="none" stroke="transparent" strokeWidth={(data.width ?? 1) + 12} style={{ pointerEvents: 'stroke' }} />
        <BaseEdge
          id={id}
          path={path}
          style={{
            stroke,
            strokeWidth: data.width,
            strokeDasharray: inactive ? '5 4' : undefined,
            opacity: inactive ? 0.5 : 0.85,
          }}
        />
      </g>
      {hovered && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute z-10 rounded-sm border border-hairline bg-surface px-sm py-1 text-caption text-ink shadow-lg"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            <span className="font-medium">{data.relType}</span>
            <span className="text-ink3">
              {' · '}
              {inactive ? data.status : `${data.strength.toFixed(1)} strength`}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const MemoRelationEdge = memo(RelationEdge);
