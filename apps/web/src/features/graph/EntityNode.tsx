import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { typeColorVar } from './graphModel';
import type { EntityFlowNode } from './graphModel';

function initials(name: string): string {
  const words = name.split(/[\s_-]+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) {
    const chars = [...words[0]];
    return (chars[0] + (chars[1] ?? '')).toUpperCase();
  }
  return ([...words[0]][0] + [...words[words.length - 1]][0]).toUpperCase();
}

/**
 * Circular initials avatar, tinted by entity type, diameter scaled from
 * mentionCount. Invisible top/bottom handles anchor edges on the rim.
 */
function EntityNode({ data, selected }: NodeProps<EntityFlowNode>) {
  const { entity, diameter } = data;
  const color = typeColorVar(entity.type);
  const hiddenHandle = { opacity: 0, border: 'none', width: 6, height: 6 } as const;

  return (
    <div
      className="relative flex items-center justify-center rounded-full transition-shadow"
      style={{
        width: diameter,
        height: diameter,
        backgroundColor: color,
        boxShadow: selected
          ? `0 0 0 3px var(--c-bg), 0 0 0 5px ${color}`
          : `0 0 0 1px var(--c-surface)`,
      }}
      title={`${entity.canonicalName} · ${entity.mentionCount} mentions`}
    >
      <Handle type="target" position={Position.Top} style={hiddenHandle} isConnectable={false} />
      <span
        className="select-none font-semibold"
        style={{ color: 'var(--g-on)', fontSize: Math.max(11, Math.round(diameter * 0.32)) }}
      >
        {initials(entity.canonicalName)}
      </span>
      <Handle type="source" position={Position.Bottom} style={hiddenHandle} isConnectable={false} />
      <span className="nodrag nopan pointer-events-none absolute top-full left-1/2 mt-xs w-32 -translate-x-1/2 truncate text-center text-caption text-ink2">
        {entity.canonicalName}
      </span>
    </div>
  );
}

export const MemoEntityNode = memo(EntityNode);
