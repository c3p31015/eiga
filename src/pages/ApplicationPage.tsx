import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import PreferenceDateCard, { type DateWishPayload } from '../components/PreferenceDateCard'
import { AlertIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon } from '../components/icons'
import {
  type ActivityRule,
  type ActivityDay,
  type ActivityPeriod,
  type DatePreference,
  resolveActivity,
  formatTimeRange,
  formatDeadline,
  isPeriodOpen,
  getStoredViewMonth,
  storeViewMonth,
} from '../lib/activity'

const DAY_LABELS = ['月', '火', '水', '木', '金']

function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
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
  const [loading, setLoading] = useState(true)
  const [submittingPreferences, setSubmittingPreferences] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set())

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

  const myRankByDate = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of myPreferences) m.set(p.date, p.rank)
    return m
  }, [myPreferences])

  const myMovieFilledByDate = useMemo(() => {
    const m = new Map<string, boolean>()
    for (const p of myPreferences) m.set(p.date, !!p.movie_title)
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

    const [periodRes, rulesRes, daysRes, preferencesRes] = await Promise.all([
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
    ])

    setPeriod((periodRes.data as ActivityPeriod | null) ?? null)
    setActivityRules((rulesRes.data as ActivityRule[]) ?? [])
    setActivityDays((daysRes.data as ActivityDay[]) ?? [])
    setPreferences((preferencesRes.data as DatePreference[]) ?? [])

    if (!options.silent) setLoading(false)
  }, [viewYear, viewMonth, user])

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
    setExpandedDates(new Set())
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

  const savePreferenceDates = useCallback(
    async (dates: string[]): Promise<string | null> => {
      if (!period) return '期間が読み込まれていません'
      const { error } = await supabase.rpc('set_my_preferences', {
        p_period_id: period.id,
        p_dates: dates,
      })
      if (error) return `希望の保存に失敗しました: ${error.message}`
      await fetchData({ silent: true })
      return null
    },
    [period, fetchData]
  )

  const applyOptimisticOrder = useCallback(
    (orderedDates: string[]) => {
      if (!user || !period) return
      const newRankByDate = new Map<string, number>()
      orderedDates.forEach((d, i) => newRankByDate.set(d, i + 1))
      setPreferences((prev) => {
        // 自分以外の prefs はそのまま、自分の prefs は new rank に並び替え
        const others = prev.filter((p) => p.user_id !== user.id)
        const mineByDate = new Map(
          prev.filter((p) => p.user_id === user.id).map((p) => [p.date, p])
        )
        const mineNew: DatePreference[] = orderedDates.map((d, i) => {
          const existing = mineByDate.get(d)
          if (existing) return { ...existing, rank: i + 1, submitted_at: null }
          // 新規追加: 一時的なIDで埋める（silent refetchで実IDに置換）
          return {
            id: `temp-${d}`,
            period_id: period.id,
            user_id: user.id,
            date: d,
            rank: i + 1,
            submitted_at: null,
            movie_title: null,
            movie_start_time: null,
            movie_duration_minutes: null,
            movie_genre: null,
            movie_watch_url: null,
            movie_description: null,
            movie_has_gore: false,
          }
        })
        return [...others, ...mineNew]
      })
    },
    [user, period]
  )

  const togglePreferenceDate = useCallback(
    async (date: string) => {
      const ordered = myPreferences.map((p) => p.date)
      const exists = ordered.includes(date)
      const next = exists ? ordered.filter((d) => d !== date) : [...ordered, date]
      const before = preferences

      // 楽観更新
      applyOptimisticOrder(next)
      setExpandedDates((prev) => {
        const newSet = new Set(prev)
        if (exists) newSet.delete(date)
        else newSet.add(date)
        return newSet
      })

      const err = await savePreferenceDates(next)
      if (err) {
        setPreferences(before)
        setExpandedDates((prev) => {
          const newSet = new Set(prev)
          if (exists) newSet.add(date)
          else newSet.delete(date)
          return newSet
        })
        flashError(err)
      }
    },
    [myPreferences, preferences, applyOptimisticOrder, savePreferenceDates, flashError]
  )

  const submitPreferences = useCallback(async (): Promise<void> => {
    if (!period) return
    if (myPreferences.length === 0) {
      flashError('希望日を1件以上選んでから提出してください')
      return
    }

    const incomplete = myPreferences.filter(
      (p) => !p.movie_title || !p.movie_start_time || !p.movie_duration_minutes
    )
    if (incomplete.length > 0) {
      flashError('提出するには、すべての希望日にタイトル・開始時刻・上映時間を入力してください')
      setExpandedDates(new Set(incomplete.map((p) => p.date)))
      return
    }

    setSubmittingPreferences(true)
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
  }, [period, myPreferences, fetchData, flashError])

  const moveRank = useCallback(
    async (date: string, direction: -1 | 1) => {
      const ordered = myPreferences.map((p) => p.date)
      const idx = ordered.indexOf(date)
      if (idx < 0) return
      const newIdx = idx + direction
      if (newIdx < 0 || newIdx >= ordered.length) return
      ;[ordered[idx], ordered[newIdx]] = [ordered[newIdx], ordered[idx]]
      const before = preferences

      // 楽観更新で即時反映
      applyOptimisticOrder(ordered)

      const err = await savePreferenceDates(ordered)
      if (err) {
        setPreferences(before)
        flashError(err)
      }
    },
    [myPreferences, preferences, applyOptimisticOrder, savePreferenceDates, flashError]
  )

  const removePreference = useCallback(
    async (date: string): Promise<string | null> => {
      const ordered = myPreferences.map((p) => p.date).filter((d) => d !== date)
      const before = preferences

      applyOptimisticOrder(ordered)
      setExpandedDates((prev) => {
        const newSet = new Set(prev)
        newSet.delete(date)
        return newSet
      })

      const err = await savePreferenceDates(ordered)
      if (err) {
        setPreferences(before)
        flashError(err)
        return err
      }
      return null
    },
    [myPreferences, preferences, applyOptimisticOrder, savePreferenceDates, flashError]
  )

  const saveDateWish = useCallback(
    async (date: string, payload: DateWishPayload): Promise<string | null> => {
      if (!period) return '期間が読み込まれていません'
      const { error } = await supabase.rpc('set_my_date_wish', {
        p_period_id: period.id,
        p_date: date,
        p_title: payload.title,
        p_start_time: payload.title.trim() ? payload.startTime : null,
        p_duration_minutes: payload.title.trim() ? payload.durationMinutes : null,
        p_genre: payload.genre || null,
        p_watch_url: payload.watchUrl || null,
        p_description: payload.description || null,
        p_has_gore: payload.hasGore,
      })
      if (error) return `映画情報の保存に失敗しました: ${error.message}`
      await fetchData({ silent: true })
      return null
    },
    [period, fetchData]
  )

  const toggleExpand = (date: string) => {
    setExpandedDates((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(date)) {
        newSet.delete(date)
      } else {
        newSet.add(date)
      }
      return newSet
    })
  }

  const todayStr = formatDate(today)
  const periodLocked = !!period?.locked_at
  const periodOpen = isPeriodOpen(period)
  const canEdit = !!period && periodOpen
  const incompleteMovieCount = myPreferences.filter(
    (p) => !p.movie_title || !p.movie_start_time || !p.movie_duration_minutes
  ).length
  const submitted = myPreferences.length > 0 && myPreferences.every((p) => !!p.submitted_at)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-accent uppercase tracking-wider">
            活動申請
          </p>
          <h2 className="text-xl font-bold text-ink">
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
        <div className="flex items-start gap-2 text-sm bg-danger-bg/60 border border-danger/30 rounded-lg px-3 py-2 text-danger">
          <span className="flex-1">{pageError}</span>
          <button onClick={() => setPageError(null)} aria-label="閉じる" className="shrink-0">
            ×
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-ink-muted">読み込み中...</p>
      ) : !period ? (
        <p className="text-sm text-danger">期間レコードを取得できませんでした</p>
      ) : (
        <>
          {/* 希望日選択カレンダー */}
          <section className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h3 className="text-sm font-bold text-ink">希望日を選ぶ</h3>
              <p className="text-[11px] text-ink-muted">
                {canEdit ? 'タップで追加・解除' : '受付期間外'}
              </p>
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
                    const movieFilled = myMovieFilledByDate.get(dateStr) ?? false
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

                    return (
                      <button
                        key={di}
                        onClick={() => tappable && togglePreferenceDate(dateStr)}
                        disabled={!tappable}
                        className={`relative aspect-square rounded-lg border p-1.5 flex flex-col items-center justify-between text-center transition-all ${
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
                          <>
                            <span className="absolute top-1 left-1 text-[10px] font-bold px-1 rounded bg-bg text-accent leading-tight">
                              {myRank}位
                            </span>
                            <span
                              className={`absolute top-1 right-1 inline-flex items-center justify-center w-4 h-4 rounded-full ${
                                movieFilled ? 'bg-success/90 text-bg' : 'bg-danger/90 text-bg'
                              }`}
                              aria-label={movieFilled ? '映画入力済み' : '映画未入力'}
                            >
                              {movieFilled ? <CheckIcon size={10} /> : <AlertIcon size={10} />}
                            </span>
                          </>
                        )}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-center gap-3 text-[11px] text-ink-muted pt-1">
              <span className="inline-flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-accent border border-accent-strong" />
                追加済み
              </span>
              <span className="inline-flex items-center gap-1">
                <CheckIcon size={11} className="text-success" />
                映画入力済
              </span>
              <span className="inline-flex items-center gap-1">
                <AlertIcon size={11} className="text-danger" />
                映画未入力
              </span>
            </div>
          </section>

          {/* 希望日カードリスト */}
          {myPreferences.length > 0 ? (
            <section className="space-y-2">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-bold text-ink">
                  あなたの希望（{myPreferences.length}件）
                </h3>
                {incompleteMovieCount > 0 && (
                  <p className="text-[11px] text-danger inline-flex items-center gap-1">
                    <AlertIcon size={11} />
                    必須項目未入力 {incompleteMovieCount}件
                  </p>
                )}
              </div>
              <p className="text-[11px] text-ink-muted -mt-1">
                順位はカード右側の ↑↓ で入れ替え。タップで詳細を展開して映画情報を入力してください。
              </p>

              <div className="space-y-2">
                {myPreferences.map((pref, idx) => {
                  const activity = resolveActivity(pref.date, rulesMap, daysMap)
                  return (
                    <PreferenceDateCard
                      key={pref.id}
                      pref={pref}
                      isFirst={idx === 0}
                      isLast={idx === myPreferences.length - 1}
                      expanded={expandedDates.has(pref.date)}
                      disabled={!canEdit}
                      activityStart={activity.start_time}
                      activityEnd={activity.end_time}
                      onToggleExpand={() => toggleExpand(pref.date)}
                      onMoveUp={() => moveRank(pref.date, -1)}
                      onMoveDown={() => moveRank(pref.date, 1)}
                      onRemove={() => removePreference(pref.date)}
                      onSaveWish={(payload) => saveDateWish(pref.date, payload)}
                    />
                  )
                })}
              </div>

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
                  <div className="min-w-0">
                    <p className={`text-sm font-bold ${submitted ? 'text-success' : 'text-ink'}`}>
                      {submitted ? '提出済みです' : 'まだ下書きです'}
                    </p>
                    <p className="text-[11px] text-ink-muted mt-0.5">
                      {submitted
                        ? '希望日や順位を変更すると未提出に戻ります。'
                        : 'この内容で確定する場合は、締切前に提出してください。未提出の希望は集計されません。'}
                    </p>
                  </div>
                </div>
                {!submitted && (
                  <button
                    onClick={submitPreferences}
                    disabled={!canEdit || submittingPreferences || incompleteMovieCount > 0}
                    className="w-full px-4 py-2.5 bg-accent text-bg text-sm font-semibold rounded-lg hover:bg-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {submittingPreferences ? '提出中...' : 'この希望を提出する'}
                  </button>
                )}
              </div>
            </section>
          ) : (
            canEdit && (
              <p className="text-sm text-ink-muted text-center py-4">
                上のカレンダーから活動可能日をタップして希望に追加してください
              </p>
            )
          )}
        </>
      )}
    </div>
  )
}
