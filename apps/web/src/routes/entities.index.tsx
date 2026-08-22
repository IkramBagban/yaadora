import { createFileRoute } from '@tanstack/react-router'
import { EntitiesIndexPage } from '../features/entities/EntitiesIndexPage'

export const Route = createFileRoute('/entities/')({
  component: EntitiesIndexPage,
})
