import { createFileRoute } from '@tanstack/react-router'
import { FactsPage } from '../features/facts/FactsPage'

export const Route = createFileRoute('/facts')({
  component: FactsPage,
})
