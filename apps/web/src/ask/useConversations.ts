import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request } from '../api/client'
import type { ConversationList, ConversationSummary } from '../api/types'

/** Sidebar list of the user's conversations, newest activity first. */
export function useConversations() {
  return useQuery({
    queryKey: ['conversations'],
    queryFn: () => request<ConversationList>('/conversations'),
    staleTime: 30_000,
    select: (data) => data.conversations,
  })
}

/** POST /conversations — create an empty conversation. */
export function useCreateConversation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      request<ConversationSummary>('/conversations', { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
    },
  })
}
