import { useState, useEffect, type FormEvent } from 'react'
import { supabase, supabaseAdmin } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { PlusIcon } from '../components/icons'
import ActivityScheduleEditor from '../components/ActivityScheduleEditor'
import PeriodAdminPanel from '../components/PeriodAdminPanel'
import PreferenceListPanel from '../components/PreferenceListPanel'
import MemberRow from '../components/MemberRow'

type Profile = {
  id: string
  username: string
  display_name: string
  is_admin: boolean
  created_at: string
}

export default function AdminPage() {
  const { user } = useAuth()
  const [members, setMembers] = useState<Profile[]>([])
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const fetchMembers = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: true })
    setMembers(data ?? [])
  }

  useEffect(() => {
    fetchMembers()
  }, [])

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setSubmitting(true)

    const email = `${username.trim()}@circle.local`

    const { data, error: signUpError } = await supabaseAdmin.auth.signUp({
      email,
      password,
    })

    if (signUpError) {
      setError(`アカウント作成に失敗しました: ${signUpError.message}`)
      setSubmitting(false)
      return
    }

    if (data.user) {
      const { error: profileError } = await supabase.from('profiles').insert({
        id: data.user.id,
        username: username.trim(),
        display_name: displayName.trim(),
        is_admin: isAdmin,
      })

      if (profileError) {
        setError(`プロフィール作成に失敗しました: ${profileError.message}`)
        setSubmitting(false)
        return
      }
    }

    setSuccess(`「${displayName.trim()}」のアカウントを作成しました`)
    setUsername('')
    setDisplayName('')
    setPassword('')
    setIsAdmin(false)
    setSubmitting(false)
    fetchMembers()
  }

  return (
    <div className="space-y-8">
      <section className="space-y-5">
      <h2 className="text-xl font-bold text-ink">メンバー管理</h2>

      <form
        onSubmit={handleCreate}
        className="bg-card rounded-xl border border-line p-5 space-y-3"
      >
        <h3 className="font-semibold text-ink">新しいメンバーを追加</h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="new-username" className="block text-xs font-medium text-ink-muted mb-1.5">
              ユーザーID
            </label>
            <input
              id="new-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              pattern="[a-zA-Z0-9_]+"
              title="英数字とアンダースコアのみ"
              className="w-full px-3 py-2.5 bg-bg border border-line rounded-lg text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
              placeholder="例: tanaka"
            />
          </div>
          <div>
            <label htmlFor="new-display" className="block text-xs font-medium text-ink-muted mb-1.5">
              表示名
            </label>
            <input
              id="new-display"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              className="w-full px-3 py-2.5 bg-bg border border-line rounded-lg text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
              placeholder="例: 田中太郎"
            />
          </div>
          <div>
            <label htmlFor="new-password" className="block text-xs font-medium text-ink-muted mb-1.5">
              パスワード
            </label>
            <input
              id="new-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-3 py-2.5 bg-bg border border-line rounded-lg text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
              placeholder="6文字以上"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer pb-2.5">
              <input
                type="checkbox"
                checked={isAdmin}
                onChange={(e) => setIsAdmin(e.target.checked)}
                className="w-4 h-4 rounded border-line bg-bg text-accent focus:ring-accent/50"
              />
              <span className="text-sm text-ink">管理者権限を付与</span>
            </label>
          </div>
        </div>

        {error && (
          <p className="text-sm text-danger bg-danger-bg/60 border border-danger/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        {success && (
          <p className="text-sm text-success bg-success-bg/60 border border-success/30 rounded-lg px-3 py-2">
            {success}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-accent text-bg text-sm font-semibold rounded-lg hover:bg-accent-strong disabled:opacity-50 transition-colors"
        >
          <PlusIcon />
          {submitting ? '作成中...' : 'アカウントを作成'}
        </button>
      </form>

      <h3 className="text-lg font-bold text-ink pt-1">メンバー一覧</h3>

      <div className="space-y-2">
        {members.map((m) => (
          <MemberRow
            key={m.id}
            member={m}
            isSelf={user?.id === m.id}
            onChanged={fetchMembers}
          />
        ))}
      </div>
      </section>

      <ActivityScheduleEditor />

      <PeriodAdminPanel />

      <PreferenceListPanel />
    </div>
  )
}
