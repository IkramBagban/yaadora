import { createFileRoute } from '@tanstack/react-router'
import { PlaceholderPage } from '../components/layout/PlaceholderPage'

export const Route = createFileRoute('/ask')({
  component: () => <PlaceholderPage title="Ask" track="ask" />,
})
