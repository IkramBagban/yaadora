import { createFileRoute } from '@tanstack/react-router'
import { PlaceholderPage } from '../components/layout/PlaceholderPage'

export const Route = createFileRoute('/insights')({
  component: () => <PlaceholderPage title="Insights" track="insights" />,
})
