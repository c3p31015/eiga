import { useState, useEffect, type FormEvent } from 'react'
import { supabase, supabaseAdmin } from '../lib/supabase'

type Profile = {
  id: string
  username: string
  display_name: string
  is_admin: boolean
  created_at: string
}

export default function AdminPage() {
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

    // 別のSupabaseインスタンスでサインアップ（現在のセッションに影響しない）
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
      // プロフィールを作成
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
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-800">メンバー管理</h2>

      <form onSubmit={handleCreate} className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h3 className="font-medium text-gray-700">新しいメンバーを追加</h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="new-username" className="block text-sm font-medium text-gray-700 mb-1">
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
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="例: tanaka"
            />
          </div>
          <div>
            <label htmlFor="new-display" className="block text-sm font-medium text-gray-700 mb-1">
              表示名
            </label>
            <input
              id="new-display"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="例: 田中太郎"
            />
          </div>
          <div>
            <label htmlFor="new-password" className="block text-sm font-medium text-gray-700 mb-1">
              パスワード
            </label>
            <input
              id="new-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="6文字以上"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer pb-2">
              <input
                type="checkbox"
                checked={isAdmin}
                onChange={(e) => setIsAdmin(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">管理者権限を付与</span>
            </label>
          </div>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        {success && <p className="text-sm text-green-600 bg-green-50 rounded-lg px-3 py-2">{success}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {submitting ? '作成中...' : 'アカウントを作成'}
        </button>
      </form>

      <h3 className="text-lg font-bold text-gray-800">メンバー一覧</h3>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-5 py-3 font-medium text-gray-600">ユーザーID</th>
              <th className="text-left px-5 py-3 font-medium text-gray-600">表示名</th>
              <th className="text-left px-5 py-3 font-medium text-gray-600">権限</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {members.map((m) => (
              <tr key={m.id}>
                <td className="px-5 py-3 text-gray-700">{m.username}</td>
                <td className="px-5 py-3 text-gray-700">{m.display_name}</td>
                <td className="px-5 py-3">
                  {m.is_admin ? (
                    <span className="inline-block px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">
                      管理者
                    </span>
                  ) : (
                    <span className="text-gray-400">メンバー</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
