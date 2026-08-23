import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  type UseQueryResult,
} from '@tanstack/react-query'
import { request } from '../../api/client'
import type {
  AdminConversationsPayload,
  AdminMemoriesPage,
  AdminTurnsPayload,
  AdminUserActivityPayload,
  AdminUserProfilePayload,
  AdminUsersPage,
  EngineHealthPayload,
  GlobalActivityPayload,
  MeWithRole,
  MemoryStatusFilter,
  ReprocessResponse,
  UsageGranularity,
  UsagePayload,
} from './types'
import { isAdminRole } from './types'

/**
 * Admin API surface (issue #32 contract) + the TanStack Query hooks every
 * admin page reads through. All requests ride the shared `request<T>` client
 * so Clerk auth headers are attached automatically; a non-admin gets a 403
 * ApiError which pages translate into the "Admins only" gate.
 */

const STALE = 60_000

// --- Query keys -----------------------------------------------------------------

export const adminKeys = {
  all: ['admin'] as const,
  me: () => [...adminKeys.all, 'me'] as const,
  users: (query: string) => [...adminKeys.all, 'users', query] as const,
  user: (id: string) => [...adminKeys.all, 'user', id] as const,
  memories: (id: string, status: MemoryStatusFilter) =>
    [...adminKeys.all, 'user', id, 'memories', status] as const,
  conversations: (id: string) => [...adminKeys.all, 'user', id, 'conversations'] as const,
  turns: (id: string, cid: string) => [...adminKeys.all, 'user', id, 'turns', cid] as const,
  activity: (id: string, days: number) => [...adminKeys.all, 'user', id, 'activity', days] as const,
  usage: (id: string, granularity: UsageGranularity, span: number) =>
    [...adminKeys.all, 'user', id, 'usage', granularity, span] as const,
  globalActivity: (days: number) => [...adminKeys.all, 'activity', days] as const,
  engine: () => [...adminKeys.all, 'engine'] as const,
}

// --- Fetchers --------------------------------------------------------------------

/** GET /me — role-aware profile for the admin gate. */
export function fetchMeWithRole(): Promise<MeWithRole> {
  return request<MeWithRole>('/me')
}

export function fetchAdminUsers(query: string, cursor?: string): Promise<AdminUsersPage> {
  const params = new URLSearchParams({ limit: '50' })
  if (query) params.set('query', query)
  if (cursor) params.set('cursor', cursor)
  return request<AdminUsersPage>(`/admin/users?${params.toString()}`)
}

export function fetchAdminUserProfile(userId: string): Promise<AdminUserProfilePayload> {
  return request<AdminUserProfilePayload>(
    `/admin/users/${encodeURIComponent(userId)}`,
  )
}

export function fetchAdminUserMemories(
  userId: string,
  status: MemoryStatusFilter,
  cursor?: string,
): Promise<AdminMemoriesPage> {
  const params = new URLSearchParams({ status })
  if (cursor) params.set('cursor', cursor)
  return request<AdminMemoriesPage>(
    `/admin/users/${encodeURIComponent(userId)}/memories?${params.toString()}`,
  )
}

export function fetchAdminUserConversations(
  userId: string,
): Promise<AdminConversationsPayload> {
  return request<AdminConversationsPayload>(
    `/admin/users/${encodeURIComponent(userId)}/conversations`,
  )
}

export function fetchAdminConversationTurns(
  userId: string,
  conversationId: string,
): Promise<AdminTurnsPayload> {
  return request<AdminTurnsPayload>(
    `/admin/users/${encodeURIComponent(userId)}/conversations/${encodeURIComponent(conversationId)}/turns`,
  )
}

export function fetchAdminUserActivity(
  userId: string,
  days = 90,
): Promise<AdminUserActivityPayload> {
  return request<AdminUserActivityPayload>(
    `/admin/users/${encodeURIComponent(userId)}/activity?days=${days}`,
  )
}

export function fetchAdminUserUsage(
  userId: string,
  granularity: UsageGranularity,
  span = 6,
): Promise<UsagePayload> {
  return request<UsagePayload>(
    `/admin/users/${encodeURIComponent(userId)}/usage?granularity=${granularity}&span=${span}`,
  )
}

/** POST …/memories/:memoryId/reprocess — re-enqueue a failed capture. */
export function reprocessMemory(userId: string, memoryId: string): Promise<ReprocessResponse> {
  return request<ReprocessResponse>(
    `/admin/users/${encodeURIComponent(userId)}/memories/${encodeURIComponent(memoryId)}/reprocess`,
    { method: 'POST' },
  )
}

export function fetchGlobalActivity(days = 90): Promise<GlobalActivityPayload> {
  return request<GlobalActivityPayload>(`/admin/activity?days=${days}`)
}

export function fetchEngineHealth(): Promise<EngineHealthPayload> {
  return request<EngineHealthPayload>('/admin/engine')
}

// --- Hooks -----------------------------------------------------------------------

/**
 * Role gate source of truth. Until /me resolves WITH a role, `isAdmin` stays
 * false — the admin area renders its gate until the role is confirmed.
 */
export function useMe(): { me: UseQueryResult<MeWithRole>; isAdmin: boolean } {
  const me = useQuery({
    queryKey: adminKeys.me(),
    queryFn: fetchMeWithRole,
    staleTime: STALE,
    retry: false,
  })
  return { me, isAdmin: isAdminRole(me.data) }
}

export function useIsAdmin(): boolean {
  return useMe().isAdmin
}

/** Cursor-paginated users list; `query` is the debounced search term. */
export function useAdminUsers(query: string) {
  return useInfiniteQuery({
    queryKey: adminKeys.users(query),
    queryFn: ({ pageParam }) => fetchAdminUsers(query, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: STALE,
    placeholderData: (prev) => prev,
  })
}

export function useAdminUser(userId: string) {
  return useQuery({
    queryKey: adminKeys.user(userId),
    queryFn: () => fetchAdminUserProfile(userId),
    staleTime: STALE,
  })
}

/** Cursor-paginated records list for the user detail Records tab. */
export function useAdminUserMemories(userId: string, status: MemoryStatusFilter) {
  return useInfiniteQuery({
    queryKey: adminKeys.memories(userId, status),
    queryFn: ({ pageParam }) => fetchAdminUserMemories(userId, status, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: STALE,
    placeholderData: (prev) => prev,
  })
}

export function useAdminUserConversations(userId: string) {
  return useQuery({
    queryKey: adminKeys.conversations(userId),
    queryFn: () => fetchAdminUserConversations(userId),
    staleTime: STALE,
  })
}

export function useAdminConversationTurns(userId: string, conversationId: string | null) {
  return useQuery({
    queryKey: adminKeys.turns(userId, conversationId ?? ''),
    queryFn: () => fetchAdminConversationTurns(userId, conversationId!),
    enabled: conversationId !== null,
    staleTime: STALE,
  })
}

export function useAdminUserActivity(userId: string, days = 90) {
  return useQuery({
    queryKey: adminKeys.activity(userId, days),
    queryFn: () => fetchAdminUserActivity(userId, days),
    staleTime: STALE,
  })
}

export function useAdminUserUsage(
  userId: string,
  granularity: UsageGranularity,
  span = 6,
) {
  return useQuery({
    queryKey: adminKeys.usage(userId, granularity, span),
    queryFn: () => fetchAdminUserUsage(userId, granularity, span),
    staleTime: STALE,
    placeholderData: (prev) => prev,
  })
}

/** Reprocess mutation. Returns queued flag; callers flip the row badge optimistically. */
export function useReprocessMemory(userId: string) {
  return useMutation({
    mutationFn: (memoryId: string) => reprocessMemory(userId, memoryId),
  })
}

export function useGlobalActivity(days = 90) {
  return useQuery({
    queryKey: adminKeys.globalActivity(days),
    queryFn: () => fetchGlobalActivity(days),
    staleTime: STALE,
  })
}

export function useEngineHealth() {
  return useQuery({
    queryKey: adminKeys.engine(),
    queryFn: fetchEngineHealth,
    staleTime: STALE,
  })
}
