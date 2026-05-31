import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import {
  type ActivityPeriod,
  type DatePreference,
  rankLabel,
  formatDeadline,
} from '../lib/activity'
import {
  AlertIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  FilmIcon,
  TrashIcon,
} from './icons'

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

type PreferenceWithProfile = DatePreference & {
  profiles?: { display_name: string; username: string } | null
}

type ViewMode = 'date' | 'member'

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}/${d.getDate()}（${DAY_LABELS[d.getDay()]}）`
}

function formatTimeShort(t: string | null): string | null {
  if (!t) return null
  return t.slice(0, 5)
}

type PreferenceListPanelProps = {
  year: number
  month: number
  onPrevMonth: () => void
  onNextMonth: () => void
  onThisMonth: () => void
}

export default function PreferenceListPanel({
  year,
  month,
  onPrevMonth,
  onNextMonth,
  onThisMonth,
}: PreferenceListPanelProps) {
  const [period, setPeriod] = useState<ActivityPeriod | null>(null)
  const [preferences, setPreferences] = useState<PreferenceWithProfile[]>([])
  const [view, setView] = useState<ViewMode>('date')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data: idData, error: rpcError } = await supabase.rpc('ensure_period', {
      p_year: year,
      p_month: month,
    })
    if (rpcError || !idData) {
      setError(`期間の取得に失敗しました: ${rpcError?.message ?? '不明なエラー'}`)
      setLoading(false)
      return
    }
    const periodId = idData as string

    const [periodRes, prefRes] = await Promise.all([
      supabase.from('activity_periods').select('*').eq('id', periodId).single(),
      supabase
        .from('date_preferences')
        .select('*, profiles(display_name, username)')
        .eq('period_id', periodId)
        .not('submitted_at', 'is', null)
        .order('date', { ascending: true })
        .order('rank', { ascending: true }),
    ])

    if (periodRes.error) {
      setError(`期間の読み込みに失敗しました: ${periodRes.error.message}`)
      setLoading(false)
      return
    }
    setPeriod(periodRes.data as ActivityPeriod)
    setPreferences((prefRes.data as unknown as PreferenceWithProfile[]) ?? [])
    setLoading(false)
  }, [year, month])

  useEffect(() => {
    void Promise.resolve().then(fetchData)
  }, [fetchData])

  const handleDelete = useCallback(
    async (pref: PreferenceWithProfile) => {
      const memberLabel = pref.profiles?.display_name ?? '(不明)'
      const dateLabel = formatDateLabel(pref.date)
      const movieNote = pref.movie_title ? `\n入力済みの映画情報「${pref.movie_title}」も削除されます。` : ''
      if (
        !confirm(
          `${memberLabel} さんの ${dateLabel}（${rankLabel(pref.rank)}）を削除しますか？${movieNote}`
        )
      ) {
        return
      }
      setDeletingId(pref.id)
      setError(null)
      const { error: rpcError } = await supabase.rpc('admin_delete_preference', {
        p_preference_id: pref.id,
      })
      setDeletingId(null)
      if (rpcError) {
        setError(`削除に失敗しました: ${rpcError.message}`)
        return
      }
      await fetchData()
    },
    [fetchData]
  )

  const periodLocked = !!period?.locked_at

  const byDate = useMemo(() => {
    const m = new Map<string, PreferenceWithProfile[]>()
    for (const p of preferences) {
      const list = m.get(p.date)
      if (list) list.push(p)
      else m.set(p.date, [p])
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [preferences])

  const byMember = useMemo(() => {
    const m = new Map<
      string,
      { name: string; username: string; prefs: PreferenceWithProfile[] }
    >()
    for (const p of preferences) {
      const entry = m.get(p.user_id)
      if (entry) {
        entry.prefs.push(p)
      } else {
        m.set(p.user_id, {
          name: p.profiles?.display_name ?? '(不明)',
          username: p.profiles?.username ?? '',
          prefs: [p],
        })
      }
    }
    for (const entry of m.values()) {
      entry.prefs.sort((a, b) => a.rank - b.rank)
    }
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name, 'ja'))
  }, [preferences])

  const memberCount = byMember.length
  const totalCount = preferences.length
  const filledMovieCount = preferences.filter((p) => !!p.movie_title).length

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-ink">希望提出一覧</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={onPrevMonth}
            aria-label="前月"
            className="p-2 rounded-lg text-ink-muted hover:text-ink hover:bg-card transition-colors"
          >
            <ChevronLeftIcon />
          </button>
          <button
            onClick={onThisMonth}
            aria-label="今月へ戻る"
            className="min-w-[6rem] px-3 py-1.5 text-xs font-medium rounded-lg border border-line text-ink-muted hover:text-ink hover:border-accent/40 transition-colors"
          >
            {month}月
          </button>
          <button
            onClick={onNextMonth}
            aria-label="翌月"
            className="p-2 rounded-lg text-ink-muted hover:text-ink hover:bg-card transition-colors"
          >
            <ChevronRightIcon />
          </button>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-line p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-ink">
            {year}年{month}月
          </p>
          {period && (
            <span className="text-[11px] text-ink-muted">
              締切: {formatDeadline(period.deadline_at)}
              {period.locked_at ? '・集計済み' : ''}
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-bg border border-line py-2">
            <p className="text-[10px] text-ink-muted">提出メンバー</p>
            <p className="text-base font-bold text-ink">{memberCount}人</p>
          </div>
          <div className="rounded-lg bg-bg border border-line py-2">
            <p className="text-[10px] text-ink-muted">希望件数</p>
            <p className="text-base font-bold text-ink">{totalCount}件</p>
          </div>
          <div className="rounded-lg bg-bg border border-line py-2">
            <p className="text-[10px] text-ink-muted">映画入力済</p>
            <p className="text-base font-bold text-ink">
              {filledMovieCount}
              <span className="text-xs text-ink-muted">/{totalCount}</span>
            </p>
          </div>
        </div>

        <div className="inline-flex rounded-lg border border-line bg-bg p-0.5">
          <button
            onClick={() => setView('date')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              view === 'date'
                ? 'bg-accent text-bg'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            日付別
          </button>
          <button
            onClick={() => setView('member')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              view === 'member'
                ? 'bg-accent text-bg'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            メンバー別
          </button>
        </div>

        {error && (
          <p className="text-sm text-danger bg-danger-bg/60 border border-danger/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {loading ? (
          <p className="text-sm text-ink-muted">読み込み中...</p>
        ) : preferences.length === 0 ? (
          <p className="text-sm text-ink-muted text-center py-6">
            この月の希望提出はまだありません
          </p>
        ) : view === 'date' ? (
          <div className="space-y-3">
            {byDate.map(([date, prefs]) => (
              <DateGroup
                key={date}
                date={date}
                prefs={prefs}
                onDelete={periodLocked ? null : handleDelete}
                deletingId={deletingId}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {byMember.map((m) => (
              <MemberGroup
                key={m.username || m.name}
                name={m.name}
                username={m.username}
                prefs={m.prefs}
                onDelete={periodLocked ? null : handleDelete}
                deletingId={deletingId}
              />
            ))}
          </div>
        )}

        {periodLocked && (
          <p className="text-[11px] text-ink-muted text-center">
            集計済み（ロック済み）の期間は削除できません。先にロック解除してください。
          </p>
        )}
      </div>
    </section>
  )
}

type DeleteHandler = ((pref: PreferenceWithProfile) => void | Promise<void>) | null

function DateGroup({
  date,
  prefs,
  onDelete,
  deletingId,
}: {
  date: string
  prefs: PreferenceWithProfile[]
  onDelete: DeleteHandler
  deletingId: string | null
}) {
  return (
    <div className="rounded-lg border border-line bg-bg overflow-hidden">
      <div className="px-3 py-2 bg-card border-b border-line flex items-baseline justify-between">
        <p className="text-sm font-bold text-ink">{formatDateLabel(date)}</p>
        <p className="text-[11px] text-ink-muted">{prefs.length}人が希望</p>
      </div>
      <ul className="divide-y divide-line">
        {prefs.map((p) => (
          <PreferenceRow
            key={p.id}
            pref={p}
            showName
            onDelete={onDelete}
            deleting={deletingId === p.id}
          />
        ))}
      </ul>
    </div>
  )
}

function MemberGroup({
  name,
  username,
  prefs,
  onDelete,
  deletingId,
}: {
  name: string
  username: string
  prefs: PreferenceWithProfile[]
  onDelete: DeleteHandler
  deletingId: string | null
}) {
  return (
    <div className="rounded-lg border border-line bg-bg overflow-hidden">
      <div className="px-3 py-2 bg-card border-b border-line flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink truncate">{name}</p>
          {username && (
            <p className="text-[11px] text-ink-muted truncate">@{username}</p>
          )}
        </div>
        <p className="text-[11px] text-ink-muted shrink-0">{prefs.length}件</p>
      </div>
      <ul className="divide-y divide-line">
        {prefs.map((p) => (
          <PreferenceRow
            key={p.id}
            pref={p}
            showDate
            onDelete={onDelete}
            deleting={deletingId === p.id}
          />
        ))}
      </ul>
    </div>
  )
}

function PreferenceRow({
  pref,
  showName = false,
  showDate = false,
  onDelete,
  deleting,
}: {
  pref: PreferenceWithProfile
  showName?: boolean
  showDate?: boolean
  onDelete: DeleteHandler
  deleting: boolean
}) {
  const start = formatTimeShort(pref.movie_start_time)
  const filled = !!pref.movie_title
  return (
    <li className="px-3 py-2 flex items-start gap-2">
      <span className="shrink-0 inline-flex items-center justify-center min-w-[2.75rem] px-1.5 h-6 rounded bg-accent/15 text-accent text-[11px] font-bold">
        {rankLabel(pref.rank)}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {showName && (
            <p className="text-sm font-semibold text-ink truncate">
              {pref.profiles?.display_name ?? '(不明)'}
            </p>
          )}
          {showDate && (
            <p className="text-sm font-semibold text-ink">{formatDateLabel(pref.date)}</p>
          )}
          {filled ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-success">
              <CheckIcon size={11} />
              映画入力済
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] text-danger">
              <AlertIcon size={11} />
              映画未入力
            </span>
          )}
        </div>
        {filled && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-ink-muted">
            <span className="inline-flex items-center gap-0.5 text-ink">
              <FilmIcon size={11} className="text-accent" />
              <span className="truncate">{pref.movie_title}</span>
            </span>
            {start && (
              <span className="inline-flex items-center gap-0.5">
                <ClockIcon size={11} />
                {start}
              </span>
            )}
            {pref.movie_duration_minutes != null && (
              <span>{pref.movie_duration_minutes}分</span>
            )}
            {pref.movie_genre && <span>· {pref.movie_genre}</span>}
          </div>
        )}
      </div>
      {onDelete && (
        <button
          onClick={() => onDelete(pref)}
          disabled={deleting}
          aria-label="この希望を削除"
          title="この希望を削除"
          className="shrink-0 p-1.5 rounded-md text-ink-muted hover:text-danger hover:bg-danger/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <TrashIcon size={14} />
        </button>
      )}
    </li>
  )
}
