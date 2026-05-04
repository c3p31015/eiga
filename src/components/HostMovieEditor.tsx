import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { type ActivityAssignment } from '../lib/activity'
import { CheckIcon, ClockIcon, FilmIcon, LinkIcon } from './icons'

type Props = {
  assignment: ActivityAssignment
  onSaved: () => void
}

export default function HostMovieEditor({ assignment, onSaved }: Props) {
  const [title, setTitle] = useState(assignment.movie_title ?? '')
  const [description, setDescription] = useState(assignment.movie_description ?? '')
  const [duration, setDuration] = useState(
    assignment.movie_duration_minutes !== null ? String(assignment.movie_duration_minutes) : ''
  )
  const [genre, setGenre] = useState(assignment.movie_genre ?? '')
  const [posterUrl, setPosterUrl] = useState(assignment.movie_poster_url ?? '')
  const [watchUrl, setWatchUrl] = useState(assignment.movie_watch_url ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [savedFlash, setSavedFlash] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      setError('タイトルを入力してください')
      return
    }
    setSubmitting(true)
    setError('')

    const durationNum = duration.trim() ? parseInt(duration, 10) : null
    if (duration.trim() && (Number.isNaN(durationNum) || (durationNum ?? 0) < 0)) {
      setError('上映時間は0以上の整数で入力してください')
      setSubmitting(false)
      return
    }

    const { error: rpcError } = await supabase.rpc('update_my_assignment_movie', {
      p_date: assignment.date,
      p_title: title,
      p_description: description,
      p_duration_minutes: durationNum,
      p_genre: genre,
      p_poster_url: posterUrl,
      p_watch_url: watchUrl,
    })

    setSubmitting(false)
    if (rpcError) {
      setError(`保存に失敗しました: ${rpcError.message}`)
      return
    }
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1500)
    onSaved()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 bg-bg/40 border border-line rounded-xl p-4">
      <p className="text-xs font-semibold text-accent flex items-center gap-1.5">
        <FilmIcon size={14} />
        あなたが主催の日です。映画情報を入力してください
      </p>

      <div>
        <label className="block text-xs font-medium text-ink-muted mb-1.5">
          タイトル <span className="text-danger">*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          className="w-full px-3 py-2.5 bg-bg border border-line rounded-lg text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
          placeholder="例: 君の名は。"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-ink-muted mb-1.5">
          ポスター画像URL
        </label>
        <input
          type="url"
          value={posterUrl}
          onChange={(e) => setPosterUrl(e.target.value)}
          className="w-full px-3 py-2.5 bg-bg border border-line rounded-lg text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
          placeholder="https://..."
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-ink-muted mb-1.5">
            <ClockIcon size={12} className="inline mr-1" />
            上映時間（分）
          </label>
          <input
            type="number"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            min="0"
            className="w-full px-3 py-2.5 bg-bg border border-line rounded-lg text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
            placeholder="例: 120"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-muted mb-1.5">
            ジャンル
          </label>
          <input
            type="text"
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            className="w-full px-3 py-2.5 bg-bg border border-line rounded-lg text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
            placeholder="例: アニメ"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-ink-muted mb-1.5">
          <LinkIcon size={12} className="inline mr-1" />
          視聴URL
        </label>
        <input
          type="url"
          value={watchUrl}
          onChange={(e) => setWatchUrl(e.target.value)}
          className="w-full px-3 py-2.5 bg-bg border border-line rounded-lg text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
          placeholder="https://..."
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-ink-muted mb-1.5">
          メモ・あらすじ
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full px-3 py-2.5 bg-bg border border-line rounded-lg text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent resize-none"
          placeholder="あらすじや見どころなど"
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
        className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-accent text-bg text-sm font-semibold rounded-lg hover:bg-accent-strong disabled:opacity-50 transition-colors"
      >
        {savedFlash ? (
          <>
            <CheckIcon size={16} />
            保存しました
          </>
        ) : (
          <>{submitting ? '保存中...' : '映画情報を保存'}</>
        )}
      </button>
    </form>
  )
}
