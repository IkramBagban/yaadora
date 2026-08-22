import type { ReactNode } from 'react'
import { SignedIn, SignedOut } from '@clerk/clerk-react'
import { SignInPrompt } from './SignInPrompt'

interface AuthGateProps {
  children: ReactNode
}

export function AuthGate({ children }: AuthGateProps) {
  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut>
        <SignInPrompt />
      </SignedOut>
    </>
  )
}
