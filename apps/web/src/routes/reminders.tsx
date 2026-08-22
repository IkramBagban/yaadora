import { createFileRoute } from '@tanstack/react-router'
import { PlaceholderPage } from '../components/layout/PlaceholderPage'

export const Route = createFileRoute('/reminders')({
  component: () => <PlaceholderPage title="Reminders" track="reminders" />,
})
