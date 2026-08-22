import { createFileRoute } from '@tanstack/react-router'
import { LoopsBoardPage } from '../features/loops/LoopsBoardPage'

export const Route = createFileRoute('/loops')({
  component: LoopsBoardPage,
})
