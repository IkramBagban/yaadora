import { createFileRoute } from '@tanstack/react-router'
import { UserDetailPage } from '../features/admin/user-detail/UserDetailPage'

export const Route = createFileRoute('/admin/users/$id')({
  component: function AdminUserDetailRoute() {
    const { id } = Route.useParams()
    return <UserDetailPage userId={id} />
  },
})
