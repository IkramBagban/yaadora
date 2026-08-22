import { createFileRoute } from '@tanstack/react-router'
import { PlaceholderPage } from '../components/layout/PlaceholderPage'

export const Route = createFileRoute('/entities/')({
  component: () => <PlaceholderPage title="Entities" track="entities" />,
})
