import { useState, useEffect, useId, useRef, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export default function PasswordChangeModal({ onClose }: { onClose: () => void }) {
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
