import Feather from '@expo/vector-icons/Feather';

/**
 * The kinds of node in the memory graph. These mirror the extraction enum in
 * packages/core/ingestion/extraction.ts — keep them in sync. "topic" is the
 * catch-all for concepts/ideas that aren't a person, place, org, project, or
 * event.
 */
export type EntityType =
  | 'person'
  | 'place'
  | 'org'
  | 'topic'
  | 'project'
  | 'event';

const KNOWN: EntityType[] = ['person', 'place', 'org', 'topic', 'project', 'event'];

interface TypeMeta {
  icon: keyof typeof Feather.glyphMap;
  /** Singular label ("Person"). */
  label: string;
  /** Plural label for filter chips / headings ("People"). */
  plural: string;
  /** Muted accent colour, per theme. Desaturated to fit the warm palette. */
  color: (dark: boolean) => string;
}

const META: Record<EntityType, TypeMeta> = {
  person: {
    icon: 'user',
    label: 'Person',
    plural: 'People',
    color: (d) => (d ? '#E29A63' : '#9C5227'), // sienna (the app accent)
  },
  place: {
    icon: 'map-pin',
    label: 'Place',
    plural: 'Places',
    color: (d) => (d ? '#7FB08F' : '#4C7A5C'), // muted green
  },
  org: {
    icon: 'briefcase',
    label: 'Organization',
    plural: 'Orgs',
    color: (d) => (d ? '#C9A265' : '#B08948'), // amber
  },
  project: {
    icon: 'box',
    label: 'Project',
    plural: 'Projects',
    color: (d) => (d ? '#9E978C' : '#6E675F'), // neutral ink
  },
  topic: {
    icon: 'hash',
    label: 'Topic',
    plural: 'Topics',
    color: (d) => (d ? '#8FB0CE' : '#5A7A9C'), // muted blue
  },
  event: {
    icon: 'calendar',
    label: 'Event',
    plural: 'Events',
    color: (d) => (d ? '#C09BC4' : '#8C5F90'), // muted plum
  },
};

const FALLBACK: TypeMeta = {
  icon: 'circle',
  label: 'Thing',
  plural: 'Other',
  color: (d) => (d ? '#9E978C' : '#6E675F'),
};

export function entityMeta(type: string): TypeMeta {
  return META[type as EntityType] ?? FALLBACK;
}

export function isKnownType(type: string): type is EntityType {
  return KNOWN.includes(type as EntityType);
}

/** Canonical order for filter chips. */
export const ENTITY_TYPE_ORDER: EntityType[] = KNOWN;
