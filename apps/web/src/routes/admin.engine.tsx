import { createFileRoute } from '@tanstack/react-router'
import { EngineHealthPage } from '../features/admin/EngineHealthPage'

export const Route = createFileRoute('/admin/engine')({
  component: EngineHealthPage,
})
