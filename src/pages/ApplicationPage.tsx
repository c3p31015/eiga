import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import DayPreferenceModal from '../components/DayPreferenceModal'
import { ChevronLeftIcon, ChevronRightIcon, FilmIcon } from '../components/icons'
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
  rankLabel,
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

export default function ApplicationPage() {
  const { user } = useAuth()
  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [period, setPeriod] = useState<ActivityPeriod | null>(null)
  const [activityRules, setActivityRules] = useState<ActivityRule[]>([])
  const [activityDays, setActivityDays] = useState<ActivityDay[]>([])
  const [preferences, setPreferences] = useState<DatePreference[]>([])
  const [myWish, setMyWish] = useState<MovieWish | null>(null)
  const [wishTitle, setWishTitle] = useState('')
  const [wishUrl, setWishUrl] = useState('')
  const [wishNote, setWishNote] = useState('')
  const [savingWish, setSavingWish] = useState(false)
  const [wishMessage, setWishMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [loading, setLoading] = useState(true)

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

  const preferenceCountByDate = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of preferences) {
      m.set(p.date, (m.get(p.date) ?? 0) + 1)
    }
    return m
  }, [preferences])

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

  const fetchData = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const { data: periodIdData, error: ensureError } = await supabase.rpc('ensure_period', {
      p_year: viewYear,
      p_month: viewMonth + 1,
    })
    if (ensureError) {
      console.error('ensure_period failed:', ensureError)
    }
    const periodId = periodIdData as string | null

    const [periodRes, rulesRes, daysRes, preferencesRes, wishRes] = await Promise.all([
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
            .select('*, profiles(display_name)')
            .eq('period_id', periodId)
        : Promise.resolve({ data: [], error: null }),
      periodId
        ? supabase
            .from('period_movie_wishes')
            .select('*')
            .eq('period_id', periodId)
            .eq('user_id', user.id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])

    setPeriod((periodRes.data as ActivityPeriod | null) ?? null)
    setActivityRules((rulesRes.data as ActivityRule[]) ?? [])
    setActivityDays((daysRes.data as ActivityDay[]) ?? [])
    setPreferences((preferencesRes.data as DatePreference[]) ?? [])
    const wish = (wishRes.data as MovieWish | null) ?? null
    setMyWish(wish)
    setWishTitle(wish?.movie_title ?? '')
    setWishUrl(wish?.movie_url ?? '')
    setWishNote(wish?.movie_note ?? '')

    setLoading(false)
  }, [viewYear, viewMonth, user])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const prevMonth = () => {
    const d = new Date(viewYear, viewMonth - 1, 1)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
    setSelectedDate(null)
  }
  const nextMonth = () => {
    const d = new Date(viewYear, viewMonth + 1, 1)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
    setSelectedDate(null)
  }
  const thisMonth = () => {
    const now = new Date()
    setViewYear(now.getFullYear())
    setViewMonth(now.getMonth())
    setSelectedDate(null)
  }

  const savePreferences = useCallback(
    async (dates: string[]): Promise<string | null> => {
      if (!period) return '期間が読み込まれていません'
      const { error } = await supabase.rpc('set_my_preferences', {
        p_period_id: period.id,
        p_dates: dates,
      })
      if (error) return `希望の保存に失敗しました: ${error.message}`
      await fetchData()
      return null
    },
    [period, fetchData]
  )

  const flashWish = (kind: 'ok' | 'err', text: string) => {
    setWishMessage({ kind, text })
    setTimeout(() => setWishMessage(null), 2500)
  }

  const saveWish = async () => {
    if (!period) return
    setSavingWish(true)
    const { error } = await supabase.rpc('set_my_movie_wish', {
      p_period_id: period.id,
      p_title: wishTitle,
      p_url: wishUrl || null,
      p_note: wishNote || null,
    })
    setSavingWish(false)
    if (error) {
      flashWish('err', `保存に失敗しました: ${error.message}`)
      return
    }
    flashWish('ok', wishTitle.trim() ? '観たい映画を保存しました' : '観たい映画を削除しました')
    fetchData()
  }

  const todayStr = formatDate(today)
  const periodLocked = !!period?.locked_at
  const periodOpen = isPeriodOpen(period)
  const canEdit = !!period && periodOpen
  const wishDirty =
    (wishTitle.trim() || '') !== (myWish?.movie_title ?? '') ||
    (wishUrl.trim() || '') !== (myWish?.movie_url ?? '') ||
    (wishNote.trim() || '') !== (myWish?.movie_note ?? '')

  const selectedActivity = selectedDate
    ? resolveActivity(selectedDate, rulesMap, daysMap)
    : null
  const selectedPrefsForDate = selectedDate
    ? preferences.filter((p) => p.date === selectedDate)
    : []

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
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-line text-ink-muted hover:text-ink hover:border-accent/40 transition-colors"
          >
            今月
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

      {loading ? (
        <p className="text-sm text-ink-muted">読み込み中...</p>
      ) : !period ? (
        <p className="text-sm text-danger">期間レコードを取得できませんでした</p>
      ) : (
        <>
          {/* 観たい映画 */}
          <section className="bg-card rounded-xl border border-line px-4 py-4 space-y-3">
            <div className="flex items-center gap-2">
              <FilmIcon size={16} className="text-accent" />
              <h3 className="text-sm font-bold text-ink">観たい映画</h3>
            </div>
            <p className="text-xs text-ink-muted -mt-1">
              主催者になった日に上映する候補。確定後も編集できます（任意）。
            </p>
            <div className="space-y-2">
              <input
                type="text"
                value={wishTitle}
                onChange={(e) => setWishTitle(e.target.value)}
                disabled={!canEdit}
                placeholder="タイトル（例: ショーシャンクの空に）"
                className="w-full px-3 py-2.5 bg-bg border border-line rounded-lg text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent disabled:opacity-50"
              />
              <input
                type="url"
                value={wishUrl}
                onChange={(e) => setWishUrl(e.target.value)}
                disabled={!canEdit}
                placeholder="視聴URL（任意）"
                className="w-full px-3 py-2.5 bg-bg border border-line rounded-lg text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent disabled:opacity-50"
              />
              <textarea
                value={wishNote}
                onChange={(e) => setWishNote(e.target.value)}
                disabled={!canEdit}
                placeholder="メモ（任意・あらすじや一言など）"
                rows={2}
                className="w-full px-3 py-2.5 bg-bg border border-line rounded-lg text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent disabled:opacity-50 resize-none"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-ink-dim">
                {myWish
                  ? `登録済み: ${myWish.movie_title}`
                  : '未登録（主催者になっても作品は手動で入力）'}
              </p>
              <button
                onClick={saveWish}
                disabled={!canEdit || savingWish || !wishDirty}
                className="px-4 py-2 bg-accent text-bg text-sm font-semibold rounded-lg hover:bg-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {savingWish ? '保存中...' : '保存'}
              </button>
            </div>
            {wishMessage && (
              <p
                className={`text-xs px-3 py-2 rounded-lg border ${
                  wishMessage.kind === 'ok'
                    ? 'bg-success-bg/60 border-success/30 text-success'
                    : 'bg-danger-bg/60 border-danger/30 text-danger'
                }`}
              >
                {wishMessage.text}
              </p>
            )}
          </section>

          {/* 希望日選択 */}
          <section className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h3 className="text-sm font-bold text-ink">希望日を選ぶ</h3>
              <p className="text-[11px] text-ink-muted">
                活動可能日をタップして追加
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
                    const prefCount = preferenceCountByDate.get(dateStr) ?? 0

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
                    }

                    return (
                      <button
                        key={di}
                        onClick={() => isActivity && setSelectedDate(dateStr)}
                        disabled={!isActivity}
                        className={`relative aspect-square rounded-lg border p-1.5 flex flex-col items-center justify-between text-center transition-all ${
                          isActivity ? 'active:scale-95' : ''
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
                            {prefCount > 0 ? (
                              <span className={`text-[11px] font-semibold leading-none ${subClass}`}>
                                {prefCount}希望
                              </span>
                            ) : timeLabel ? (
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
                          <span className="absolute top-1 right-1 text-[10px] font-bold px-1 rounded bg-bg text-accent leading-tight">
                            {rankLabel(myRank)}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-center gap-4 text-xs text-ink-muted pt-1">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-accent border border-accent-strong" />
                希望に追加済み
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-card border border-line" />
                未追加
              </span>
            </div>
          </section>

          {/* 自分の希望順位サマリ */}
          {myPreferences.length > 0 && (
            <section className="bg-card rounded-xl border border-line px-4 py-3 space-y-2">
              <p className="text-sm font-bold text-ink">あなたの希望順位</p>
              <ul className="space-y-1">
                {myPreferences.map((pref) => {
                  const dt = new Date(pref.date + 'T00:00:00')
                  const label = `${dt.getMonth() + 1}/${dt.getDate()}`
                  return (
                    <li
                      key={pref.id}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="text-accent font-bold w-14">
                        {rankLabel(pref.rank)}
                      </span>
                      <span className="flex-1 text-ink">{label}</span>
                      <button
                        onClick={() => setSelectedDate(pref.date)}
                        className="text-xs text-ink-muted hover:text-accent"
                      >
                        編集
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </>
      )}

      {selectedDate && user && selectedActivity?.active && (
        <DayPreferenceModal
          mode="apply"
          dateStr={selectedDate}
          currentUserId={user.id}
          period={period}
          activityStart={selectedActivity.start_time}
          activityEnd={selectedActivity.end_time}
          activityRoom={selectedActivity.room}
          myPreferences={myPreferences}
          preferencesForDate={selectedPrefsForDate}
          assignment={null}
          hostName={null}
          attendances={[]}
          onSavePreferences={savePreferences}
          onAttendanceChange={async () => null}
          onAssignmentSaved={fetchData}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </div>
  )
}
