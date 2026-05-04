import { useState, useEffect } from 'react'
import {
  AlertIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  FilmIcon,
  TrashIcon,
} from './icons'
import { rankLabel, type DatePreference } from '../lib/activity'

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

export type DateWishPayload = {
  title: string
  startTime: string
  durationMinutes: number | null
  genre: string
  watchUrl: string
  description: string
}

type Props = {
  pref: DatePreference
  isFirst: boolean
  isLast: boolean
  expanded: boolean
  disabled: boolean
  onToggleExpand: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onRemove: () => Promise<string | null> | void
  onSaveWish: (payload: DateWishPayload) => Promise<string | null>
}

export default function PreferenceDateCard({
  pref,
  isFirst,
  isLast,
  expanded,
  disabled,
  onToggleExpand,
  onMoveUp,
  onMoveDown,
  onRemove,
  onSaveWish,
}: Props) {
  const [title, setTitle] = useState(pref.movie_title ?? '')
  const [startTime, setStartTime] = useState(pref.movie_start_time?.slice(0, 5) ?? '')
  const [duration, setDuration] = useState(
    pref.movie_duration_minutes != null ? String(pref.movie_duration_minutes) : ''
  )
  const [genre, setGenre] = useState(pref.movie_genre ?? '')
  const [watchUrl, setWatchUrl] = useState(pref.movie_watch_url ?? '')
  const [description, setDescription] = useState(pref.movie_description ?? '')
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  // pref が外部更新されたらフォームも追従（ただしユーザー編集中は上書きしない）
  useEffect(() => {
    setTitle(pref.movie_title ?? '')
    setStartTime(pref.movie_start_time?.slice(0, 5) ?? '')
    setDuration(pref.movie_duration_minutes != null ? String(pref.movie_duration_minutes) : '')
    setGenre(pref.movie_genre ?? '')
    setWatchUrl(pref.movie_watch_url ?? '')
    setDescription(pref.movie_description ?? '')
    setMessage(null)
  }, [
    pref.id,
    pref.movie_title,
    pref.movie_start_time,
    pref.movie_duration_minutes,
    pref.movie_genre,
    pref.movie_watch_url,
    pref.movie_description,
  ])

  const trimmedTitle = title.trim()
  const titleFilled = trimmedTitle.length > 0
  const durationNum = duration ? Number(duration) : NaN
  const durationOk = Number.isFinite(durationNum) && durationNum > 0
  const requiredMissing = titleFilled && (!startTime || !durationOk)

  const currentTitle = pref.movie_title ?? ''
  const currentStart = pref.movie_start_time?.slice(0, 5) ?? ''
  const currentDuration =
    pref.movie_duration_minutes != null ? String(pref.movie_duration_minutes) : ''
  const currentGenre = pref.movie_genre ?? ''
  const currentUrl = pref.movie_watch_url ?? ''
  const currentDescription = pref.movie_description ?? ''

  const dirty =
    trimmedTitle !== currentTitle ||
    startTime !== currentStart ||
    duration !== currentDuration ||
    genre.trim() !== currentGenre ||
    watchUrl.trim() !== currentUrl ||
    description.trim() !== currentDescription

  const dt = new Date(pref.date + 'T00:00:00')
  const dateLabel = `${dt.getMonth() + 1}/${dt.getDate()}（${DAY_LABELS[dt.getDay()]}）`
  const movieFilled = !!pref.movie_title

  const handleSave = async () => {
    if (titleFilled) {
      if (!startTime) {
        setMessage({ kind: 'err', text: '開始時刻を入力してください' })
        return
      }
      if (!durationOk) {
        setMessage({ kind: 'err', text: '上映時間（分）を正の整数で入力してください' })
        return
      }
    }
    setSaving(true)
    const err = await onSaveWish({
      title,
      startTime,
      durationMinutes: titleFilled ? durationNum : null,
      genre,
      watchUrl,
      description,
    })
    setSaving(false)
    if (err) {
      setMessage({ kind: 'err', text: err })
      return
    }
    setMessage({
      kind: 'ok',
      text: titleFilled ? '映画情報を保存しました' : '映画情報をクリアしました',
    })
  }

  const handleRemove = async () => {
    if (!confirm(`${dateLabel} を希望から外しますか？\n入力した映画情報も削除されます。`)) {
      return
    }
    setRemoving(true)
    await onRemove()
    setRemoving(false)
  }

  return (
    <div className="rounded-xl border border-line bg-card overflow-hidden">
      {/* ヘッダー（折りたたみ時の概要） */}
      <div className="flex items-stretch">
        <button
          onClick={onToggleExpand}
          disabled={disabled}
          className="flex-1 flex items-center gap-3 px-3 py-3 text-left disabled:opacity-50"
        >
          <span className="shrink-0 inline-flex items-center justify-center w-12 h-9 rounded-lg bg-accent/15 text-accent text-xs font-bold">
            {rankLabel(pref.rank)}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-ink">{dateLabel}</p>
            <p className="text-[12px] mt-0.5 truncate">
              {movieFilled ? (
                <span className="inline-flex items-center gap-1 text-ink-muted">
                  <CheckIcon size={12} className="text-success" />
                  <span className="truncate">{pref.movie_title}</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-danger">
                  <AlertIcon size={12} />
                  映画未入力
                </span>
              )}
            </p>
          </div>
          <span className="shrink-0 text-ink-muted">
            {expanded ? <ChevronUpIcon size={18} /> : <ChevronDownIcon size={18} />}
          </span>
        </button>
        <div className="flex flex-col border-l border-line">
          <button
            onClick={onMoveUp}
            disabled={disabled || isFirst}
            aria-label="順位を上げる"
            className="flex-1 px-3 min-h-[40px] flex items-center justify-center text-ink-muted hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed border-b border-line"
          >
            <ChevronUpIcon size={18} />
          </button>
          <button
            onClick={onMoveDown}
            disabled={disabled || isLast}
            aria-label="順位を下げる"
            className="flex-1 px-3 min-h-[40px] flex items-center justify-center text-ink-muted hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronDownIcon size={18} />
          </button>
        </div>
      </div>

      {/* 展開時のフォーム */}
      {expanded && (
        <div className="border-t border-line px-4 py-3 space-y-3 bg-bg/30">
          <div className="flex items-center gap-2">
            <FilmIcon size={14} className="text-accent" />
            <p className="text-sm font-bold text-ink">この日に観たい映画</p>
          </div>
          <p className="text-[11px] text-ink-muted -mt-1">
            主催者になった日に上映する候補。<span className="text-accent">*</span> は必須。タイトル空で削除。
          </p>

          <div className="space-y-2.5">
            <div>
              <label className="block text-[11px] font-medium text-ink-muted mb-1">
                タイトル <span className="text-accent">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={disabled}
                placeholder="例: ショーシャンクの空に"
                className="w-full px-3 py-2 bg-bg border border-line rounded-lg text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent disabled:opacity-50"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-ink-muted mb-1">
                  開始時刻 <span className="text-accent">*</span>
                </label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  disabled={disabled}
                  className="w-full px-3 py-2 bg-bg border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-ink-muted mb-1">
                  上映時間（分） <span className="text-accent">*</span>
                </label>
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  disabled={disabled}
                  placeholder="例: 142"
                  className="w-full px-3 py-2 bg-bg border border-line rounded-lg text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent disabled:opacity-50"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-ink-muted mb-1">ジャンル</label>
              <input
                type="text"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                disabled={disabled}
                placeholder="例: ドラマ / SF"
                className="w-full px-3 py-2 bg-bg border border-line rounded-lg text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-ink-muted mb-1">視聴URL</label>
              <input
                type="url"
                value={watchUrl}
                onChange={(e) => setWatchUrl(e.target.value)}
                disabled={disabled}
                placeholder="https://..."
                className="w-full px-3 py-2 bg-bg border border-line rounded-lg text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-ink-muted mb-1">
                メモ・あらすじ
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={disabled}
                rows={3}
                placeholder="あらすじや一言など"
                className="w-full px-3 py-2 bg-bg border border-line rounded-lg text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent disabled:opacity-50 resize-none"
              />
            </div>
          </div>

          {requiredMissing && (
            <p className="text-[11px] text-danger bg-danger-bg/40 border border-danger/30 rounded-lg px-3 py-2">
              タイトルを入れたら開始時刻と上映時間も必須です
            </p>
          )}

          <div className="flex items-center justify-between gap-2">
            <button
              onClick={handleRemove}
              disabled={disabled || removing}
              className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium rounded-lg bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20 disabled:opacity-60 transition-colors"
            >
              <TrashIcon size={13} />
              {removing ? '削除中...' : '希望から外す'}
            </button>
            <button
              onClick={handleSave}
              disabled={disabled || saving || !dirty || requiredMissing}
              className="px-4 py-2 bg-accent text-bg text-sm font-semibold rounded-lg hover:bg-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? '保存中...' : '映画情報を保存'}
            </button>
          </div>

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
