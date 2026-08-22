import { createFileRoute } from '@tanstack/react-router'
import { PlaceholderPage } from '../components/layout/PlaceholderPage'

export const Route = createFileRoute('/settings')({
  component: () => <PlaceholderPage title="Settings" track="settings" />,
})
