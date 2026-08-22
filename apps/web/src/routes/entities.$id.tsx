import { createFileRoute } from '@tanstack/react-router'
import { PlaceholderPage } from '../components/layout/PlaceholderPage'

export const Route = createFileRoute('/entities/$id')({
  component: function EntityDetailPage() {
    const { id } = Route.useParams()
    return <PlaceholderPage title={`Entity ${id}`} track="entities" />
  },
})
