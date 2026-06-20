import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import {
  type ActivityPeriod,
  type DatePreference,
  type MovieWish,
  rankLabel,
  formatDeadline,
} from '../lib/activity'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  FilmIcon,
  TrashIcon,
} from './icons'

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

type PrefWithProfile = DatePreference & {
  profiles?: { display_name: string; username: string } | null
}
type WishWithProfile = MovieWish & {
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
  const [preferences, setPreferences] = useState<PrefWithProfile[]>([])
  const [movieWishes, setMovieWishes] = useState<WishWithProfile[]>([])
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

    const [periodRes, prefRes, wishRes] = await Promise.all([
      supabase.from('activity_periods').select('*').eq('id', periodId).single(),
      supabase
        .from('date_preferences')
        .select('*, profiles(display_name, username)')
        .eq('period_id', periodId)
        .not('submitted_at', 'is', null)
        .order('date', { ascending: true })
        .order('rank', { ascending: true }),
      supabase
        .from('period_movie_wishes')
        .select('*, profiles(display_name, username)')
        .eq('period_id', periodId)
        .not('submitted_at', 'is', null)
        .order('rank', { ascending: true }),
    ])

    if (periodRes.error) {
      setError(`期間の読み込みに失敗しました: ${periodRes.error.message}`)
      setLoading(false)
      return
    }
    setPeriod(periodRes.data as ActivityPeriod)
    setPreferences((prefRes.data as unknown as PrefWithProfile[]) ?? [])
    setMovieWishes((wishRes.data as unknown as WishWithProfile[]) ?? [])
    setLoading(false)
  }, [year, month])

  useEffect(() => {
    void Promise.resolve().then(fetchData)
  }, [fetchData])

  const handleDelete = useCallback(
    async (pref: PrefWithProfile) => {
      const memberLabel = pref.profiles?.display_name ?? '(不明)'
      const dateLabel = formatDateLabel(pref.date)
      if (
        !confirm(
          `${memberLabel} さんの ${dateLabel}（${rankLabel(pref.rank)}）を希望日から削除しますか？`
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

  // (user_id, rank) → 映画。日付の当選順位に対応する映画を引くのに使う。
  const movieByUserRank = useMemo(() => {
    const m = new Map<string, WishWithProfile>()
    for (const w of movieWishes) m.set(`${w.user_id}:${w.rank}`, w)
    return m
  }, [movieWishes])

  const byDate = useMemo(() => {
    const m = new Map<string, PrefWithProfile[]>()
    for (const p of preferences) {
      const list = m.get(p.date)
      if (list) list.push(p)
      else m.set(p.date, [p])
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [preferences])

  type MemberEntry = {
    name: string
    username: string
    prefs: PrefWithProfile[]
    wishes: WishWithProfile[]
  }

  const byMember = useMemo(() => {
    const m = new Map<string, MemberEntry>()
    const ensure = (
      userId: string,
      profile?: { display_name: string; username: string } | null
    ): MemberEntry => {
      let entry = m.get(userId)
      if (!entry) {
        entry = {
          name: profile?.display_name ?? '(不明)',
          username: profile?.username ?? '',
          prefs: [],
          wishes: [],
        }
        m.set(userId, entry)
      }
      return entry
    }
    for (const p of preferences) ensure(p.user_id, p.profiles).prefs.push(p)
    for (const w of movieWishes) ensure(w.user_id, w.profiles).wishes.push(w)
    for (const entry of m.values()) {
      entry.prefs.sort((a, b) => a.rank - b.rank)
      entry.wishes.sort((a, b) => a.rank - b.rank)
    }
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name, 'ja'))
  }, [preferences, movieWishes])

  const memberCount = byMember.length
  const dateTotal = preferences.length
  const movieTotal = movieWishes.length

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-ink font-display">希望提出一覧</h3>
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
            <p className="text-base font-bold text-ink tabular-nums">{memberCount}人</p>
          </div>
          <div className="rounded-lg bg-bg border border-line py-2">
            <p className="text-[10px] text-ink-muted">希望日</p>
            <p className="text-base font-bold text-ink tabular-nums">{dateTotal}件</p>
          </div>
          <div className="rounded-lg bg-bg border border-line py-2">
            <p className="text-[10px] text-ink-muted">映画</p>
            <p className="text-base font-bold text-ink tabular-nums">{movieTotal}件</p>
          </div>
        </div>

        <div className="inline-flex rounded-lg border border-line bg-bg p-0.5">
          <button
            onClick={() => setView('date')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              view === 'date' ? 'bg-accent text-bg' : 'text-ink-muted hover:text-ink'
            }`}
          >
            日付別
          </button>
          <button
            onClick={() => setView('member')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              view === 'member' ? 'bg-accent text-bg' : 'text-ink-muted hover:text-ink'
            }`}
          >
            メンバー別
          </button>
        </div>

        {error && (
          <p aria-live="polite" className="text-sm text-danger bg-danger-bg/60 border border-danger/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {loading ? (
          <div className="space-y-2"><div className="h-9 rounded-lg bg-card animate-pulse" /><div className="h-9 rounded-lg bg-card animate-pulse" /></div>
        ) : preferences.length === 0 && movieWishes.length === 0 ? (
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
                movieByUserRank={movieByUserRank}
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
                entry={m}
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

type DeleteHandler = ((pref: PrefWithProfile) => void | Promise<void>) | null

function MovieLine({ wish }: { wish: WishWithProfile }) {
  const start = formatTimeShort(wish.movie_start_time)
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-ink-muted">
      <span className="inline-flex items-center gap-0.5 text-ink">
        <FilmIcon size={11} className="text-accent" />
        <span className="truncate">{wish.movie_title}</span>
      </span>
      {start && (
        <span className="inline-flex items-center gap-0.5">
          <ClockIcon size={11} />
          {start}
        </span>
      )}
      {wish.movie_duration_minutes != null && <span className="tabular-nums">{wish.movie_duration_minutes}分</span>}
      {wish.movie_genre && <span>· {wish.movie_genre}</span>}
      {wish.movie_has_gore && <span className="text-danger">· グロ描写あり</span>}
    </div>
  )
}

function DateGroup({
  date,
  prefs,
  movieByUserRank,
  onDelete,
  deletingId,
}: {
  date: string
  prefs: PrefWithProfile[]
  movieByUserRank: Map<string, WishWithProfile>
  onDelete: DeleteHandler
  deletingId: string | null
}) {
  return (
    <div className="rounded-lg border border-line bg-bg overflow-hidden">
      <div className="px-3 py-2 bg-card border-b border-line flex items-baseline justify-between">
        <p className="text-sm font-bold text-ink">{formatDateLabel(date)}</p>
        <p className="text-[11px] text-ink-muted tabular-nums">{prefs.length}人が希望</p>
      </div>
      <ul className="divide-y divide-line">
        {prefs.map((p) => {
          const pairedMovie = movieByUserRank.get(`${p.user_id}:${p.rank}`) ?? null
          return (
            <li key={p.id} className="px-3 py-2 flex items-start gap-2">
              <span className="shrink-0 inline-flex items-center justify-center min-w-[2.75rem] px-1.5 h-6 rounded bg-accent/15 text-accent text-[11px] font-bold">
                {rankLabel(p.rank)}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink truncate">
                  {p.profiles?.display_name ?? '(不明)'}
                </p>
                {pairedMovie ? (
                  <div className="mt-0.5">
                    <p className="text-[10px] text-ink-dim">当選時の上映作品（同順位）</p>
                    <MovieLine wish={pairedMovie} />
                  </div>
                ) : (
                  <p className="mt-0.5 text-[11px] text-ink-dim">同順位の映画は未登録</p>
                )}
              </div>
              {onDelete && (
                <button
                  onClick={() => onDelete(p)}
                  disabled={deletingId === p.id}
                  aria-label="この希望日を削除"
                  title="この希望日を削除"
                  className="shrink-0 p-1.5 rounded-md text-ink-muted hover:text-danger hover:bg-danger/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <TrashIcon size={14} />
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function MemberGroup({
  entry,
  onDelete,
  deletingId,
}: {
  entry: {
    name: string
    username: string
    prefs: PrefWithProfile[]
    wishes: WishWithProfile[]
  }
  onDelete: DeleteHandler
  deletingId: string | null
}) {
  return (
    <div className="rounded-lg border border-line bg-bg overflow-hidden">
      <div className="px-3 py-2 bg-card border-b border-line flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink truncate">{entry.name}</p>
          {entry.username && <p className="text-[11px] text-ink-muted truncate">@{entry.username}</p>}
        </div>
        <p className="text-[11px] text-ink-muted shrink-0 tabular-nums">
          希望日{entry.prefs.length}・映画{entry.wishes.length}
        </p>
      </div>

      <div className="px-3 py-2 space-y-2">
        <div>
          <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-1">
            希望日
          </p>
          {entry.prefs.length === 0 ? (
            <p className="text-[11px] text-ink-dim">なし</p>
          ) : (
            <ul className="space-y-1">
              {entry.prefs.map((p) => (
                <li key={p.id} className="flex items-center gap-2">
                  <span className="shrink-0 inline-flex items-center justify-center min-w-[2.75rem] px-1.5 h-5 rounded bg-accent/15 text-accent text-[10px] font-bold">
                    {rankLabel(p.rank)}
                  </span>
                  <span className="text-sm text-ink">{formatDateLabel(p.date)}</span>
                  {onDelete && (
                    <button
                      onClick={() => onDelete(p)}
                      disabled={deletingId === p.id}
                      aria-label="この希望日を削除"
                      title="この希望日を削除"
                      className="ml-auto shrink-0 p-1 rounded-md text-ink-muted hover:text-danger hover:bg-danger/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      <TrashIcon size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-1">
            観たい映画
          </p>
          {entry.wishes.length === 0 ? (
            <p className="text-[11px] text-ink-dim">なし</p>
          ) : (
            <ul className="space-y-1">
              {entry.wishes.map((w) => (
                <li key={w.id} className="flex items-start gap-2">
                  <span className="shrink-0 inline-flex items-center justify-center min-w-[2.75rem] px-1.5 h-5 rounded bg-accent/15 text-accent text-[10px] font-bold">
                    {rankLabel(w.rank)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <MovieLine wish={w} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
