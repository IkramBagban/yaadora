import { Link } from '@tanstack/react-router';
import type { Entity } from '../../api/types';
import { Box, Building2, FolderKanban, Hash, MapPin, User } from 'lucide-react';

const entityIcons: Record<string, typeof User> = {
  person: User,
  people: User,
  place: MapPin,
  location: MapPin,
  organization: Building2,
  org: Building2,
  company: Building2,
  project: FolderKanban,
  thing: Box,
  object: Box,
  topic: Hash,
};

/** Tappable entity chip linking to the entity page. */
export function EntityChip({ entity }: { entity: Entity }) {
  const Icon = entityIcons[entity.type.toLowerCase()] ?? Hash;
  return (
    <Link
      to="/entities/$id"
      params={{ id: entity.id }}
      className="inline-flex items-center gap-xs rounded-pill border border-hairline bg-surface px-sm py-1 text-caption text-ink2 transition-colors hover:border-accent/40 hover:text-ink"
    >
      <Icon size={13} aria-hidden />
      {entity.canonicalName}
    </Link>
  );
}
