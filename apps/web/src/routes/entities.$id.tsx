import { createFileRoute } from '@tanstack/react-router'
import { EntityProfilePage } from '../features/entities/EntityProfilePage'

export const Route = createFileRoute('/entities/$id')({
  component: function EntityDetailRoute() {
    const { id } = Route.useParams()
    return <EntityProfilePage entityId={id} />
  },
})
