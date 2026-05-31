import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import DayPreferenceModal from '../components/DayPreferenceModal'
import { ChevronLeftIcon, ChevronRightIcon, FilmIcon, UsersIcon } from '../components/icons'
import {
  type ActivityRule,
  type ActivityDay,
  type ActivityPeriod,
  type ActivityAssignment,
  type Attendance,
  type AttendanceStatus,
  resolveActivity,
  formatTimeRange,
  formatDeadline,
  isPeriodOpen,
  isPeriodPendingLock,
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

export default function CalendarPage() {
  const { user, profile } = useAuth()
  const isAdmin = !!profile?.is_admin
  const today = new Date()
  const initialMonth = getStoredViewMonth(today)
  const [viewYear, setViewYear] = useState(initialMonth.year)
  const [viewMonth, setViewMonth] = useState(initialMonth.month)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [period, setPeriod] = useState<ActivityPeriod | null>(null)
  const [activityRules, setActivityRules] = useState<ActivityRule[]>([])
  const [activityDays, setActivityDays] = useState<ActivityDay[]>([])
  const [assignments, setAssignments] = useState<ActivityAssignment[]>([])
  const [profilesById, setProfilesById] = useState<Map<string, string>>(new Map())
  const [attendances, setAttendances] = useState<Attendance[]>([])
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

  const assignmentsByDate = useMemo(() => {
    const m = new Map<string, ActivityAssignment>()
    for (const a of assignments) m.set(a.date, a)
    return m
  }, [assignments])

  const attendancesByDate = useMemo(() => {
    const m = new Map<string, Attendance[]>()
    for (const a of attendances) {
      const list = m.get(a.date)
      if (list) list.push(a)
      else m.set(a.date, [a])
    }
    return m
  }, [attendances])

  const fetchData = useCallback(async () => {
    setLoading(true)
    const firstDay = formatDate(new Date(viewYear, viewMonth, 1))
    const lastDay = formatDate(new Date(viewYear, viewMonth + 1, 0))

    let periodId: string | null = null
    if (user) {
      const { data: periodIdData, error: ensureError } = await supabase.rpc('ensure_period', {
        p_year: viewYear,
        p_month: viewMonth + 1,
      })
      if (ensureError) {
        console.error('ensure_period failed:', ensureError)
      }
      periodId = (periodIdData as string | null) ?? null
    } else {
      const { data: periodRow } = await supabase
        .from('activity_periods')
        .select('id')
        .eq('year', viewYear)
        .eq('month', viewMonth + 1)
        .maybeSingle()
      periodId = (periodRow as { id: string } | null)?.id ?? null
    }

    const [periodRes, rulesRes, daysRes, assignmentsRes, attendancesRes, profilesRes] =
      await Promise.all([
        periodId
          ? supabase.from('activity_periods').select('*').eq('id', periodId).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabase.from('activity_rules').select('*'),
        supabase
          .from('activity_days')
          .select('*')
          .gte('date', firstDay)
          .lte('date', lastDay),
        supabase
          .from('activity_assignments')
          .select('*, profiles:host_user_id(display_name)')
          .gte('date', firstDay)
          .lte('date', lastDay),
        supabase
          .from('activity_attendances')
          .select('user_id, date, status, profiles(display_name)')
          .gte('date', firstDay)
          .lte('date', lastDay),
        supabase.from('profiles').select('id, display_name'),
      ])

    setPeriod((periodRes.data as ActivityPeriod | null) ?? null)
    setActivityRules((rulesRes.data as ActivityRule[]) ?? [])
    setActivityDays((daysRes.data as ActivityDay[]) ?? [])
    setAssignments((assignmentsRes.data as unknown as ActivityAssignment[]) ?? [])
    setAttendances((attendancesRes.data as unknown as Attendance[]) ?? [])
    const map = new Map<string, string>()
    for (const p of (profilesRes.data as { id: string; display_name: string }[]) ?? []) {
      map.set(p.id, p.display_name)
    }
    setProfilesById(map)

    setLoading(false)
  }, [viewYear, viewMonth, user])

  useEffect(() => {
    void Promise.resolve().then(fetchData)
  }, [fetchData])

  useEffect(() => {
    storeViewMonth(viewYear, viewMonth)
  }, [viewYear, viewMonth])

  // 締切過ぎ＆未集計の期間があれば自動でロック（ログイン時のみ）
  useEffect(() => {
    if (loading) return
    if (!user) return
    if (!period) return
    if (!isPeriodPendingLock(period)) return

    let cancelled = false
    ;(async () => {
      const { error: rpcError } = await supabase.rpc('lock_activity_period', {
        p_period_id: period.id,
      })
      if (cancelled) return
      if (rpcError) {
        console.error('lock_activity_period failed:', rpcError)
        return
      }
      await fetchData()
    })()
    return () => {
      cancelled = true
    }
  }, [loading, user, period, fetchData])

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

  const setAttendance = useCallback(
    async (status: AttendanceStatus | null): Promise<string | null> => {
      if (!selectedDate || !user) return null
      if (status === null) {
        const { error } = await supabase
          .from('activity_attendances')
          .delete()
          .eq('user_id', user.id)
          .eq('date', selectedDate)
        if (error) return `参加表明の取り消しに失敗しました: ${error.message}`
      } else {
        const { error } = await supabase.from('activity_attendances').upsert(
          {
            user_id: user.id,
            date: selectedDate,
            status,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,date' }
        )
        if (error) return `参加表明の更新に失敗しました: ${error.message}`
      }
      await fetchData()
      return null
    },
    [selectedDate, user, fetchData]
  )

  const todayStr = formatDate(today)
  const selectedActivity = selectedDate
    ? resolveActivity(selectedDate, rulesMap, daysMap)
    : null
  const selectedAssignment = selectedDate ? assignmentsByDate.get(selectedDate) ?? null : null
  const selectedHostName =
    selectedAssignment?.host_user_id && isAdmin
      ? profilesById.get(selectedAssignment.host_user_id) ?? null
      : null

  const periodLocked = !!period?.locked_at
  const periodOpen = isPeriodOpen(period)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-accent uppercase tracking-wider">
            活動日確認
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
        <>
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
          {periodOpen && (
            <Link
              to={user ? `/apply?year=${viewYear}&month=${viewMonth + 1}` : '/login'}
              className="block text-center bg-accent text-bg text-sm font-semibold rounded-lg py-2.5 hover:bg-accent-strong transition-colors"
            >
              {user ? 'この月の活動申請をする →' : 'ログインして活動申請をする →'}
            </Link>
          )}
        </>
      )}

      {loading ? (
        <p className="text-ink-muted text-sm">読み込み中...</p>
      ) : (
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
                const assignment = assignmentsByDate.get(dateStr)
                const dayAttendances = attendancesByDate.get(dateStr) ?? []
                const goingCount = dayAttendances.filter((a) => a.status === 'going').length
                const hostIsMe = !!assignment?.host_user_id && assignment.host_user_id === user?.id
                const hostName = assignment?.host_user_id
                  ? hostIsMe
                    ? 'あなた'
                    : isAdmin
                      ? profilesById.get(assignment.host_user_id) ?? null
                      : null
                  : null

                const isConfirmedActivity = periodLocked && !!assignment?.host_user_id

                let cellClass = 'border-line bg-card opacity-40 cursor-not-allowed'
                let dateClass = 'text-ink-dim'
                let subClass = 'text-ink-dim'
                if (isConfirmedActivity) {
                  cellClass = isToday
                    ? 'border-accent-strong bg-accent text-bg shadow-[0_0_0_1px_var(--color-accent-strong)]'
                    : 'border-accent/70 bg-accent text-bg hover:bg-accent-strong'
                  dateClass = 'text-bg'
                  subClass = 'text-bg/80'
                } else if (isActivity) {
                  cellClass = isToday
                    ? 'border-accent/40 bg-card hover:bg-card-hover'
                    : 'border-line bg-card hover:bg-card-hover'
                  dateClass = isToday ? 'text-accent' : 'text-ink'
                  subClass = 'text-ink-muted'
                } else if (isToday) {
                  cellClass = 'border-accent/40 bg-card opacity-100 cursor-not-allowed'
                  dateClass = 'text-accent'
                  subClass = 'text-ink-dim'
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
                        {periodLocked ? (
                          assignment?.movie_title ? (
                            <span className={`text-[11px] font-bold leading-tight line-clamp-2 max-w-full ${subClass}`}>
                              {assignment.movie_title}
                            </span>
                          ) : assignment?.host_user_id ? (
                            <span className={`text-[11px] leading-tight line-clamp-2 max-w-full ${subClass}`}>
                              {hostName ?? '主催者'}
                            </span>
                          ) : (
                            <span className={`text-[11px] leading-none ${subClass}`}>休止</span>
                          )
                        ) : (
                          <>
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
                          </>
                        )}
                        {goingCount > 0 && periodLocked && (
                          <span
                            className={`inline-flex items-center gap-0.5 text-[10px] font-semibold leading-none ${subClass}`}
                          >
                            <UsersIcon size={10} />
                            {goingCount}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className={`text-[11px] leading-none ${subClass}`}>休</span>
                    )}
                    {periodLocked && assignment?.movie_title && (
                      <span className="absolute top-1 right-1 text-bg">
                        <FilmIcon size={11} />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-center gap-4 text-xs text-ink-muted pt-1">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-accent border border-accent/70" />
          活動日（確定）
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-card border border-line" />
          活動可能日
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-card border border-line opacity-40" />
          休み
        </span>
      </div>

      <p className="text-sm text-ink-dim text-center">
        {periodLocked
          ? '主催者と上映作品が確定しています'
          : user
            ? '申請受付中です。「申請」タブから希望日を提出してください'
            : '申請受付中です。ログインすると希望日を提出できます'}
      </p>

      {selectedDate && selectedActivity?.active && (
        <DayPreferenceModal
          dateStr={selectedDate}
          currentUserId={user?.id ?? null}
          isAdmin={isAdmin}
          activityStart={selectedActivity.start_time}
          activityEnd={selectedActivity.end_time}
          activityRoom={selectedActivity.room}
          assignment={selectedAssignment}
          hostName={selectedHostName}
          attendances={attendancesByDate.get(selectedDate) ?? []}
          periodLocked={periodLocked}
          onAttendanceChange={setAttendance}
          onAssignmentSaved={fetchData}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </div>
  )
}
