import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useAdminUser, useMe } from '../api'
import { ApiError } from '../../../api/client'
import type { AdminUserProfilePayload } from '../types'
import {
  AdminOnlyNotice,
  ListSkeleton,
  Panel,
  TabBar,
} from '../ui'
import { isForbidden } from '../lib'
import { Badge } from '../../../components/ui/Badge'
import { formatDate } from '../../../lib/format'
import { OverviewTab } from './OverviewTab'
import { RecordsTab } from './RecordsTab'
import { AskTab } from './AskTab'
import { TracksTab } from './TracksTab'
import { CostTab } from './CostTab'

/**
 * User detail shell: identity header + inner tab bar (Overview · Records ·
 * Ask · Tracks · AI & Cost). Each tab owns its data fetching in its own file
 * so this shell stays small and fast-refresh boundaries stay clean.
 */

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'records', label: 'Records' },
  { id: 'ask', label: 'Ask' },
  { id: 'tracks', label: 'Tracks' },
  { id: 'cost', label: 'AI & Cost' },
] as const

type TabId = (typeof TABS)[number]['id']

export function UserDetailPage({ userId }: { userId: string }) {
  const [tab, setTab] = useState<TabId>('overview')
  const profile = useAdminUser(userId)
  const { isAdmin } = useMe()

  // The gate normally catches non-admins before any child route renders; a
  // 403 here means the role changed mid-session or /me lagged.
  if (profile.isError && isForbidden(profile.error)) {
    return <AdminOnlyNotice />
  }

  if (profile.isPending || !isAdmin) {
    return (
      <Panel title="Loading user…">
        <ListSkeleton />
      </Panel>
    )
  }

  if (profile.isError) {
    const notFound = profile.error instanceof ApiError && profile.error.status === 404
    return (
      <Panel
        title={notFound ? 'User not found' : 'Couldn’t load user'}
        error={notFound ? undefined : profile.error}
        onRetry={notFound ? undefined : () => void profile.refetch()}
      >
        <p className="text-caption text-ink2">
          {notFound
            ? 'This user id doesn’t exist (or was deleted).'
            : 'Something went wrong loading this user.'}
        </p>
      </Panel>
    )
  }

  const data = profile.data

  return (
    <div className="flex flex-col gap-xl">
      <Link
        to="/admin/users"
        className="inline-flex items-center gap-xs text-caption text-ink2 transition-colors hover:text-ink"
      >
        <ArrowLeft size={14} aria-hidden="true" />
        All users
      </Link>

      <UserHeader data={data} />

      <TabBar
        items={TABS}
        active={tab}
        onSelect={(id) => setTab(id as TabId)}
        ariaLabel="User detail sections"
      />

      {tab === 'overview' ? <OverviewTab userId={userId} overview={data.overview} devices={data.devices} /> : null}
      {tab === 'records' ? <RecordsTab userId={userId} /> : null}
      {tab === 'ask' ? <AskTab userId={userId} /> : null}
      {tab === 'tracks' ? <TracksTab userId={userId} /> : null}
      {tab === 'cost' ? <CostTab userId={userId} /> : null}
    </div>
  )
}

function UserHeader({ data }: { data: AdminUserProfilePayload }) {
  const { profile, overview } = data
  return (
    <header className="flex flex-wrap items-start justify-between gap-lg">
      <div className="flex min-w-0 flex-col gap-xs">
        <div className="flex items-center gap-sm">
          <h2 className="truncate text-title font-semibold">{profile.email}</h2>
          {profile.role === 'admin' ? <Badge tone="accent">admin</Badge> : null}
        </div>
        <p className="text-micro uppercase tracking-wide text-ink3">{profile.id}</p>
        <p className="text-caption text-ink2">
          Joined {formatDate(profile.createdAt)} · TZ {profile.timezone || '—'}
        </p>
      </div>
      <div className="flex flex-wrap gap-md text-right">
        <HeaderStat label="Memories" value={overview.memoriesTotal} />
        <HeaderStat label="Streak" value={`${overview.streakDays}d`} />
        <HeaderStat label="Active days 30d" value={overview.activeDays30} />
      </div>
    </header>
  )
}

function HeaderStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <span className="text-micro uppercase text-ink3">{label}</span>
      <span className="text-sub font-semibold tabular-nums">{value.toLocaleString()}</span>
    </div>
  )
}
