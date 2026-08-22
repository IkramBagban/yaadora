import { SignInButton } from '@clerk/clerk-react'
import { Card } from '../ui/Card'

export function SignInPrompt() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-lg text-ink">
      <Card className="flex max-w-sm flex-col items-center gap-lg text-center">
        <span className="flex size-10 items-center justify-center rounded-md bg-accent font-bold text-on-accent">
          y
        </span>
        <div className="flex flex-col gap-xs">
          <h1 className="text-title font-semibold">Sign in to yaadora</h1>
          <p className="text-sub text-ink2">Your memories are waiting on the other side.</p>
        </div>
        <SignInButton mode="modal">
          <button
            type="button"
            className="h-10 rounded-md bg-accent px-xl font-medium text-on-accent transition-opacity hover:opacity-90"
          >
            Sign in
          </button>
        </SignInButton>
      </Card>
    </div>
  )
}
