import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import MovieDatesEditor, { BulkTimeControl, BulkDatesControl, type CandidateDate } from '../components/MovieDatesEditor'
import MovieWishCard, { type MovieWishPayload } from '../components/MovieWishCard'
import WatchlistPickerModal from '../components/WatchlistPickerModal'
import { fetchWatchlist, type WatchlistItem } from '../lib/watchlist'
import { AlertIcon, BookmarkIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, FilmIcon, TrashIcon } from '../components/icons'
import {
  type ActivityRule,
  type ActivityDay,
  type ActivityPeriod,
  type MovieWish,
  type PeriodMovieDate,
  formatDeadline,
  timeStringToMinutes,
  minutesToTimeString,
  isPeriodOpen,
  getStoredViewMonth,
  storeViewMonth,
} from '../lib/activity'

const DEFAULT_START_TIME = '18:10'

const EMPTY_MOVIE_PAYLOAD: MovieWishPayload = {
  title: '',
  startTime: '',
  durationMinutes: null,
  genre: '',
  watchUrl: '',
  description: '',
  hasGore: false,
  sourceWatchlistId: null,
}

// 申請の最小単位：1本の映画＋その候補日（優先順・各日の開始時刻）
type MovieDraft = {
  payload: MovieWishPayload
  dates: CandidateDate[]
}

function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const FULL_DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']
function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}/${d.getDate()}（${FULL_DAY_LABELS[d.getDay()]}）`
}

function getMonthWeeks(year: number, month: number): (Date | null)[][] {
  const firstOfMonth = new Date(year, month, 1)
  const lastOfMonth = new Date(year, month + 1, 0)
  const firstDayOfWeek = firstOfMonth.getDay()
  const daysToSubtract = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1
  const startMonday = new Date(year, month, 1 - daysToSubtract)
  const weeks: (Date | null)[][] = []
  const cursor = new Date(startMonday)
  while (cursor <= lastOfMonth) {
    const week: (Date | null)[] = []
    for (let i = 0; i < 5; i++) {
      const d = new Date(cursor)
      d.setDate(d.getDate() + i)
      week.push(d.getMonth() === month ? d : null)
    }
    weeks.push(week)
    cursor.setDate(cursor.getDate() + 7)
  }
  return weeks
}

function getMonthFromSearchParams(searchParams: URLSearchParams): { year: number; month: number } {
  const today = new Date()
  const year = Number(searchParams.get('year'))
  const month = Number(searchParams.get('month'))
  if (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    year >= 2000 &&
    year <= 2100 &&
    month >= 1 &&
    month <= 12
  ) {
    return { year, month: month - 1 }
  }
  return getStoredViewMonth(today)
}

// MovieWish（DB行）→ フォーム用 payload
function wishToPayload(w: MovieWish): MovieWishPayload {
  return {
    title: w.movie_title ?? '',
    startTime: '',
    durationMinutes: w.movie_duration_minutes,
    genre: w.movie_genre ?? '',
    watchUrl: w.movie_watch_url ?? '',
    description: w.movie_description ?? '',
    hasGore: w.movie_has_gore ?? false,
    sourceWatchlistId: w.source_watchlist_id ?? null,
  }
}

// 観たいリストの1件 → フォーム用 payload
function watchlistToPayload(w: WatchlistItem): MovieWishPayload {
  return {
    title: w.title,
    startTime: '',
    durationMinutes: w.duration_minutes,
    genre: w.genre ?? '',
    watchUrl: w.watch_url ?? '',
    description: w.description ?? '',
    hasGore: w.has_gore,
    sourceWatchlistId: w.id,
  }
}

// movies → set_my_application の JSON ペイロード
function moviesToRpc(movies: MovieDraft[]) {
  return movies.map((m) => ({
    title: m.payload.title,
    duration_minutes: m.payload.durationMinutes,
    genre: m.payload.genre,
    watch_url: m.payload.watchUrl,
    description: m.payload.description,
    has_gore: m.payload.hasGore,
    source_watchlist_id: m.payload.sourceWatchlistId,
    dates: m.dates.map((d) => ({ date: d.date, start_time: d.startTime || '' })),
  }))
}

export default function ApplicationPage() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const today = new Date()
  const initialMonth = getMonthFromSearchParams(searchParams)
  const [viewYear, setViewYear] = useState(initialMonth.year)
  const [viewMonth, setViewMonth] = useState(initialMonth.month)
  const [period, setPeriod] = useState<ActivityPeriod | null>(null)
  const [activityRules, setActivityRules] = useState<ActivityRule[]>([])
  const [activityDays, setActivityDays] = useState<ActivityDay[]>([])
  const [movies, setMovies] = useState<MovieDraft[]>([])
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)

  // 映画カードの展開（step1）／映画アコーディオンの展開（step2）
  const [expandedMovie, setExpandedMovie] = useState<string | null>(null)
  const [draftMovie, setDraftMovie] = useState<MovieWishPayload | null>(null)
  const [expandedDateMovie, setExpandedDateMovie] = useState<number | null>(null)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [editingAfterSubmit, setEditingAfterSubmit] = useState(false)

  // 保存直列化（連続操作をまとめて1つの最新状態に収束させる）
  const moviesRef = useRef<MovieDraft[]>([])
  const savingRef = useRef(false)
  const dirtyRef = useRef(false)
  const inflightRef = useRef<Promise<void>>(Promise.resolve())

  const weeks = getMonthWeeks(viewYear, viewMonth)

  const rulesMap = useMemo(() => {
    const m = new Map<number, ActivityRule>()
    for (const r of activityRules) m.set(r.weekday, r)
    return m
  }, [activityRules])

  const daysMap = useMemo(() => {
    const m = new Map<string, ActivityDay>()
    for (const d of activityDays) m.set(d.date, d)
    return m
  }, [activityDays])

  const flashError = useCallback((msg: string) => setPageError(msg), [])

  const fetchData = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const { data: periodIdData, error: ensureError } = await supabase.rpc('ensure_period', {
      p_year: viewYear,
      p_month: viewMonth + 1,
    })
    if (ensureError) console.error('ensure_period failed:', ensureError)
    const periodId = periodIdData as string | null

    const [periodRes, rulesRes, daysRes, wishesRes, datesRes] = await Promise.all([
      periodId
        ? supabase.from('activity_periods').select('*').eq('id', periodId).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('activity_rules').select('*'),
      supabase
        .from('activity_days')
        .select('*')
        .gte('date', formatDate(new Date(viewYear, viewMonth, 1)))
        .lte('date', formatDate(new Date(viewYear, viewMonth + 1, 0))),
      periodId
        ? supabase
            .from('period_movie_wishes')
            .select('*')
            .eq('period_id', periodId)
            .eq('user_id', user.id)
            .order('rank', { ascending: true })
        : Promise.resolve({ data: [] }),
      periodId
        ? supabase
            .from('period_movie_dates')
            .select('*')
            .eq('period_id', periodId)
            .eq('user_id', user.id)
            .order('priority', { ascending: true })
        : Promise.resolve({ data: [] }),
    ])

    setPeriod((periodRes.data as ActivityPeriod | null) ?? null)
    setActivityRules((rulesRes.data as ActivityRule[]) ?? [])
    setActivityDays((daysRes.data as ActivityDay[]) ?? [])

    const wishes = (wishesRes.data as MovieWish[]) ?? []
    const dates = (datesRes.data as PeriodMovieDate[]) ?? []
    const built: MovieDraft[] = wishes.map((w) => ({
      payload: wishToPayload(w),
      dates: dates
        .filter((d) => d.movie_wish_id === w.id)
        .sort((a, b) => a.priority - b.priority)
        .map((d) => ({ date: d.date, startTime: d.start_time?.slice(0, 5) ?? '' })),
    }))
    moviesRef.current = built
    setMovies(built)

    const isSubmitted =
      wishes.length > 0 &&
      wishes.every((w) => !!w.submitted_at) &&
      dates.length > 0 &&
      dates.every((d) => !!d.submitted_at)
    setSubmitted(isSubmitted)
    setEditingAfterSubmit(false)

    setLoading(false)
  }, [viewYear, viewMonth, user])

  useEffect(() => {
    void Promise.resolve().then(() => fetchData())
  }, [fetchData])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    void fetchWatchlist(user.id)
      .then((list) => {
        if (!cancelled) setWatchlist(list)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user])

  useEffect(() => {
    storeViewMonth(viewYear, viewMonth)
  }, [viewYear, viewMonth])

  // ===== 保存（一括・直列化） =====
  const commitSave = useCallback((): Promise<void> => {
    if (!period) return Promise.resolve()
    if (savingRef.current) {
      dirtyRef.current = true
      return inflightRef.current
    }
    savingRef.current = true
    const run = (async () => {
      let failed: string | null = null
      try {
        do {
          dirtyRef.current = false
          const payload = moviesToRpc(moviesRef.current)
          const { error } = await supabase.rpc('set_my_application', {
            p_period_id: period.id,
            p_movies: payload,
          })
          if (error) {
            failed = `保存に失敗しました: ${error.message}`
            break
          }
        } while (dirtyRef.current)
      } finally {
        savingRef.current = false
        dirtyRef.current = false
      }
      if (failed) flashError(failed)
    })()
    inflightRef.current = run
    return run
  }, [period, flashError])

  // movies を更新し（=未提出に戻し）バックグラウンド保存をトリガ
  const applyMovies = useCallback(
    (next: MovieDraft[]) => {
      moviesRef.current = next
      setMovies(next)
      setSubmitted(false)
      void commitSave()
    },
    [commitSave]
  )

  const updateMovieAt = useCallback(
    (index: number, updater: (m: MovieDraft) => MovieDraft) => {
      const next = moviesRef.current.map((m, i) => (i === index ? updater(m) : m))
      applyMovies(next)
    },
    [applyMovies]
  )

  // ===== 映画（step1） =====
  const saveMovieAt = useCallback(
    async (index: number, payload: MovieWishPayload): Promise<string | null> => {
      updateMovieAt(index, (m) => ({ ...m, payload }))
      return null
    },
    [updateMovieAt]
  )

  const saveDraftMovie = useCallback(
    async (payload: MovieWishPayload): Promise<string | null> => {
      applyMovies([...moviesRef.current, { payload, dates: [] }])
      setDraftMovie(null)
      setExpandedMovie(null)
      return null
    },
    [applyMovies]
  )

  const removeMovieAt = useCallback(
    async (index: number): Promise<string | null> => {
      applyMovies(moviesRef.current.filter((_, i) => i !== index))
      return null
    },
    [applyMovies]
  )

  const moveMovie = useCallback(
    async (index: number, direction: -1 | 1): Promise<string | null> => {
      const arr = [...moviesRef.current]
      const j = index + direction
      if (j < 0 || j >= arr.length) return null
      ;[arr[index], arr[j]] = [arr[j], arr[index]]
      applyMovies(arr)
      return null
    },
    [applyMovies]
  )

  const addMovie = useCallback(() => {
    setDraftMovie({ ...EMPTY_MOVIE_PAYLOAD })
    setExpandedMovie('draft')
  }, [])

  const toggleMovieExpand = useCallback((key: string) => {
    setExpandedMovie((prev) => (prev === key ? null : key))
  }, [])

  const resetMovies = useCallback(() => {
    if (movies.length === 0 && !draftMovie) return
    if (!confirm('登録した映画と候補日をすべてリセットしますか？')) return
    setDraftMovie(null)
    setExpandedMovie(null)
    applyMovies([])
  }, [movies.length, draftMovie, applyMovies])

  const addMoviesFromWatchlist = useCallback(
    async (picked: WatchlistItem[]) => {
      if (picked.length === 0) return
      applyMovies([...moviesRef.current, ...picked.map((w) => ({ payload: watchlistToPayload(w), dates: [] }))])
    },
    [applyMovies]
  )

  // ===== 候補日（step2） =====
  const toggleDate = useCallback(
    (movieIndex: number, date: string) => {
      const movie = moviesRef.current[movieIndex]
      if (!movie) return
      const exists = movie.dates.some((d) => d.date === date)
      // 同じ日を複数の映画の候補にできる（優先順は映画の登録順）
      navigator.vibrate?.(exists ? 8 : 14)
      updateMovieAt(movieIndex, (m) => ({
        ...m,
        dates: exists
          ? m.dates.filter((d) => d.date !== date)
          : [...m.dates, { date, startTime: DEFAULT_START_TIME }],
      }))
    },
    [updateMovieAt]
  )

  const setDateStartTime = useCallback(
    (movieIndex: number, date: string, startTime: string) => {
      updateMovieAt(movieIndex, (m) => ({
        ...m,
        dates: m.dates.map((d) => (d.date === date ? { ...d, startTime } : d)),
      }))
    },
    [updateMovieAt]
  )

  // 1本の映画の全候補日に同じ開始時刻を一括設定
  const setMovieStartTimes = useCallback(
    (movieIndex: number, startTime: string) => {
      updateMovieAt(movieIndex, (m) => ({
        ...m,
        dates: m.dates.map((d) => ({ ...d, startTime })),
      }))
    },
    [updateMovieAt]
  )

  // すべての映画の全候補日に同じ開始時刻を一括設定
  const setAllStartTimes = useCallback(
    (startTime: string) => {
      applyMovies(
        moviesRef.current.map((m) => ({ ...m, dates: m.dates.map((d) => ({ ...d, startTime })) }))
      )
    },
    [applyMovies]
  )

  // すべての映画の候補日を、選んだ日付一式で上書き（開始時刻は既存値を保持）
  const applyDatesToAll = useCallback(
    (dates: string[]) => {
      applyMovies(
        moviesRef.current.map((m) => {
          const prevTime = new Map(m.dates.map((d) => [d.date, d.startTime]))
          return {
            ...m,
            dates: dates.map((date) => ({ date, startTime: prevTime.get(date) || DEFAULT_START_TIME })),
          }
        })
      )
    },
    [applyMovies]
  )

  const moveDate = useCallback(
    (movieIndex: number, date: string, dir: -1 | 1) => {
      updateMovieAt(movieIndex, (m) => {
        const arr = [...m.dates]
        const idx = arr.findIndex((d) => d.date === date)
        const j = idx + dir
        if (idx < 0 || j < 0 || j >= arr.length) return m
        ;[arr[idx], arr[j]] = [arr[j], arr[idx]]
        return { ...m, dates: arr }
      })
    },
    [updateMovieAt]
  )

  const removeDate = useCallback(
    (movieIndex: number, date: string) => {
      updateMovieAt(movieIndex, (m) => ({ ...m, dates: m.dates.filter((d) => d.date !== date) }))
    },
    [updateMovieAt]
  )

  // ===== 提出 =====
  const movieCount = movies.length
  const totalDates = movies.reduce((sum, m) => sum + m.dates.length, 0)
  const everyMovieHasDate = movieCount > 0 && movies.every((m) => m.dates.length > 0)
  const everyDateHasTime = movies.every((m) => m.dates.every((d) => !!d.startTime))
  const datesComplete = everyMovieHasDate && everyDateHasTime

  const canGoToStep2 = movieCount > 0
  const canGoToStep3 = canGoToStep2 && datesComplete

  const submitApplication = useCallback(async (): Promise<void> => {
    if (!period) return
    if (movieCount === 0) {
      flashError('映画を1本以上登録してください')
      return
    }
    if (!everyMovieHasDate) {
      flashError('各映画に候補日を1つ以上選んでください')
      return
    }
    if (!everyDateHasTime) {
      flashError('すべての候補日に開始時刻を入力してください')
      return
    }
    setSubmitting(true)
    // 最新状態を確実に保存してから提出
    await commitSave()
    const { error } = await supabase.rpc('submit_my_application', { p_period_id: period.id })
    setSubmitting(false)
    if (error) {
      flashError(`提出に失敗しました: ${error.message}`)
      return
    }
    setPageError(null)
    await fetchData()
  }, [period, movieCount, everyMovieHasDate, everyDateHasTime, commitSave, fetchData, flashError])

  // ===== 月ナビ =====
  const setVisibleMonth = (year: number, month: number) => {
    setViewYear(year)
    setViewMonth(month)
    setSearchParams({ year: String(year), month: String(month + 1) })
    storeViewMonth(year, month)
    setDraftMovie(null)
    setExpandedMovie(null)
    setExpandedDateMovie(null)
    setEditingAfterSubmit(false)
    setStep(1)
  }
  const prevMonth = () => {
    const d = new Date(viewYear, viewMonth - 1, 1)
    setVisibleMonth(d.getFullYear(), d.getMonth())
  }
  const nextMonth = () => {
    const d = new Date(viewYear, viewMonth + 1, 1)
    setVisibleMonth(d.getFullYear(), d.getMonth())
  }
  const thisMonth = () => {
    const now = new Date()
    setVisibleMonth(now.getFullYear(), now.getMonth())
  }

  const periodLocked = !!period?.locked_at
  const periodOpen = isPeriodOpen(period)
  const canEdit = !!period && periodOpen

  const goToStep = (n: 1 | 2 | 3) => {
    if (n === 1) setStep(1)
    else if (n === 2 && canGoToStep2) setStep(2)
    else if (n === 3 && canGoToStep3) setStep(3)
  }

  const STEPS = [
    { n: 1 as const, label: '映画' },
    { n: 2 as const, label: '候補日・時刻' },
    { n: 3 as const, label: '確認' },
  ]

  // 確認・読み取り専用の概要（映画ごとに候補日をまとめる）
  const summaryList = (
    <ul className="space-y-2">
      {movies.map((m, i) => (
        <li key={i} className="rounded-xl border border-line bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-line bg-bg/40">
            <span className="inline-flex items-center justify-center w-7 h-6 rounded bg-accent/15 text-accent text-[11px] font-bold tabular-nums">
              {i + 1}
            </span>
            <span className="inline-flex items-center gap-1 text-sm font-semibold text-ink min-w-0">
              <FilmIcon size={12} className="text-accent shrink-0" />
              <span className="truncate">{m.payload.title}</span>
            </span>
            {m.payload.durationMinutes != null && (
              <span className="ml-auto text-[11px] text-ink-muted tabular-nums">
                {m.payload.durationMinutes}分
              </span>
            )}
          </div>
          <div className="px-3 py-2">
            {m.dates.length === 0 ? (
              <p className="text-[11px] text-ink-muted inline-flex items-center gap-1">
                <AlertIcon size={12} className="text-ink-dim shrink-0" />
                候補日なし — この映画は抽選対象になりません
              </p>
            ) : (
              <ul className="space-y-1">
                {m.dates.map((d, di) => {
                  const startMin = timeStringToMinutes(d.startTime)
                  const end =
                    m.payload.durationMinutes != null && startMin != null
                      ? minutesToTimeString(startMin + m.payload.durationMinutes)
                      : null
                  return (
                    <li key={d.date} className="flex items-center gap-2 text-[12px]">
                      <span className="inline-flex items-center justify-center min-w-[2.5rem] px-1 h-5 rounded bg-bg text-accent text-[10px] font-bold border border-line">
                        第{di + 1}
                      </span>
                      <span className="text-ink font-medium">{formatDateLabel(d.date)}</span>
                      <span className="ml-auto text-ink-muted tabular-nums">
                        {d.startTime || '—'}
                        {end && `〜${end}`}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </li>
      ))}
    </ul>
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-accent uppercase tracking-wider">活動申請</p>
          <h2 className="text-xl font-bold text-ink font-display tabular-nums">
            {viewYear}年{viewMonth + 1}月
          </h2>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={prevMonth} aria-label="前月" className="p-2 rounded-lg text-ink-muted hover:text-ink hover:bg-card transition-colors">
            <ChevronLeftIcon />
          </button>
          <button onClick={thisMonth} aria-label="今月へ戻る" className="min-w-[6rem] px-3 py-1.5 text-xs font-medium rounded-lg border border-line text-ink-muted hover:text-ink hover:border-accent/40 transition-colors">
            {viewMonth + 1}月
          </button>
          <button onClick={nextMonth} aria-label="翌月" className="p-2 rounded-lg text-ink-muted hover:text-ink hover:bg-card transition-colors">
            <ChevronRightIcon />
          </button>
        </div>
      </div>

      {period && (
        <div
          className={`text-xs rounded-lg px-3 py-2 border ${
            periodLocked
              ? 'bg-card border-line text-ink-muted'
              : periodOpen
                ? 'bg-success-bg/40 border-success/30 text-success'
                : 'bg-danger-bg/40 border-danger/30 text-danger'
          }`}
        >
          {periodLocked ? (
            <>主催者確定済み（締切: {formatDeadline(period.deadline_at)}）</>
          ) : periodOpen ? (
            <>申請受付中 — 締切: {formatDeadline(period.deadline_at)}</>
          ) : (
            <>締切過ぎ — まもなく主催者を確定します</>
          )}
        </div>
      )}

      {pageError && (
        <div aria-live="polite" className="flex items-start gap-2 text-sm bg-danger-bg/60 border border-danger/30 rounded-lg px-3 py-2 text-danger">
          <span className="flex-1">{pageError}</span>
          <button onClick={() => setPageError(null)} aria-label="閉じる" className="shrink-0">×</button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3" aria-hidden="true">
          <div className="h-10 rounded-lg bg-card animate-pulse" />
          <div className="h-24 rounded-xl bg-card animate-pulse" />
        </div>
      ) : !period ? (
        <p className="text-sm text-danger">期間レコードを取得できませんでした</p>
      ) : !canEdit ? (
        /* 受付期間外・確定済み: 読み取り専用 */
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-ink font-display">あなたの申請内容</h3>
            {submitted && (
              <span className="inline-flex items-center gap-1 text-[11px] text-success">
                <CheckIcon size={12} />
                提出済み
              </span>
            )}
          </div>
          {movieCount === 0 ? (
            <p className="text-sm text-ink-muted text-center py-6">この月の申請はありません</p>
          ) : (
            summaryList
          )}
        </section>
      ) : submitted && !editingAfterSubmit ? (
        /* 提出済み: 着地画面 */
        <section className="space-y-3">
          <div className="rounded-xl border border-success/30 bg-success-bg/40 px-4 py-3">
            <p className="text-base font-bold text-success font-display inline-flex items-center gap-1.5">
              <CheckIcon size={18} />
              申請済みです
            </p>
            <p className="text-[11px] text-ink-muted mt-1">
              この内容で申請を受け付けました。内容を変えたい場合は「修正する」を押してください（修正すると未提出に戻ります）。
            </p>
            <button
              onClick={() => {
                setEditingAfterSubmit(true)
                setStep(1)
              }}
              className="mt-3 w-full px-4 py-2.5 bg-accent text-bg text-sm font-semibold rounded-lg hover:bg-accent-strong transition-colors"
            >
              修正する
            </button>
          </div>
          {summaryList}
        </section>
      ) : (
        <>
          {/* ステッパー */}
          <ol className="flex items-center gap-1">
            {STEPS.map((s, i) => {
              const active = step === s.n
              const done = step > s.n
              const reachable = s.n === 1 ? true : s.n === 2 ? canGoToStep2 : canGoToStep3
              return (
                <li key={s.n} className="flex items-center gap-1">
                  <button
                    onClick={() => goToStep(s.n)}
                    disabled={!reachable}
                    aria-current={active ? 'step' : undefined}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      active
                        ? 'bg-accent text-bg'
                        : done
                          ? 'text-accent hover:bg-accent/10'
                          : 'text-ink-muted hover:bg-card disabled:opacity-40 disabled:cursor-not-allowed'
                    }`}
                  >
                    <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] tabular-nums ${active ? 'bg-bg/20' : 'bg-card'}`}>
                      {done ? <CheckIcon size={12} /> : s.n}
                    </span>
                    {s.label}
                  </button>
                  {i < STEPS.length - 1 && <ChevronRightIcon size={14} className="text-ink-dim" />}
                </li>
              )
            })}
          </ol>

          {step === 1 && (
            <>
              <section className="space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-bold text-ink font-display">① 観たい映画を登録</h3>
                  <div className="flex items-center gap-3">
                    {(movieCount > 0 || draftMovie) && (
                      <button onClick={resetMovies} className="shrink-0 inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-danger transition-colors">
                        <TrashIcon size={12} />
                        リセット
                      </button>
                    )}
                    <p className="text-[11px] text-ink-muted tabular-nums">{movieCount}本</p>
                  </div>
                </div>
                <p className="text-[11px] text-ink-muted -mt-1">
                  上映したい映画を登録します。次のページで映画ごとに候補日と開始時刻を選びます。上位の候補日が外れても、映画は変わらず次の候補日に回ります。
                </p>

                <div className="space-y-2">
                  {movies.map((m, idx) => (
                    <MovieWishCard
                      key={idx}
                      rank={idx + 1}
                      payload={m.payload}
                      isDraft={false}
                      isFirst={idx === 0}
                      isLast={idx === movies.length - 1}
                      disabled={false}
                      expanded={expandedMovie === `m${idx}`}
                      onToggleExpand={() => toggleMovieExpand(`m${idx}`)}
                      onMoveUp={() => moveMovie(idx, -1)}
                      onMoveDown={() => moveMovie(idx, 1)}
                      onRemove={() => removeMovieAt(idx)}
                      onSave={(payload) => saveMovieAt(idx, payload)}
                    />
                  ))}

                  {draftMovie && (
                    <MovieWishCard
                      key="draft"
                      rank={movieCount + 1}
                      payload={draftMovie}
                      isDraft
                      isFirst
                      isLast
                      disabled={false}
                      expanded={expandedMovie === 'draft'}
                      onToggleExpand={() => toggleMovieExpand('draft')}
                      onMoveUp={() => {}}
                      onMoveDown={() => {}}
                      onRemove={() => {
                        setDraftMovie(null)
                        setExpandedMovie(null)
                      }}
                      onSave={saveDraftMovie}
                    />
                  )}
                </div>

                {!draftMovie && (
                  <div className="flex gap-2">
                    <button onClick={addMovie} className="flex-1 px-4 py-2.5 border border-dashed border-accent/50 text-accent text-sm font-semibold rounded-lg hover:bg-accent/10 transition-colors inline-flex items-center justify-center gap-1.5">
                      <FilmIcon size={15} />
                      映画を追加
                    </button>
                    {watchlist.length > 0 && (
                      <button onClick={() => setPickerOpen(true)} className="px-4 py-2.5 border border-dashed border-accent/50 text-accent text-sm font-semibold rounded-lg hover:bg-accent/10 transition-colors inline-flex items-center justify-center gap-1.5">
                        <BookmarkIcon size={15} />
                        リストから
                      </button>
                    )}
                  </div>
                )}
              </section>

              <div className="space-y-2">
                {movieCount === 0 && (
                  <p className="text-[11px] text-ink-muted text-center">映画を1本以上登録すると次に進めます</p>
                )}
                <button
                  onClick={() => setStep(2)}
                  disabled={!canGoToStep2}
                  className="w-full px-4 py-2.5 bg-accent text-bg text-sm font-semibold rounded-lg hover:bg-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-1.5"
                >
                  次へ：候補日を選ぶ
                  <ChevronRightIcon size={16} />
                </button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <section className="space-y-2">
                <h3 className="text-sm font-bold text-ink font-display">② 映画ごとに候補日と開始時刻</h3>
                <p className="text-[11px] text-ink-muted -mt-1">
                  映画を開いてカレンダーから候補日を選びます（タップした順が映画内の優先順）。各候補日に開始時刻を入力してください（初期値 {DEFAULT_START_TIME}）。同じ日を複数の映画の候補にしてもOK（その場合は先に登録した映画が優先されます）。
                </p>

                <BulkDatesControl
                  weeks={weeks}
                  rulesMap={rulesMap}
                  daysMap={daysMap}
                  todayStr={formatDate(today)}
                  onApply={applyDatesToAll}
                />

                {totalDates > 0 && (
                  <BulkTimeControl
                    label="すべての映画の全候補日に開始時刻を"
                    onApply={setAllStartTimes}
                  />
                )}

                <MovieDatesEditor
                  movies={movies.map((m) => ({
                    title: m.payload.title,
                    durationMinutes: m.payload.durationMinutes,
                    dates: m.dates,
                  }))}
                  weeks={weeks}
                  rulesMap={rulesMap}
                  daysMap={daysMap}
                  todayStr={formatDate(today)}
                  disabled={false}
                  expandedIndex={expandedDateMovie}
                  onToggleExpand={(i) => setExpandedDateMovie((prev) => (prev === i ? null : i))}
                  onToggleDate={toggleDate}
                  onSetStartTime={setDateStartTime}
                  onSetMovieTime={setMovieStartTimes}
                  onMoveDate={moveDate}
                  onRemoveDate={removeDate}
                />
              </section>

              <div className="space-y-2">
                {!datesComplete && (
                  <p className="text-[11px] text-ink-muted text-center">
                    各映画に候補日を1つ以上選び、すべての開始時刻を入力すると確認に進めます
                  </p>
                )}
                <div className="flex gap-2">
                  <button onClick={() => setStep(1)} className="px-4 py-2.5 text-sm font-semibold rounded-lg border border-line text-ink-muted hover:text-ink hover:border-accent/40 transition-colors inline-flex items-center gap-1">
                    <ChevronLeftIcon size={16} />
                    映画
                  </button>
                  <button
                    onClick={() => setStep(3)}
                    disabled={!canGoToStep3}
                    className="flex-1 px-4 py-2.5 bg-accent text-bg text-sm font-semibold rounded-lg hover:bg-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-1.5"
                  >
                    確認へ進む
                    <ChevronRightIcon size={16} />
                  </button>
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <section className="space-y-3">
              <h3 className="text-sm font-bold text-ink font-display">③ 内容を確認して提出</h3>
              <p className="text-[11px] text-ink-muted -mt-1">
                各映画は、候補日のうち最も上位で空いている日に当選すれば上映されます。上位の候補日が外れても映画は変わらず次の候補日に回ります。
              </p>

              {summaryList}

              <div className={`rounded-xl border px-4 py-3 space-y-3 ${submitted ? 'bg-success-bg/40 border-success/30' : 'bg-accent/10 border-accent/30'}`}>
                <div className="flex items-start gap-2">
                  {submitted ? <CheckIcon size={16} className="mt-0.5 text-success shrink-0" /> : <AlertIcon size={16} className="mt-0.5 text-accent shrink-0" />}
                  <div className="min-w-0" aria-live="polite">
                    <p className={`text-sm font-bold ${submitted ? 'text-success' : 'text-ink'}`}>
                      {submitted ? '提出済みです' : 'まだ提出していません'}
                    </p>
                    <p className="text-[11px] text-ink-muted mt-0.5 tabular-nums">
                      映画 {movieCount}本 ／ 候補日 {totalDates}件
                      {submitted ? '。内容を変更すると未提出に戻ります。' : '。締切前に提出してください。未提出の申請は集計されません。'}
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button onClick={() => setStep(2)} className="px-4 py-2.5 text-sm font-semibold rounded-lg border border-line text-ink-muted hover:text-ink hover:border-accent/40 transition-colors inline-flex items-center gap-1">
                    <ChevronLeftIcon size={16} />
                    候補日
                  </button>
                  {!submitted && (
                    <button
                      onClick={submitApplication}
                      disabled={!canEdit || submitting || !canGoToStep3}
                      className="flex-1 px-4 py-2.5 bg-accent text-bg text-sm font-semibold rounded-lg hover:bg-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {submitting ? '提出中…' : 'この内容で提出する'}
                    </button>
                  )}
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {pickerOpen && (
        <WatchlistPickerModal
          items={watchlist}
          onClose={() => setPickerOpen(false)}
          onConfirm={(picked) => {
            setPickerOpen(false)
            void addMoviesFromWatchlist(picked)
          }}
        />
      )}
    </div>
  )
}
