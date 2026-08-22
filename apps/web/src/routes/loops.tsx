import { createFileRoute } from '@tanstack/react-router'
import { PlaceholderPage } from '../components/layout/PlaceholderPage'

export const Route = createFileRoute('/loops')({
  component: () => <PlaceholderPage title="Loops" track="loops" />,
})
