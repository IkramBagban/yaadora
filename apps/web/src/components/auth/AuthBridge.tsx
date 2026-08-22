import { useEffect, type ReactNode } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { setTokenGetter } from '../../api/client'

interface AuthBridgeProps {
  children: ReactNode
}

/** Registers the Clerk session token getter with the fetch layer. */
export function AuthBridge({ children }: AuthBridgeProps) {
  const { getToken } = useAuth()

  useEffect(() => {
    setTokenGetter(() => getToken())
    return () => setTokenGetter(async () => null)
  }, [getToken])

  return <>{children}</>
}
