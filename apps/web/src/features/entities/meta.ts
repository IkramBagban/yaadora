import {
  Building2,
  CalendarClock,
  Check,
  Flag,
  Folder,
  Link2,
  ListTodo,
  MapPin,
  Scale,
  Tag,
  User,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * Presentation metadata for entity types, edge statuses and open-loop kinds.
 * Values mirror packages/db/schema comments; unknown values fall back safely.
 */

export type EntityTone = 'person' | 'place' | 'org' | 'topic' | 'project' | 'event'

interface EntityTypeMeta {
  icon: LucideIcon
}

const TYPE_META: Record<EntityTone, EntityTypeMeta> = {
  person: { icon: User },
  place: { icon: MapPin },
  org: { icon: Building2 },
  topic: { icon: Tag },
  project: { icon: Folder },
  event: { icon: CalendarClock },
}

export const ENTITY_TYPES: readonly EntityTone[] = [
  'person',
  'place',
  'org',
  'topic',
  'project',
  'event',
]

export function entityTypeMeta(type: string): EntityTypeMeta {
  return TYPE_META[type as EntityTone] ?? { icon: Flag }
}

// --- Entity edges ---------------------------------------------------------------

export type EdgeStatus = 'active' | 'unresolved' | 'ended' | (string & {})

export const EDGE_STATUS_TONE: Record<string, 'success' | 'danger' | 'pending' | 'neutral'> = {
  active: 'success',
  unresolved: 'pending',
  ended: 'neutral',
}

// --- Open loops -------------------------------------------------------------------

export interface LoopKindMeta {
  icon: LucideIcon
}

const LOOP_KIND_META: Record<string, LoopKindMeta> = {
  commitment: { icon: Check },
  unresolved_conflict: { icon: Scale },
  upcoming_event: { icon: CalendarClock },
  goal: { icon: Flag },
  thread: { icon: Link2 },
}

export function loopKindMeta(kind: string): LoopKindMeta {
  return LOOP_KIND_META[kind] ?? { icon: ListTodo }
}
