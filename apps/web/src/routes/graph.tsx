import { createFileRoute } from '@tanstack/react-router'
import { PlaceholderPage } from '../components/layout/PlaceholderPage'

export const Route = createFileRoute('/graph')({
  component: () => <PlaceholderPage title="Graph" track="graph" />,
})
