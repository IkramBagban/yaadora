import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { ChevronRight, Search, TriangleAlert, ZapOff } from 'lucide-react'
import { useAdminUsers } from './api'
import type { AdminUserRow } from './types'
import { AdminOnlyNotice, PageHeader, Panel } from './ui'
import {
  formatCompact,
  formatUsd,
  isForbidden,
  tableClasses,
  tdClasses,
  thClasses,
} from './lib'
import { Badge } from '../../components/ui/Badge'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { formatDate, formatRelative } from '../../lib/format'

/**
 * Users list — debounced search over email/id, core stat columns, and flag
 * chips (has-failures / insights-off). Cursor pagination via "Load more";
 * rows link into the full user detail page.
 */

const SEARCH_PLACEHOLDER = 'Search by email…'

export function UsersListPage() {
  const [query, setQuery] = useState('')
  const debounced = useDebouncedValue(query.trim(), 300)
  const users = useAdminUsers(debounced)

  if (users.isError && isForbidden(users.error)) {
    return <AdminOnlyNotice />
  }

  const pages = users.data?.pages ?? []
  const rows = pages.flatMap((p) => p.users)
  const nextCursor = pages.length > 0 ? pages[pages.length - 1]!.nextCursor : null

  return (
    <div className="flex flex-col gap-xl">
      <PageHeader
        title="Users"
        description="Everyone with a yaadora account."
        actions={
          <label className="relative w-72">
            <Search
              size={15}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={SEARCH_PLACEHOLDER}
              aria-label="Search users"
              className="pl-9"
            />
          </label>
        }
      />

      <Panel
        flush
        loading={users.isPending}
        error={users.isError}
        onRetry={() => void users.refetch()}
        isEmpty={rows.length === 0}
        emptyMessage={debounced ? `No users match “${debounced}”.` : 'No users yet.'}
      >
        <div className="overflow-x-auto">
          <table className={tableClasses}>
            <thead>
              <tr>
                <th className={thClasses}>Email</th>
                <th className={thClasses}>Joined</th>
                <th className={thClasses}>Last active</th>
                <th className={thClasses}>Streak</th>
                <th className={`${thClasses} text-right`}>Memories</th>
                <th className={`${thClasses} text-right`}>Tokens 30d</th>
                <th className={`${thClasses} text-right`}>Est. cost 30d</th>
                <th className={thClasses}>Flags</th>
                <th className={thClasses}>
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <UserRow key={u.id} user={u} />
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-center border-t border-hairline px-xl py-md">
          {users.isFetching ? (
            <Spinner size={16} />
          ) : nextCursor ? (
            <Button variant="secondary" size="sm" onClick={() => void users.fetchNextPage()}>
              Load more
            </Button>
          ) : rows.length > 0 ? (
            <p className="text-micro uppercase text-ink3">End of results</p>
          ) : null}
        </div>
      </Panel>
    </div>
  )
}

function UserRow({ user }: { user: AdminUserRow }) {
  return (
    <tr className="group transition-colors hover:bg-surface-alt">
      <td className={tdClasses}>
        <Link
          to="/admin/users/$id"
          params={{ id: user.id }}
          className="font-medium text-accent hover:underline"
        >
          {user.email}
        </Link>
        {user.role === 'admin' ? (
          <Badge tone="accent" className="ml-sm align-middle">
            admin
          </Badge>
        ) : null}
      </td>
      <td className={`${tdClasses} whitespace-nowrap text-ink2`}>{formatDate(user.createdAt)}</td>
      <td className={`${tdClasses} whitespace-nowrap text-ink2`}>
        {user.lastActiveAt ? formatRelative(user.lastActiveAt) : '—'}
      </td>
      <td className={tdClasses}>{user.streakDays > 0 ? `${user.streakDays}d` : '—'}</td>
      <td className={`${tdClasses} text-right tabular-nums`}>{formatCompact(user.memoriesTotal)}</td>
      <td className={`${tdClasses} text-right tabular-nums`}>{formatCompact(user.tokens30d)}</td>
      <td className={`${tdClasses} text-right tabular-nums`}>{formatUsd(user.cost30dEstUsd)}</td>
      <td className={tdClasses}>
        <div className="flex flex-wrap gap-xs">
          {user.flags.hasFailedMemories ? (
            <Badge tone="danger">
              <TriangleAlert size={11} aria-hidden="true" className="mr-1" />
              failures
            </Badge>
          ) : null}
          {user.flags.insightsDisabled ? (
            <Badge tone="pending">
              <ZapOff size={11} aria-hidden="true" className="mr-1" />
              insights off
            </Badge>
          ) : null}
          {!user.flags.hasFailedMemories && !user.flags.insightsDisabled ? (
            <span className="text-ink3">—</span>
          ) : null}
        </div>
      </td>
      <td className={`${tdClasses} text-ink3`}>
        <ChevronRight size={15} aria-hidden="true" />
      </td>
    </tr>
  )
}
