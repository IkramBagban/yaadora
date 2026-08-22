import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { FactView } from '../api/types'
import { FactsPage } from '../features/facts/FactsPage'

/** URL search params for /facts — ?view=history opts into full history
 *  (absent = current beliefs). Optional so plain /facts links stay valid. */
interface FactsSearch {
  view?: FactView
}

function validateSearch(search: Record<string, unknown>): FactsSearch {
  return { view: search.view === 'history' ? 'history' : undefined }
}

export const Route = createFileRoute('/facts')({
  validateSearch,
  component: function FactsRoute() {
    const { view } = Route.useSearch()
    const navigate = useNavigate({ from: '/facts' })

    return (
      <FactsPage
        view={view ?? 'current'}
        onViewChange={(next) =>
          navigate({
            search: (prev) => ({ ...prev, view: next === 'history' ? 'history' : undefined }),
          })
        }
      />
    )
  },
})
