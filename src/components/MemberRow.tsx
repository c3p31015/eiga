import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { CloseIcon, TrashIcon } from './icons'

export type Member = {
  id: string
  username: string
  display_name: string
  is_admin: boolean
}

type Props = {
  member: Member
  isSelf: boolean
  onChanged: () => void | Promise<void>
}

type Tab = 'rename' | 'password' | 'delete'

export default function MemberRow({ member, isSelf, onChanged }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [tab, setTab] = useState<Tab>('rename')
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const close = () => {
    setExpanded(false)
    setMessage(null)
  }

  return (
    <div className="bg-card rounded-xl border border-line">
      <div className="px-4 py-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-ink truncate">
            {member.display_name}
            {isSelf && <span className="ml-1.5 text-[11px] text-ink-muted">(あなた)</span>}
          </p>
          <p className="text-xs text-ink-muted truncate">@{member.username}</p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {member.is_admin && (
            <span className="inline-block px-2 py-0.5 text-[11px] font-semibold bg-accent/15 text-accent rounded-full border border-accent/30">
              管理者
            </span>
          )}
          <button
            onClick={() => (expanded ? close() : setExpanded(true))}
            className="px-2.5 py-1 text-xs font-medium rounded-lg border border-line text-ink-muted hover:text-ink hover:border-accent/40 transition-colors"
          >
            {expanded ? '閉じる' : '編集'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-line px-4 py-3 space-y-3 bg-bg/30">
          <div className="inline-flex rounded-lg border border-line bg-bg p-0.5">
            {(
              [
                { key: 'rename', label: '名前/権限' },
                { key: 'password', label: 'パスワード' },
                { key: 'delete', label: '削除' },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  setTab(t.key)
                  setMessage(null)
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  tab === t.key
                    ? t.key === 'delete'
                      ? 'bg-danger text-bg'
                      : 'bg-accent text-bg'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'rename' && (
            <RenameForm member={member} isSelf={isSelf} setMessage={setMessage} onChanged={onChanged} />
          )}
          {tab === 'password' && (
            <PasswordForm member={member} setMessage={setMessage} />
          )}
          {tab === 'delete' && (
            <DeleteSection
              member={member}
              isSelf={isSelf}
              setMessage={setMessage}
              onChanged={async () => {
                await onChanged()
                close()
              }}
            />
          )}

          {message && (
            <div
              className={`flex items-start gap-2 text-xs px-3 py-2 rounded-lg border ${
                message.kind === 'ok'
                  ? 'bg-success-bg/60 border-success/30 text-success'
                  : 'bg-danger-bg/60 border-danger/30 text-danger'
              }`}
            >
              <span className="flex-1">{message.text}</span>
              <button
                onClick={() => setMessage(null)}
                aria-label="閉じる"
                className="shrink-0 text-current opacity-70 hover:opacity-100"
              >
                <CloseIcon size={14} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RenameForm({
  member,
  isSelf,
  setMessage,
  onChanged,
}: {
  member: Member
  isSelf: boolean
  setMessage: (m: { kind: 'ok' | 'err'; text: string } | null) => void
  onChanged: () => void | Promise<void>
}) {
  const [displayName, setDisplayName] = useState(member.display_name)
  const [isAdmin, setIsAdmin] = useState(member.is_admin)
  const [submitting, setSubmitting] = useState(false)

  const dirty = displayName.trim() !== member.display_name || isAdmin !== member.is_admin

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!displayName.trim()) {
      setMessage({ kind: 'err', text: '表示名を入力してください' })
      return
    }
    setSubmitting(true)
    setMessage(null)
    const { error } = await supabase.rpc('admin_update_member', {
      p_user_id: member.id,
      p_display_name: displayName.trim(),
      p_is_admin: isAdmin,
    })
    setSubmitting(false)
    if (error) {
      setMessage({ kind: 'err', text: `更新に失敗しました: ${error.message}` })
      return
    }
    setMessage({ kind: 'ok', text: '更新しました' })
    await onChanged()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2.5">
      <div>
        <label className="block text-[11px] font-medium text-ink-muted mb-1">表示名</label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          className="w-full px-3 py-2 bg-bg border border-line rounded-lg text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
        />
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={isAdmin}
          onChange={(e) => setIsAdmin(e.target.checked)}
          className="w-4 h-4 rounded border-line bg-bg text-accent focus:ring-accent/50"
        />
        <span className="text-sm text-ink">管理者権限</span>
        {isSelf && !isAdmin && (
          <span className="text-[11px] text-ink-muted">
            ※ 最後の管理者の場合は外せません
          </span>
        )}
      </label>
      <button
        type="submit"
        disabled={submitting || !dirty}
        className="px-4 py-2 bg-accent text-bg text-sm font-semibold rounded-lg hover:bg-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {submitting ? '保存中...' : '保存'}
      </button>
    </form>
  )
}

function PasswordForm({
  member,
  setMessage,
}: {
  member: Member
  setMessage: (m: { kind: 'ok' | 'err'; text: string } | null) => void
}) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)

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
    const { error } = await supabase.rpc('admin_reset_password', {
      p_user_id: member.id,
      p_new_password: password,
    })
    setSubmitting(false)
    if (error) {
      setMessage({ kind: 'err', text: `変更に失敗しました: ${error.message}` })
      return
    }
    setPassword('')
    setConfirm('')
    setMessage({
      kind: 'ok',
      text: 'パスワードを変更しました。本人に新しいパスワードを伝えてください。',
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2.5">
      <p className="text-[11px] text-ink-muted">
        既存セッションは即座には切れません。本人がログアウト→再ログインで反映されます。
      </p>
      <div>
        <label className="block text-[11px] font-medium text-ink-muted mb-1">新しいパスワード</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          autoComplete="new-password"
          className="w-full px-3 py-2 bg-bg border border-line rounded-lg text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
          placeholder="6文字以上"
        />
      </div>
      <div>
        <label className="block text-[11px] font-medium text-ink-muted mb-1">確認用</label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          autoComplete="new-password"
          className="w-full px-3 py-2 bg-bg border border-line rounded-lg text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="px-4 py-2 bg-accent text-bg text-sm font-semibold rounded-lg hover:bg-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {submitting ? '変更中...' : 'パスワードを変更'}
      </button>
    </form>
  )
}

function DeleteSection({
  member,
  isSelf,
  setMessage,
  onChanged,
}: {
  member: Member
  isSelf: boolean
  setMessage: (m: { kind: 'ok' | 'err'; text: string } | null) => void
  onChanged: () => void | Promise<void>
}) {
  const [submitting, setSubmitting] = useState(false)

  if (isSelf) {
    return (
      <p className="text-xs text-ink-muted bg-bg border border-line rounded-lg px-3 py-2">
        自分自身のアカウントは削除できません。
      </p>
    )
  }

  const handleDelete = async () => {
    if (
      !confirm(
        `${member.display_name}（@${member.username}）を完全に削除します。\n\n` +
          'このアカウントの希望提出・参加表明・主催履歴もすべて消えます。\n' +
          '本当に削除しますか？'
      )
    ) {
      return
    }
    setSubmitting(true)
    setMessage(null)
    const { error } = await supabase.rpc('admin_delete_member', {
      p_user_id: member.id,
    })
    setSubmitting(false)
    if (error) {
      setMessage({ kind: 'err', text: `削除に失敗しました: ${error.message}` })
      return
    }
    await onChanged()
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-danger bg-danger-bg/40 border border-danger/30 rounded-lg px-3 py-2">
        削除すると、このメンバーのアカウントと、そのメンバーの希望提出・参加表明・主催履歴がすべて失われます。
      </p>
      <button
        onClick={handleDelete}
        disabled={submitting}
        className="inline-flex items-center gap-1.5 px-4 py-2 bg-danger text-bg text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <TrashIcon size={13} />
        {submitting ? '削除中...' : 'このアカウントを完全に削除'}
      </button>
    </div>
  )
}
