import { createFileRoute } from '@tanstack/react-router'
import { PlaceholderPage } from '../components/layout/PlaceholderPage'

export const Route = createFileRoute('/timeline')({
  component: () => <PlaceholderPage title="Timeline" track="timeline" />,
})
