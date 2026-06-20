import { useState, useEffect, useId, useRef, type FormEvent } from 'react'
import { NavLink, Outlet, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { CalendarIcon, FilmIcon, UsersIcon, LogOutIcon } from './icons'

export default function Layout() {
  const { user, profile, signOut } = useAuth()
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)

  const navItems = [{ to: '/', label: 'カレンダー', icon: CalendarIcon, end: true }]
  if (user) {
    navItems.push({ to: '/apply', label: '申請', icon: FilmIcon, end: false })
  }
  if (profile?.is_admin) {
    navItems.push({ to: '/admin', label: '管理', icon: UsersIcon, end: false })
  }

  return (
    <div className="min-h-screen bg-bg text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:rounded-lg focus:bg-accent focus:text-bg focus:text-sm focus:font-semibold"
      >
        本文へスキップ
      </a>
      <header className="sticky top-0 z-20 bg-bg/90 backdrop-blur border-b border-line">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <h1 className="text-base font-bold tracking-wide font-display shrink-0">
            <span className="text-accent" aria-hidden="true">
              ●
            </span>{' '}
            <span className="text-ink">映画鑑賞サークル</span>
          </h1>

          {/* デスクトップ用ナビ */}
          <nav className="hidden md:flex items-center gap-1" aria-label="メインナビゲーション">
            {navItems.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                    isActive
                      ? 'text-accent bg-accent/10'
                      : 'text-ink-muted hover:text-ink hover:bg-card'
                  }`
                }
              >
                <Icon size={18} />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            {user ? (
              <>
                <span className="text-sm text-ink-muted truncate max-w-[8rem]">
                  {profile?.display_name}
                </span>
                <button
                  onClick={() => setPasswordModalOpen(true)}
                  className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-line text-ink-muted hover:text-ink hover:border-accent/40 transition-colors"
                >
                  パスワード変更
                </button>
                <button
                  onClick={signOut}
                  aria-label="ログアウト"
                  className="p-2 -mr-2 text-ink-muted hover:text-ink transition-colors"
                >
                  <LogOutIcon />
                </button>
              </>
            ) : (
              <Link
                to="/login"
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent text-bg hover:bg-accent-strong transition-colors"
              >
                ログイン
              </Link>
            )}
          </div>
        </div>
      </header>

      <main id="main" className="max-w-3xl mx-auto px-4 pt-5 pb-28 md:pb-12">
        <Outlet />
      </main>

      {/* モバイル用ボトムナビ */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-20 bg-card/95 backdrop-blur border-t border-line"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="メインナビゲーション"
      >
        <div
          className="max-w-3xl mx-auto grid"
          style={{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }}
        >
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors ${
                  isActive ? 'text-accent' : 'text-ink-muted hover:text-ink'
                }`
              }
            >
              <Icon size={22} />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      {passwordModalOpen && (
        <PasswordChangeModal onClose={() => setPasswordModalOpen(false)} />
      )}
    </div>
  )
}

function PasswordChangeModal({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const pwId = useId()
  const confirmId = useId()
  const titleId = useId()
  const firstFieldRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    firstFieldRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < 6) {
      setMessage({ kind: 'err', text: 'パスワードは6文字以上で入力してください' })
      return
    }
    if (password !== confirm) {
      setMessage({ kind: 'err', text: '確認用パスワードが一致しません' })
      return
    }

    setSubmitting(true)
    setMessage(null)
    const { error } = await supabase.auth.updateUser({ password })
    setSubmitting(false)
    if (error) {
      setMessage({ kind: 'err', text: `パスワード変更に失敗しました: ${error.message}` })
      return
    }
    setPassword('')
    setConfirm('')
    setMessage({ kind: 'ok', text: 'パスワードを変更しました' })
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 px-4 py-6 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl border border-line bg-card p-5 space-y-4 shadow-xl"
        style={{ overscrollBehavior: 'contain' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="text-lg font-bold text-ink font-display">
              パスワード変更
            </h2>
            <p className="text-xs text-ink-muted mt-1">
              次回ログインから新しいパスワードを使います。
            </p>
          </div>
          <button
            onClick={onClose}
            className="px-2 py-1 text-xs rounded-md text-ink-muted hover:text-ink hover:bg-bg transition-colors"
          >
            閉じる
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor={pwId} className="block text-xs font-medium text-ink-muted mb-1.5">
              新しいパスワード
            </label>
            <input
              id={pwId}
              ref={firstFieldRef}
              type="password"
              name="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              className="w-full px-3 py-2.5 bg-bg border border-line rounded-lg text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
              placeholder="6文字以上"
            />
          </div>
          <div>
            <label htmlFor={confirmId} className="block text-xs font-medium text-ink-muted mb-1.5">
              確認用
            </label>
            <input
              id={confirmId}
              type="password"
              name="confirm-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              className="w-full px-3 py-2.5 bg-bg border border-line rounded-lg text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
            />
          </div>

          {message && (
            <p
              aria-live="polite"
              className={`text-sm rounded-lg border px-3 py-2 ${
                message.kind === 'ok'
                  ? 'text-success bg-success-bg/60 border-success/30'
                  : 'text-danger bg-danger-bg/60 border-danger/30'
              }`}
            >
              {message.text}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full px-4 py-2.5 bg-accent text-bg text-sm font-semibold rounded-lg hover:bg-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? '変更中…' : 'パスワードを変更'}
          </button>
        </form>
      </div>
    </div>
  )
}
