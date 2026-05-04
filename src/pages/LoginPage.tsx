import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { FilmIcon } from '../components/icons'

export default function LoginPage() {
  const { user, loading, signIn } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-bg">
        <div className="text-ink-muted">読み込み中...</div>
      </div>
    )
  }

  if (user) {
    return <Navigate to="/" replace />
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    const { error } = await signIn(username, password)
    if (error) {
      setError(error)
    }
    setSubmitting(false)
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4 py-10 relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-30 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 20% 20%, rgba(212,165,116,0.15) 0%, transparent 50%), radial-gradient(circle at 80% 80%, rgba(212,165,116,0.08) 0%, transparent 45%)',
        }}
      />

      <div className="relative w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/30 flex items-center justify-center text-accent mb-3">
            <FilmIcon size={28} />
          </div>
          <h1 className="text-xl font-bold text-ink tracking-wide">映画鑑賞サークル</h1>
          <p className="text-xs text-ink-muted mt-1">ログインして投票に参加</p>
        </div>

        <div className="bg-card rounded-2xl border border-line p-6 shadow-xl shadow-black/30">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-xs font-medium text-ink-muted mb-1.5">
                ユーザーID
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                className="w-full px-3 py-2.5 bg-bg border border-line rounded-lg text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
                placeholder="ユーザーIDを入力"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-medium text-ink-muted mb-1.5">
                パスワード
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full px-3 py-2.5 bg-bg border border-line rounded-lg text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
                placeholder="パスワードを入力"
              />
            </div>

            {error && (
              <p className="text-sm text-danger bg-danger-bg/60 border border-danger/30 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 bg-accent text-bg text-sm font-semibold rounded-lg hover:bg-accent-strong disabled:opacity-50 transition-colors"
            >
              {submitting ? 'ログイン中...' : 'ログイン'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
