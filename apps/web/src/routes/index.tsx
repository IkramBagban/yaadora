import { createFileRoute } from '@tanstack/react-router'
import { PlaceholderPage } from '../components/layout/PlaceholderPage'

export const Route = createFileRoute('/')({
  component: () => <PlaceholderPage title="Overview" track="overview" />,
})
