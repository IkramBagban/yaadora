import { createFileRoute } from '@tanstack/react-router'
import { AskPage } from '../ask/AskPage'

export const Route = createFileRoute('/ask')({
  component: AskPage,
})
