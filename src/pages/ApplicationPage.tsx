import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import RankTimeEditor from '../components/RankTimeEditor'
import MovieWishCard, { type MovieWishPayload } from '../components/MovieWishCard'
import { AlertIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, FilmIcon, TrashIcon } from '../components/icons'
import {
  type ActivityRule,
  type ActivityDay,
  type ActivityPeriod,
  type DatePreference,
  type MovieWish,
  resolveActivity,
  formatTimeRange,
  formatDeadline,
  isPeriodOpen,
  getStoredViewMonth,
  storeViewMonth,
} from '../lib/activity'

const DAY_LABELS = ['月', '火', '水', '木', '金']

const EMPTY_MOVIE_PAYLOAD: MovieWishPayload = {
  title: '',
  startTime: '',
  durationMinutes: null,
  genre: '',
  watchUrl: '',
  description: '',
  hasGore: false,
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
    startTime: w.movie_start_time?.slice(0, 5) ?? '',
    durationMinutes: w.movie_duration_minutes,
    genre: w.movie_genre ?? '',
    watchUrl: w.movie_watch_url ?? '',
    description: w.movie_description ?? '',
    hasGore: w.movie_has_gore ?? false,
  }
}

// payload → RPC（set_my_movie_wishes）の JSON 要素
function payloadToJson(p: MovieWishPayload) {
  return {
    title: p.title,
    start_time: p.startTime,
    duration_minutes: p.durationMinutes,
    genre: p.genre,
    watch_url: p.watchUrl,
    description: p.description,
    has_gore: p.hasGore,
  }
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
  const [preferences, setPreferences] = useState<DatePreference[]>([])
  const [movieWishes, setMovieWishes] = useState<MovieWish[]>([])
  const [loading, setLoading] = useState(true)
  const [submittingPreferences, setSubmittingPreferences] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const [draftMovie, setDraftMovie] = useState<MovieWishPayload | null>(null)
  // 展開中の映画カード: 永続行は id、下書きは 'draft'
  const [expandedMovie, setExpandedMovie] = useState<string | null>(null)
  // 申請ウィザードのステップ: 1=映画, 2=希望日, 3=順位・時刻, 4=確認・提出
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  // 提出済みでも「修正」を押してウィザードを再表示しているか。
  // このモード中の変更はDBに書き込まず、最終「提出」で初めて反映する。
  // 提出せずにページを離れる/月を変えると変更は破棄され、DBは最後の提出状態のまま。
  const [editingAfterSubmit, setEditingAfterSubmit] = useState(false)
  const editingAfterSubmitRef = useRef(false)
  // 直近にタップした希望日（カレンダーのバッジと順位カードを一瞬光らせる連動用）
  const [flashDate, setFlashDate] = useState<string | null>(null)
  const flashTimer = useRef<number | null>(null)

  const triggerFlash = useCallback((date: string) => {
    setFlashDate(date)
    if (flashTimer.current) window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlashDate(null), 700)
  }, [])

  useEffect(() => () => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current)
  }, [])

  useEffect(() => {
    editingAfterSubmitRef.current = editingAfterSubmit
  }, [editingAfterSubmit])

  // 自分の希望日の「最新の意図」を同期的に保持する真実源。
  // 連続タップ時にレンダー前の古い state を読まないようにするため、
  // ハンドラはこの ref から次の並びを作る（サーバー由来でのみ ref を更新）。
  const myDatesRef = useRef<string[]>([])
  const savingRef = useRef(false)
  const dirtyRef = useRef(false)

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

  const myPreferences = useMemo(() => {
    if (!user) return []
    return preferences
      .filter((p) => p.user_id === user.id)
      .sort((a, b) => a.rank - b.rank)
  }, [preferences, user])

  const myMovieWishes = useMemo(() => {
    if (!user) return []
    return movieWishes
      .filter((w) => w.user_id === user.id)
      .sort((a, b) => a.rank - b.rank)
  }, [movieWishes, user])

  const myRankByDate = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of myPreferences) m.set(p.date, p.rank)
    return m
  }, [myPreferences])

  const fetchData = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!user) return
    if (!options.silent) setLoading(true)
    const { data: periodIdData, error: ensureError } = await supabase.rpc('ensure_period', {
      p_year: viewYear,
      p_month: viewMonth + 1,
    })
    if (ensureError) {
      console.error('ensure_period failed:', ensureError)
    }
    const periodId = periodIdData as string | null

    const [periodRes, rulesRes, daysRes, preferencesRes, moviesRes] = await Promise.all([
      periodId
        ? supabase.from('activity_periods').select('*').eq('id', periodId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase.from('activity_rules').select('*'),
      supabase
        .from('activity_days')
        .select('*')
        .gte('date', formatDate(new Date(viewYear, viewMonth, 1)))
        .lte('date', formatDate(new Date(viewYear, viewMonth + 1, 0))),
      periodId
        ? supabase
            .from('date_preferences')
            .select('*')
            .eq('period_id', periodId)
            .eq('user_id', user.id)
        : Promise.resolve({ data: [], error: null }),
      periodId
        ? supabase
            .from('period_movie_wishes')
            .select('*')
            .eq('period_id', periodId)
            .eq('user_id', user.id)
        : Promise.resolve({ data: [], error: null }),
    ])

    const prefRows = (preferencesRes.data as DatePreference[]) ?? []
    setPeriod((periodRes.data as ActivityPeriod | null) ?? null)
    setActivityRules((rulesRes.data as ActivityRule[]) ?? [])
    setActivityDays((daysRes.data as ActivityDay[]) ?? [])
    setPreferences(prefRows)
    setMovieWishes((moviesRes.data as MovieWish[]) ?? [])
    // 全データ再取得はサーバー由来の確定状態。意図 ref を同期する。
    if (!savingRef.current && !dirtyRef.current) {
      myDatesRef.current = prefRows
        .filter((p) => p.user_id === user.id)
        .sort((a, b) => a.rank - b.rank)
        .map((p) => p.date)
    }

    if (!options.silent) setLoading(false)
  }, [viewYear, viewMonth, user])

  // 自分の希望日・映画だけを取り直す（期間・ルール・活動日は再取得しない）。
  // 希望日タップのたびに全データを取り直して再描画するのを避ける。
  const refetchSelections = useCallback(async () => {
    if (!user || !period) return
    const [prefRes, movieRes] = await Promise.all([
      supabase
        .from('date_preferences')
        .select('*')
        .eq('period_id', period.id)
        .eq('user_id', user.id),
      supabase
        .from('period_movie_wishes')
        .select('*')
        .eq('period_id', period.id)
        .eq('user_id', user.id),
    ])
    const prefRows = (prefRes.data as DatePreference[]) ?? []
    setPreferences(prefRows)
    setMovieWishes((movieRes.data as MovieWish[]) ?? [])
    // 保存中・未保存の変更が残っていなければサーバー値で意図 ref を整合。
    if (!savingRef.current && !dirtyRef.current) {
      myDatesRef.current = prefRows
        .filter((p) => p.user_id === user.id)
        .sort((a, b) => a.rank - b.rank)
        .map((p) => p.date)
    }
  }, [user, period])

  useEffect(() => {
    void Promise.resolve().then(() => fetchData())
  }, [fetchData])

  useEffect(() => {
    storeViewMonth(viewYear, viewMonth)
  }, [viewYear, viewMonth])

  const setVisibleMonth = (year: number, month: number) => {
    setViewYear(year)
    setViewMonth(month)
    setSearchParams({ year: String(year), month: String(month + 1) })
    storeViewMonth(year, month)
    setDraftMovie(null)
    setExpandedMovie(null)
    setEditingAfterSubmit(false)
    // 別の月に切り替えたら最初のステップから
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

  const flashError = useCallback((msg: string) => {
    setPageError(msg)
  }, [])

  // ===== 希望日 =====

  // 希望日保存を直列化する。保存中に来た変更は dirty として畳み込み、
  // myDatesRef の「最新の意図」へサーバーを収束させてから一度だけ再取得する。
  // これにより RPC の並行・順不同応答による上書き（タップ取りこぼし）を防ぐ。
  const runPreferenceSaver = useCallback(async () => {
    if (!period) return
    if (savingRef.current) {
      dirtyRef.current = true
      return
    }
    savingRef.current = true
    let failed: string | null = null
    try {
      do {
        dirtyRef.current = false
        const dates = myDatesRef.current
        const { error } = await supabase.rpc('set_my_preferences', {
          p_period_id: period.id,
          p_dates: dates,
        })
        if (error) {
          failed = `希望日の保存に失敗しました: ${error.message}`
          break
        }
      } while (dirtyRef.current)
    } finally {
      savingRef.current = false
      dirtyRef.current = false
    }
    await refetchSelections()
    if (failed) flashError(failed)
  }, [period, refetchSelections, flashError])

  const applyOptimisticOrder = useCallback(
    (orderedDates: string[]) => {
      if (!user || !period) return
      setPreferences((prev) => {
        const others = prev.filter((p) => p.user_id !== user.id)
        const mineByDate = new Map(
          prev.filter((p) => p.user_id === user.id).map((p) => [p.date, p])
        )
        const mineNew: DatePreference[] = orderedDates.map((d, i) => {
          const existing = mineByDate.get(d)
          if (existing) return { ...existing, rank: i + 1, submitted_at: null }
          return {
            id: `temp-${d}`,
            period_id: period.id,
            user_id: user.id,
            date: d,
            rank: i + 1,
            movie_start_time: null,
            submitted_at: null,
          }
        })
        return [...others, ...mineNew]
      })
    },
    [user, period]
  )

  const commitDates = useCallback(
    (next: string[]) => {
      // ref を同期更新 → 直後のタップはこの最新値を基準にできる
      myDatesRef.current = next
      applyOptimisticOrder(next)
      // 修正モード中はDBに保存せずローカルのみ（提出時に一括反映）
      if (editingAfterSubmitRef.current) return
      void runPreferenceSaver()
    },
    [applyOptimisticOrder, runPreferenceSaver]
  )

  const togglePreferenceDate = useCallback(
    (date: string) => {
      const ordered = myDatesRef.current
      const exists = ordered.includes(date)
      const next = exists ? ordered.filter((d) => d !== date) : [...ordered, date]

      navigator.vibrate?.(exists ? 8 : 14)
      if (!exists) triggerFlash(date)

      commitDates(next)
    },
    [commitDates, triggerFlash]
  )

  const reorderPreferences = useCallback(
    (orderedDates: string[]) => {
      const current = myDatesRef.current
      // 並びが変わっていなければ保存リクエストを投げない
      if (orderedDates.length === current.length && orderedDates.every((d, i) => d === current[i])) {
        return
      }
      commitDates(orderedDates)
    },
    [commitDates]
  )

  const removePreference = useCallback(
    (date: string): Promise<string | null> => {
      const next = myDatesRef.current.filter((d) => d !== date)
      commitDates(next)
      return Promise.resolve(null)
    },
    [commitDates]
  )

  const resetPreferences = useCallback(() => {
    if (myDatesRef.current.length === 0) return
    if (!confirm('この月の希望日をすべてリセットしますか？')) return
    commitDates([])
  }, [commitDates])

  // ===== 観たい映画 =====

  // 修正モード中の映画変更をローカル状態にだけ反映する（DBには書かない）
  const applyMoviesLocal = useCallback(
    (payloads: MovieWishPayload[]) => {
      if (!user || !period) return
      setMovieWishes((prev) => {
        const others = prev.filter((w) => w.user_id !== user.id)
        const prevMine = prev.filter((w) => w.user_id === user.id).sort((a, b) => a.rank - b.rank)
        const mineNew: MovieWish[] = payloads.map((p, i) => ({
          id: prevMine[i]?.id ?? `temp-movie-${i}`,
          period_id: period.id,
          user_id: user.id,
          rank: i + 1,
          movie_title: p.title,
          movie_start_time: p.startTime || null,
          movie_duration_minutes: p.durationMinutes,
          movie_genre: p.genre || null,
          movie_watch_url: p.watchUrl || null,
          movie_description: p.description || null,
          movie_has_gore: p.hasGore,
          submitted_at: null,
        }))
        return [...others, ...mineNew]
      })
    },
    [user, period]
  )

  const saveMovies = useCallback(
    async (payloads: MovieWishPayload[]): Promise<string | null> => {
      // 修正モード中はDBに保存せずローカルのみ（提出時に一括反映）
      if (editingAfterSubmitRef.current) {
        applyMoviesLocal(payloads)
        return null
      }
      if (!period) return '期間が読み込まれていません'
      const { error } = await supabase.rpc('set_my_movie_wishes', {
        p_period_id: period.id,
        p_movies: payloads.map(payloadToJson),
      })
      if (error) return `映画希望の保存に失敗しました: ${error.message}`
      await refetchSelections()
      return null
    },
    [period, refetchSelections, applyMoviesLocal]
  )

  const currentMoviePayloads = useCallback(
    () => myMovieWishes.map(wishToPayload),
    [myMovieWishes]
  )

  const saveMovieAt = useCallback(
    async (index: number, payload: MovieWishPayload): Promise<string | null> => {
      const arr = currentMoviePayloads()
      arr[index] = payload
      return saveMovies(arr)
    },
    [currentMoviePayloads, saveMovies]
  )

  // 「順位・時刻」ページから、指定した希望日（順位）の開始時刻を設定する。
  // 開始時刻は希望日に紐づくので、映画の無い順位でも入力できる。
  const setDateStartTime = useCallback(
    async (date: string, startTime: string) => {
      // 修正モード中はローカル状態だけ更新（提出時に一括反映）
      if (editingAfterSubmitRef.current) {
        setPreferences((prev) =>
          prev.map((p) =>
            p.user_id === user?.id && p.date === date
              ? { ...p, movie_start_time: startTime || null, submitted_at: null }
              : p
          )
        )
        return
      }
      if (!period) return
      const { error } = await supabase.rpc('set_my_date_start_time', {
        p_period_id: period.id,
        p_date: date,
        p_start_time: startTime,
      })
      if (error) {
        flashError(`開始時刻の保存に失敗しました: ${error.message}`)
        return
      }
      await refetchSelections()
    },
    [period, refetchSelections, flashError, user]
  )

  const saveDraftMovie = useCallback(
    async (payload: MovieWishPayload): Promise<string | null> => {
      const arr = [...currentMoviePayloads(), payload]
      const err = await saveMovies(arr)
      if (!err) {
        setDraftMovie(null)
        setExpandedMovie(null)
      }
      return err
    },
    [currentMoviePayloads, saveMovies]
  )

  const removeMovieAt = useCallback(
    async (index: number): Promise<string | null> => {
      const arr = currentMoviePayloads().filter((_, i) => i !== index)
      return saveMovies(arr)
    },
    [currentMoviePayloads, saveMovies]
  )

  const resetMovies = useCallback(async () => {
    if (myMovieWishes.length === 0 && !draftMovie) return
    if (!confirm('登録した映画をすべてリセットしますか？')) return
    setDraftMovie(null)
    setExpandedMovie(null)
    if (myMovieWishes.length === 0) return
    const err = await saveMovies([])
    if (err) flashError(err)
  }, [myMovieWishes, draftMovie, saveMovies, flashError])

  const moveMovie = useCallback(
    async (index: number, direction: -1 | 1): Promise<string | null> => {
      const arr = currentMoviePayloads()
      const newIdx = index + direction
      if (newIdx < 0 || newIdx >= arr.length) return null
      ;[arr[index], arr[newIdx]] = [arr[newIdx], arr[index]]
      return saveMovies(arr)
    },
    [currentMoviePayloads, saveMovies]
  )

  const addMovie = useCallback(() => {
    setDraftMovie({ ...EMPTY_MOVIE_PAYLOAD })
    setExpandedMovie('draft')
  }, [])

  const toggleMovieExpand = useCallback((key: string) => {
    setExpandedMovie((prev) => (prev === key ? null : key))
  }, [])

  // ===== 提出 =====

  const submitPreferences = useCallback(async (): Promise<void> => {
    if (!period) return
    if (myPreferences.length === 0) {
      flashError('希望日を1件以上選んでから提出してください')
      return
    }
    if (myMovieWishes.length === 0) {
      flashError('観たい映画を1つ以上登録してから提出してください')
      return
    }
    if (!myPreferences.every((p) => !!p.movie_start_time)) {
      flashError('「順位・時刻」ページで各希望日の開始時刻を入力してください')
      return
    }

    setSubmittingPreferences(true)

    // 修正モード中はローカル編集をここで初めてDBへ反映する
    if (editingAfterSubmitRef.current) {
      const r1 = await supabase.rpc('set_my_preferences', {
        p_period_id: period.id,
        p_dates: myPreferences.map((p) => p.date),
      })
      if (r1.error) {
        setSubmittingPreferences(false)
        flashError(`希望日の保存に失敗しました: ${r1.error.message}`)
        return
      }
      for (const p of myPreferences) {
        const r2 = await supabase.rpc('set_my_date_start_time', {
          p_period_id: period.id,
          p_date: p.date,
          p_start_time: p.movie_start_time?.slice(0, 5) ?? '',
        })
        if (r2.error) {
          setSubmittingPreferences(false)
          flashError(`開始時刻の保存に失敗しました: ${r2.error.message}`)
          return
        }
      }
      const r3 = await supabase.rpc('set_my_movie_wishes', {
        p_period_id: period.id,
        p_movies: myMovieWishes.map(wishToPayload).map(payloadToJson),
      })
      if (r3.error) {
        setSubmittingPreferences(false)
        flashError(`映画希望の保存に失敗しました: ${r3.error.message}`)
        return
      }
    }

    const { error } = await supabase.rpc('submit_my_preferences', {
      p_period_id: period.id,
    })
    setSubmittingPreferences(false)
    if (error) {
      flashError(`希望の提出に失敗しました: ${error.message}`)
      return
    }
    await fetchData({ silent: true })
    setPageError(null)
    // 提出が完了したら「申請済み」着地画面に戻す
    setEditingAfterSubmit(false)
  }, [period, myPreferences, myMovieWishes, fetchData, flashError])

  const todayStr = formatDate(today)
  const periodLocked = !!period?.locked_at
  const periodOpen = isPeriodOpen(period)
  const canEdit = !!period && periodOpen
  const dateCount = myPreferences.length
  const movieCount = myMovieWishes.length
  // 映画件数を超える下位順位の希望日。上位の映画がすべて当選すると破棄される。
  const surplusDateCount = Math.max(0, dateCount - movieCount)
  // 希望日数を超える順位の映画。対応する希望日が無いため決して使われない。
  const surplusMovieCount = Math.max(0, movieCount - dateCount)
  const submitted =
    dateCount > 0 &&
    myPreferences.every((p) => !!p.submitted_at) &&
    myMovieWishes.every((w) => !!w.submitted_at)

  // すべての希望日に開始時刻が入っているか（映画の無い順位も含む）
  const startTimesComplete = dateCount > 0 && myPreferences.every((p) => !!p.movie_start_time)

  const canGoToStep2 = movieCount > 0
  const canGoToStep3 = movieCount > 0 && dateCount > 0
  const canGoToStep4 = canGoToStep3 && startTimesComplete
  const goToStep = (n: 1 | 2 | 3 | 4) => {
    if (n === 1) setStep(1)
    else if (n === 2 && canGoToStep2) setStep(2)
    else if (n === 3 && canGoToStep3) setStep(3)
    else if (n === 4 && canGoToStep4) setStep(4)
  }

  const STEPS = [
    { n: 1 as const, label: '映画' },
    { n: 2 as const, label: '希望日' },
    { n: 3 as const, label: '順位・時刻' },
    { n: 4 as const, label: '確認' },
  ]

  // 希望日と映画を同順位で対にした確認用リスト
  const pairedSummary = myPreferences.map((pref, i) => ({
    pref,
    wish: myMovieWishes[i] ?? null,
  }))
  const extraMovies = myMovieWishes.slice(dateCount)

  const summaryList = (
    <ul className="space-y-2">
      {pairedSummary.map(({ pref, wish }, i) => (
        <li key={pref.id} className="rounded-xl border border-line bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-line bg-bg/40">
            <span className="inline-flex items-center justify-center min-w-[3.25rem] px-1.5 h-6 rounded bg-accent/15 text-accent text-[11px] font-bold">
              第{i + 1}希望
            </span>
            <span className="text-sm font-semibold text-ink">{formatDateLabel(pref.date)}</span>
            {pref.movie_start_time && (
              <span className="ml-auto text-[12px] text-ink-muted tabular-nums">
                開始 {pref.movie_start_time.slice(0, 5)}
              </span>
            )}
          </div>
          <div className="px-3 py-2">
            {wish ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-ink-muted">
                <span className="inline-flex items-center gap-1 text-ink min-w-0">
                  <FilmIcon size={12} className="text-accent shrink-0" />
                  <span className="truncate">{wish.movie_title}</span>
                </span>
                {wish.movie_duration_minutes != null && (
                  <span className="tabular-nums">{wish.movie_duration_minutes}分</span>
                )}
                {wish.movie_genre && <span>· {wish.movie_genre}</span>}
              </div>
            ) : (
              <p className="text-[11px] text-ink-muted inline-flex items-center gap-1">
                <AlertIcon size={12} className="text-ink-dim shrink-0" />
                映画なし — 上位の映画がすべて当選した場合は破棄されます
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  )

  const extrasNote =
    extraMovies.length > 0 ? (
      <div className="rounded-lg border border-line bg-card px-3 py-2">
        <p className="text-[11px] text-ink-muted">
          以下の映画は希望日（{dateCount}件）を超える順位のため、対応する希望日がなく、使われることはありません。
        </p>
        <ul className="mt-1 space-y-0.5">
          {extraMovies.map((w) => (
            <li key={w.id} className="text-[12px] text-ink-muted inline-flex items-center gap-1">
              <FilmIcon size={11} className="text-accent" />
              {w.movie_title}
            </li>
          ))}
        </ul>
      </div>
    ) : null

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-accent uppercase tracking-wider">
            活動申請
          </p>
          <h2 className="text-xl font-bold text-ink font-display tabular-nums">
            {viewYear}年{viewMonth + 1}月
          </h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={prevMonth}
            aria-label="前月"
            className="p-2 rounded-lg text-ink-muted hover:text-ink hover:bg-card transition-colors"
          >
            <ChevronLeftIcon />
          </button>
          <button
            onClick={thisMonth}
            aria-label="今月へ戻る"
            className="min-w-[6rem] px-3 py-1.5 text-xs font-medium rounded-lg border border-line text-ink-muted hover:text-ink hover:border-accent/40 transition-colors"
          >
            {viewMonth + 1}月
          </button>
          <button
            onClick={nextMonth}
            aria-label="翌月"
            className="p-2 rounded-lg text-ink-muted hover:text-ink hover:bg-card transition-colors"
          >
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
        <div
          aria-live="polite"
          className="flex items-start gap-2 text-sm bg-danger-bg/60 border border-danger/30 rounded-lg px-3 py-2 text-danger"
        >
          <span className="flex-1">{pageError}</span>
          <button onClick={() => setPageError(null)} aria-label="閉じる" className="shrink-0">
            ×
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3" aria-hidden="true">
          <div className="h-10 rounded-lg bg-card animate-pulse" />
          <div className="grid grid-cols-5 gap-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="aspect-square rounded-lg bg-card animate-pulse" />
            ))}
          </div>
          <div className="h-24 rounded-xl bg-card animate-pulse" />
        </div>
      ) : !period ? (
        <p className="text-sm text-danger">期間レコードを取得できませんでした</p>
      ) : !canEdit ? (
        /* 受付期間外・確定済み: 読み取り専用の申請内容 */
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
          {dateCount === 0 ? (
            <p className="text-sm text-ink-muted text-center py-6">この月の申請はありません</p>
          ) : (
            <>
              {summaryList}
              {extrasNote}
            </>
          )}
        </section>
      ) : submitted && !editingAfterSubmit ? (
        /* 提出済み: 申請済み着地画面（修正で再編集） */
        <section className="space-y-3">
          <div className="rounded-xl border border-success/30 bg-success-bg/40 px-4 py-3">
            <p className="text-base font-bold text-success font-display inline-flex items-center gap-1.5">
              <CheckIcon size={18} />
              申請済みです
            </p>
            <p className="text-[11px] text-ink-muted mt-1">
              この内容で申請を受け付けました。内容を変えたい場合は「修正する」を押してください。
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
          {extrasNote}
        </section>
      ) : (
        <>
          {/* ステッパー */}
          <ol className="flex items-center gap-1">
            {STEPS.map((s, i) => {
              const active = step === s.n
              const done = step > s.n
              const reachable =
                s.n === 1
                  ? true
                  : s.n === 2
                    ? canGoToStep2
                    : s.n === 3
                      ? canGoToStep3
                      : canGoToStep4
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
                    <span
                      className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] tabular-nums ${
                        active ? 'bg-bg/20' : 'bg-card'
                      }`}
                    >
                      {done ? <CheckIcon size={12} /> : s.n}
                    </span>
                    {s.label}
                  </button>
                  {i < STEPS.length - 1 && (
                    <ChevronRightIcon size={14} className="text-ink-dim" />
                  )}
                </li>
              )
            })}
          </ol>

          {step === 2 && (
          <>
          {/* ② 希望日 */}
          <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-bold text-ink font-display">② 希望日を選ぶ</h3>
              {dateCount > 0 && canEdit ? (
                <button
                  onClick={resetPreferences}
                  className="shrink-0 inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-danger transition-colors"
                >
                  <TrashIcon size={12} />
                  リセット
                </button>
              ) : (
                <p className="text-[11px] text-ink-muted">タップで追加・解除</p>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="grid grid-cols-5 gap-1.5">
                {DAY_LABELS.map((label) => (
                  <div key={label} className="text-center text-sm font-medium text-ink-muted py-1">
                    {label}
                  </div>
                ))}
              </div>
              {weeks.map((week, wi) => (
                <div key={wi} className="grid grid-cols-5 gap-1.5">
                  {week.map((date, di) => {
                    if (!date) {
                      return <div key={di} className="rounded-lg" />
                    }
                    const dateStr = formatDate(date)
                    const isToday = todayStr === dateStr
                    const activity = resolveActivity(dateStr, rulesMap, daysMap)
                    const isActivity = activity.active
                    const timeLabel = isActivity
                      ? formatTimeRange(activity.start_time, activity.end_time)
                      : ''
                    const roomLabel = isActivity ? activity.room : null
                    const myRank = myRankByDate.get(dateStr) ?? null
                    const tappable = isActivity && canEdit

                    let cellClass = 'border-line bg-card opacity-40 cursor-not-allowed'
                    let dateClass = 'text-ink-dim'
                    let subClass = 'text-ink-dim'
                    if (isActivity) {
                      const selected = myRank !== null
                      cellClass = selected
                        ? 'border-accent-strong bg-accent text-bg'
                        : isToday
                          ? 'border-accent/60 bg-accent/10 hover:bg-accent/20'
                          : 'border-line bg-card hover:border-accent/50 hover:bg-card-hover'
                      dateClass = selected ? 'text-bg' : 'text-ink'
                      subClass = selected ? 'text-bg/80' : 'text-ink-muted'
                      if (!canEdit) {
                        cellClass += ' opacity-70 cursor-not-allowed'
                      }
                    }

                    const cellLabel = `${date.getMonth() + 1}月${date.getDate()}日${
                      isActivity
                        ? myRank !== null
                          ? `・第${myRank}希望（タップで解除）`
                          : '・タップで希望に追加'
                        : '・休み'
                    }`

                    return (
                      <button
                        key={di}
                        onClick={() => tappable && togglePreferenceDate(dateStr)}
                        disabled={!tappable}
                        aria-label={cellLabel}
                        aria-pressed={myRank !== null}
                        className={`relative aspect-square rounded-lg border p-1.5 flex flex-col items-center justify-between text-center transition-colors ${
                          tappable ? 'active:scale-95' : ''
                        } ${cellClass}`}
                      >
                        <span className={`text-base font-bold leading-none ${dateClass}`}>
                          {date.getDate()}
                        </span>
                        {isActivity ? (
                          <div className="flex flex-col items-center gap-0.5 w-full px-0.5 min-h-0">
                            {roomLabel && (
                              <span className={`text-[10px] font-medium leading-none truncate max-w-full ${subClass}`}>
                                {roomLabel}
                              </span>
                            )}
                            {timeLabel ? (
                              <span className={`text-[10px] font-medium leading-none ${subClass}`}>
                                {timeLabel}
                              </span>
                            ) : !roomLabel ? (
                              <span className={`text-[11px] leading-none ${subClass}`}>-</span>
                            ) : null}
                          </div>
                        ) : (
                          <span className={`text-[11px] leading-none ${subClass}`}>休</span>
                        )}
                        {myRank !== null && (
                          <span
                            className={`absolute top-1 left-1 text-[10px] font-bold px-1 rounded bg-bg text-accent leading-tight ${
                              flashDate === dateStr ? 'animate-badge-pop' : ''
                            }`}
                          >
                            {myRank}位
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>

            {myPreferences.length > 0 && (
              <p className="text-[11px] text-ink-muted pt-1">
                タップした順に第1・第2…希望になります。順位と開始時刻は次のページで調整します。
              </p>
            )}
          </section>

          {/* ステップ2 フッター */}
          <div className="space-y-2">
            {dateCount === 0 && (
              <p className="text-[11px] text-ink-muted text-center">
                希望日を1つ以上選んでください
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setStep(1)}
                className="px-4 py-2.5 text-sm font-semibold rounded-lg border border-line text-ink-muted hover:text-ink hover:border-accent/40 transition-colors inline-flex items-center gap-1"
              >
                <ChevronLeftIcon size={16} />
                映画
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={!canGoToStep3}
                className="flex-1 px-4 py-2.5 bg-accent text-bg text-sm font-semibold rounded-lg hover:bg-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-1.5"
              >
                次へ：順位・開始時刻
                <ChevronRightIcon size={16} />
              </button>
            </div>
          </div>
          </>
          )}

          {step === 1 && (
          <>
          {/* ① 観たい映画 */}
          <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-bold text-ink font-display">① 観たい映画を登録</h3>
              <div className="flex items-center gap-3">
                {(movieCount > 0 || draftMovie) && canEdit && (
                  <button
                    onClick={resetMovies}
                    className="shrink-0 inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-danger transition-colors"
                  >
                    <TrashIcon size={12} />
                    リセット
                  </button>
                )}
                <p className="text-[11px] text-ink-muted tabular-nums">{movieCount}件</p>
              </div>
            </div>
            <p className="text-[11px] text-ink-muted -mt-1">
              観たい映画を1つ以上登録してください。第N希望日には第N希望の映画が割り当てられます。
            </p>

            {surplusDateCount > 0 && (
              <p className="text-[11px] text-ink-muted bg-card border border-line rounded-lg px-3 py-2 inline-flex items-start gap-1">
                <AlertIcon size={12} className="mt-0.5 shrink-0 text-ink-dim" />
                映画が {movieCount}件 のため、第{movieCount + 1}希望以降の希望日（{surplusDateCount}件）は、上位の映画がすべて当選した場合は破棄されます。映画を追加すると下位順位にも割り当てられます。
              </p>
            )}

            {surplusMovieCount > 0 && (
              <p className="text-[11px] text-ink-muted bg-card border border-line rounded-lg px-3 py-2 inline-flex items-start gap-1">
                <AlertIcon size={12} className="mt-0.5 shrink-0 text-ink-dim" />
                希望日（{dateCount}件）を超える第{dateCount + 1}希望以降の映画（{surplusMovieCount}件）は、対応する希望日が無いため使われることはありません。
              </p>
            )}

            <div className="space-y-2">
              {myMovieWishes.map((wish, idx) => (
                <MovieWishCard
                  key={wish.id}
                  rank={wish.rank}
                  payload={wishToPayload(wish)}
                  isDraft={false}
                  isFirst={idx === 0}
                  isLast={idx === myMovieWishes.length - 1}
                  disabled={!canEdit}
                  expanded={expandedMovie === wish.id}
                  onToggleExpand={() => toggleMovieExpand(wish.id)}
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
                  disabled={!canEdit}
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
              <button
                onClick={addMovie}
                className="w-full px-4 py-2.5 border border-dashed border-accent/50 text-accent text-sm font-semibold rounded-lg hover:bg-accent/10 transition-colors inline-flex items-center justify-center gap-1.5"
              >
                <FilmIcon size={15} />
                映画を追加
              </button>
            )}
          </section>

          {/* ステップ1 フッター */}
          <div className="space-y-2">
            {movieCount === 0 && (
              <p className="text-[11px] text-ink-muted text-center">
                映画を1つ以上登録すると次に進めます
              </p>
            )}
            <button
              onClick={() => setStep(2)}
              disabled={!canGoToStep2}
              className="w-full px-4 py-2.5 bg-accent text-bg text-sm font-semibold rounded-lg hover:bg-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-1.5"
            >
              次へ：希望日を選ぶ
              <ChevronRightIcon size={16} />
            </button>
          </div>
          </>
          )}

          {step === 3 && (
          <>
          {/* ③ 順位・開始時刻 */}
          <section className="space-y-2">
            <h3 className="text-sm font-bold text-ink font-display">③ 順位と開始時刻</h3>
            <p className="text-[11px] text-ink-muted -mt-1">
              ⠿ をドラッグして希望順位を入れ替え、各順位の開始時刻を入力してください。第N希望日には第N希望の映画が割り当てられます。上位の希望が当選しなかった場合は、当選した順位の日付と映画の組み合わせになります（例：第1希望が外れて第2希望で当選 → 第2希望日＋第2希望の映画）。
            </p>

            <RankTimeEditor
              prefs={myPreferences}
              movieWishes={myMovieWishes}
              rulesMap={rulesMap}
              daysMap={daysMap}
              disabled={!canEdit}
              onReorder={reorderPreferences}
              onRemove={removePreference}
              onSetStartTime={setDateStartTime}
            />
          </section>

          {/* ステップ3 フッター */}
          <div className="space-y-2">
            {!startTimesComplete && (
              <p className="text-[11px] text-ink-muted text-center">
                対になる順位の開始時刻をすべて入力すると確認に進めます
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setStep(2)}
                className="px-4 py-2.5 text-sm font-semibold rounded-lg border border-line text-ink-muted hover:text-ink hover:border-accent/40 transition-colors inline-flex items-center gap-1"
              >
                <ChevronLeftIcon size={16} />
                希望日
              </button>
              <button
                onClick={() => setStep(4)}
                disabled={!canGoToStep4}
                className="flex-1 px-4 py-2.5 bg-accent text-bg text-sm font-semibold rounded-lg hover:bg-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-1.5"
              >
                確認へ進む
                <ChevronRightIcon size={16} />
              </button>
            </div>
          </div>
          </>
          )}

          {step === 4 && (
          <section className="space-y-3">
            <h3 className="text-sm font-bold text-ink font-display">④ 内容を確認して提出</h3>
            <p className="text-[11px] text-ink-muted -mt-1">
              第N希望日に第N希望の映画が割り当てられます。上位の希望が当選しなかった場合は、当選した順位の日付と映画の組み合わせになります（例：第1希望が外れて第2希望で当選 → 第2希望日＋第2希望の映画）。
              {surplusDateCount > 0 &&
                `映画が${movieCount}件のため、第${movieCount + 1}希望以降の希望日は上位がすべて当選すると破棄されます。`}
            </p>

            {summaryList}
            {extrasNote}

            <div
              className={`rounded-xl border px-4 py-3 space-y-3 ${
                submitted
                  ? 'bg-success-bg/40 border-success/30'
                  : 'bg-accent/10 border-accent/30'
              }`}
            >
              <div className="flex items-start gap-2">
                {submitted ? (
                  <CheckIcon size={16} className="mt-0.5 text-success shrink-0" />
                ) : (
                  <AlertIcon size={16} className="mt-0.5 text-accent shrink-0" />
                )}
                <div className="min-w-0" aria-live="polite">
                  <p className={`text-sm font-bold ${submitted ? 'text-success' : 'text-ink'}`}>
                    {submitted ? '提出済みです' : 'まだ提出していません'}
                  </p>
                  <p className="text-[11px] text-ink-muted mt-0.5 tabular-nums">
                    希望日 {dateCount}件 ／ 映画 {movieCount}件
                    {submitted
                      ? '。希望日や映画を変更すると未提出に戻ります。'
                      : '。締切前に提出してください。未提出の希望は集計されません。'}
                  </p>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setStep(3)}
                  className="px-4 py-2.5 text-sm font-semibold rounded-lg border border-line text-ink-muted hover:text-ink hover:border-accent/40 transition-colors inline-flex items-center gap-1"
                >
                  <ChevronLeftIcon size={16} />
                  順位・時刻
                </button>
                {!submitted && (
                  <button
                    onClick={submitPreferences}
                    disabled={
                      !canEdit ||
                      submittingPreferences ||
                      dateCount === 0 ||
                      movieCount === 0 ||
                      !startTimesComplete
                    }
                    className="flex-1 px-4 py-2.5 bg-accent text-bg text-sm font-semibold rounded-lg hover:bg-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {submittingPreferences ? '提出中…' : 'この内容で提出する'}
                  </button>
                )}
              </div>
            </div>
          </section>
          )}
        </>
      )}
    </div>
  )
}
