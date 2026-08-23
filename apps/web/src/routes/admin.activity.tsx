import { createFileRoute } from '@tanstack/react-router'
import { ActivityRetentionPage } from '../features/admin/ActivityRetentionPage'

export const Route = createFileRoute('/admin/activity')({
  component: ActivityRetentionPage,
})
