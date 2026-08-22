import { createFileRoute } from '@tanstack/react-router'
import { PlaceholderPage } from '../components/layout/PlaceholderPage'

export const Route = createFileRoute('/rules')({
  component: () => <PlaceholderPage title="Rules" track="rules" />,
})
