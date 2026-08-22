import { createFileRoute } from '@tanstack/react-router'
import { TimelinePage } from '../components/timeline/TimelinePage'

export const Route = createFileRoute('/timeline')({
  component: TimelinePage,
})
