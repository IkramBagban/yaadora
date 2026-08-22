import { createFileRoute } from '@tanstack/react-router'
import { PlaceholderPage } from '../components/layout/PlaceholderPage'

export const Route = createFileRoute('/facts')({
  component: () => <PlaceholderPage title="Facts" track="facts" />,
})
