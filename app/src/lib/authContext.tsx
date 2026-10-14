import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { type AuthError, type Session, type User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'

const unavailable = (message: string) => ({ message }) as AuthError

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>
  signUp: (email: string, password: string, fullName?: string) => Promise<{ error: AuthError | null }>
  signInWithGitHub: () => Promise<{ error: AuthError | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const applySession = (nextSession: Session | null) => {
      if (cancelled) return
      setSession(nextSession)
      setUser(nextSession?.user ?? null)
      setLoading(false)
    }

    const clearToLogin = (error: unknown) => {
      console.error('Supabase auth session failed and was cleared:', error)
      applySession(null)
    }

    if (!supabase) {
      applySession(null)
      return
    }

    const client = supabase

    // Get initial session
    ;(async () => {
      try {
        const { data, error } = await client.auth.getSession()
        if (error) {
          clearToLogin(error)
          return
        }
        applySession(data.session)
      } catch (error) {
        clearToLogin(error)
      }
    })()

    // Listen for auth changes
    const { data: { subscription } } = client.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'TOKEN_REFRESHED' && !nextSession) {
        clearToLogin(new Error('Token refresh returned an empty session'))
        return
      }

      applySession(nextSession)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  const signIn = async (email: string, password: string) => {
    if (!supabase) return { error: unavailable('Cloud sign-in is not configured') }
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  const signUp = async (email: string, password: string, fullName?: string) => {
    if (!supabase) return { error: unavailable('Cloud sign-in is not configured') }
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    })
    return { error }
  }

  const signInWithGitHub = async () => {
    if (!supabase) return { error: unavailable('Cloud sign-in is not configured') }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: window.location.origin,
      },
    })
    return { error }
  }

  const signOut = async () => {
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  const value = {
    user,
    session,
    loading,
    signIn,
    signUp,
    signInWithGitHub,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
