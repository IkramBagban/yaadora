import { createFileRoute } from '@tanstack/react-router'
import { UsersListPage } from '../features/admin/UsersListPage'

export const Route = createFileRoute('/admin/users/')({
  component: UsersListPage,
})
