import { useState } from 'react'
import { useAuth } from '../../lib/authContext'
import { ButtonSpinner } from '../Spinner/Spinner'

export function AuthModal({ onClose }: { onClose?: () => void }) {
  const { signIn, signUp, signInWithGitHub } = useAuth()
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [githubLoading, setGithubLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setMessage('')
    setIsLoading(true)

    try {
      const { error: authError } = isSignUp
        ? await signUp(email, password, fullName)
        : await signIn(email, password)

      if (authError) {
        setError(authError.message)
      } else {
        setMessage(isSignUp ? 'Check your email for confirmation!' : 'Welcome back!')
      }
    } catch (err) {
      setError('An unexpected error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  const handleGitHub = async () => {
    setError('')
    setMessage('')
    setGithubLoading(true)
    
    try {
      const { error } = await signInWithGitHub()
      if (error) {
        setError(error.message)
        setGithubLoading(false)
      }
      // If successful, redirect happens automatically
    } catch (err) {
      setError('Failed to connect to GitHub')
      setGithubLoading(false)
    }
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {/* Logo and Title */}
        <div style={styles.header}>
          <div style={styles.logo}>
            <span style={styles.logoIcon}>✦</span>
            <span style={styles.logoText}>avi</span>
          </div>
          <h2 style={styles.title}>{isSignUp ? 'Create your account' : 'Welcome back'}</h2>
          <p style={styles.subtitle}>
            {isSignUp ? 'Start editing videos with AI' : 'Sign in to sync projects, or keep editing on this computer'}
          </p>
        </div>
        
        {error && (
          <div style={styles.error}>
            <span style={styles.errorIcon}>⚠</span>
            {error}
          </div>
        )}
        {message && (
          <div style={styles.success}>
            <span style={styles.successIcon}>✓</span>
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit} style={styles.form}>
          {isSignUp && (
            <div style={styles.inputGroup}>
              <label style={styles.label}>Full Name</label>
              <input
                type="text"
                placeholder="John Doe"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                style={styles.input}
                onFocus={(e) => {
                  e.target.style.borderColor = '#e94560'
                  e.target.style.boxShadow = '0 0 0 3px rgba(233, 69, 96, 0.1)'
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = '#333'
                  e.target.style.boxShadow = 'none'
                }}
                required
                disabled={isLoading}
              />
            </div>
          )}
          <div style={styles.inputGroup}>
            <label style={styles.label}>Email</label>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
              onFocus={(e) => {
                e.target.style.borderColor = '#e94560'
                e.target.style.boxShadow = '0 0 0 3px rgba(233, 69, 96, 0.1)'
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#333'
                e.target.style.boxShadow = 'none'
              }}
              required
              disabled={isLoading}
            />
          </div>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Password</label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
              onFocus={(e) => {
                e.target.style.borderColor = '#e94560'
                e.target.style.boxShadow = '0 0 0 3px rgba(233, 69, 96, 0.1)'
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#333'
                e.target.style.boxShadow = 'none'
              }}
              required
              minLength={6}
              disabled={isLoading}
            />
            {isSignUp && (
              <p style={styles.passwordHint}>Must be at least 6 characters</p>
            )}
          </div>
          <button 
            type="submit" 
            style={{
              ...styles.button,
              opacity: isLoading ? 0.6 : 1,
              cursor: isLoading ? 'not-allowed' : 'pointer',
            }}
            disabled={isLoading}
            onMouseEnter={(e) => {
              if (!isLoading) {
                e.currentTarget.style.background = '#d63a54'
                e.currentTarget.style.transform = 'translateY(-1px)'
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#e94560'
              e.currentTarget.style.transform = 'translateY(0)'
            }}
          >
            {isLoading ? (
              <>
                <ButtonSpinner />
                <span>{isSignUp ? 'Creating account...' : 'Signing in...'}</span>
              </>
            ) : (
              <span>{isSignUp ? 'Create Account' : 'Sign In'}</span>
            )}
          </button>
        </form>

        <div style={styles.divider}>
          <div style={styles.dividerLine} />
          <span style={styles.dividerText}>or continue with</span>
          <div style={styles.dividerLine} />
        </div>

        <button 
          onClick={handleGitHub} 
          style={{
            ...styles.githubButton,
            opacity: githubLoading ? 0.6 : 1,
            cursor: githubLoading ? 'not-allowed' : 'pointer',
          }}
          disabled={githubLoading}
          onMouseEnter={(e) => {
            if (!githubLoading) {
              e.currentTarget.style.background = '#2a2a2a'
              e.currentTarget.style.borderColor = '#444'
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#252525'
            e.currentTarget.style.borderColor = '#333'
          }}
        >
          {githubLoading ? (
            <ButtonSpinner />
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
            </svg>
          )}
          <span>{githubLoading ? 'Connecting...' : 'GitHub'}</span>
        </button>

        {onClose && (
          <button type="button" onClick={onClose} style={styles.localButton}>
            Continue locally
          </button>
        )}

        <p style={styles.switchText}>
          {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            onClick={() => {
              setIsSignUp(!isSignUp)
              setError('')
              setMessage('')
            }}
            style={styles.switchButton}
            disabled={isLoading || githubLoading}
          >
            {isSignUp ? 'Sign In' : 'Sign Up'}
          </button>
        </p>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'linear-gradient(135deg, rgba(15, 15, 15, 0.95) 0%, rgba(30, 30, 30, 0.95) 100%)',
    backdropFilter: 'blur(10px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#1a1a1a',
    border: '1px solid #2a2a2a',
    borderRadius: 16,
    padding: '40px',
    width: '100%',
    maxWidth: 420,
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
  },
  header: {
    textAlign: 'center',
    marginBottom: 32,
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
  },
  logoIcon: {
    fontSize: 28,
    color: '#e94560',
  },
  logoText: {
    fontSize: 28,
    fontWeight: 800,
    color: '#fff',
    letterSpacing: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: '#fff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    margin: 0,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: '#aaa',
  },
  input: {
    padding: '12px 16px',
    background: '#252525',
    border: '1px solid #333',
    borderRadius: 8,
    color: '#fff',
    fontSize: 14,
    outline: 'none',
    transition: 'all 0.2s',
  },
  passwordHint: {
    fontSize: 11,
    color: '#666',
    margin: 0,
  },
  button: {
    padding: '14px 16px',
    background: '#e94560',
    border: 'none',
    borderRadius: 8,
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    transition: 'all 0.2s',
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    margin: '24px 0',
  },
  dividerLine: {
    flex: 1,
    height: 1,
    background: '#2a2a2a',
  },
  dividerText: {
    color: '#666',
    fontSize: 12,
    whiteSpace: 'nowrap',
  },
  githubButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: '12px 16px',
    background: '#252525',
    border: '1px solid #333',
    borderRadius: 8,
    color: '#fff',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  switchText: {
    textAlign: 'center',
    color: '#888',
    fontSize: 13,
    marginTop: 24,
    marginBottom: 0,
  },
  localButton: {
    width: '100%',
    marginTop: 16,
    padding: '12px 16px',
    background: 'transparent',
    border: '1px solid #333',
    borderRadius: 8,
    color: '#ccc',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  switchButton: {
    background: 'none',
    border: 'none',
    color: '#e94560',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    padding: 0,
  },
  error: {
    background: 'rgba(233, 69, 96, 0.1)',
    border: '1px solid rgba(233, 69, 96, 0.3)',
    color: '#e94560',
    padding: '12px 16px',
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  errorIcon: {
    fontSize: 16,
  },
  success: {
    background: 'rgba(5, 150, 105, 0.1)',
    border: '1px solid rgba(5, 150, 105, 0.3)',
    color: '#059669',
    padding: '12px 16px',
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  successIcon: {
    fontSize: 16,
    fontWeight: 700,
  },
}
