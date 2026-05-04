export type AttendanceStatus = 'going' | 'not_going'

export type Attendance = {
  user_id: string
  date: string
  status: AttendanceStatus
  profiles: { display_name: string } | null
}

export type ActivityRule = {
  weekday: number
  enabled: boolean
  start_time: string
  end_time: string
  room: string | null
}

export type ActivityDay = {
  date: string
  is_active: boolean
  start_time: string | null
  end_time: string | null
  room: string | null
  note: string | null
}

export type ResolvedActivity = {
  active: boolean
  start_time: string | null
  end_time: string | null
  room: string | null
  source: 'override' | 'rule' | 'none'
}

export type ActivityPeriod = {
  id: string
  year: number
  month: number
  deadline_at: string
  locked_at: string | null
  created_at: string
}

export type DatePreference = {
  id: string
  period_id: string
  user_id: string
  date: string
  rank: number
  profiles?: { display_name: string } | null
}

export type MovieWish = {
  period_id: string
  user_id: string
  movie_title: string
  movie_url: string | null
  movie_note: string | null
  created_at?: string
  updated_at?: string
}

export type ActivityAssignment = {
  date: string
  period_id: string
  host_user_id: string | null
  movie_title: string | null
  movie_description: string | null
  movie_duration_minutes: number | null
  movie_genre: string | null
  movie_poster_url: string | null
  movie_watch_url: string | null
  locked_at: string
  movie_updated_at: string | null
  profiles?: { display_name: string } | null
}

export function getIsoWeekday(date: Date): number {
  const d = date.getDay()
  return d === 0 ? 7 : d
}

export function formatTime(t: string | null): string | null {
  if (!t) return null
  return t.slice(0, 5)
}

export function resolveActivity(
  dateStr: string,
  rules: Map<number, ActivityRule>,
  overrides: Map<string, ActivityDay>
): ResolvedActivity {
  const override = overrides.get(dateStr)
  if (override) {
    if (!override.is_active) {
      return { active: false, start_time: null, end_time: null, room: null, source: 'override' }
    }
    const rule = rules.get(getIsoWeekday(new Date(dateStr + 'T00:00:00')))
    return {
      active: true,
      start_time: formatTime(override.start_time) ?? formatTime(rule?.start_time ?? null),
      end_time: formatTime(override.end_time) ?? formatTime(rule?.end_time ?? null),
      room: override.room ?? rule?.room ?? null,
      source: 'override',
    }
  }

  const wd = getIsoWeekday(new Date(dateStr + 'T00:00:00'))
  const rule = rules.get(wd)
  if (rule?.enabled) {
    return {
      active: true,
      start_time: formatTime(rule.start_time),
      end_time: formatTime(rule.end_time),
      room: rule.room ?? null,
      source: 'rule',
    }
  }

  return { active: false, start_time: null, end_time: null, room: null, source: 'none' }
}

export function formatTimeRange(start: string | null, end: string | null): string {
  const s = formatTime(start)
  const e = formatTime(end)
  if (s && e) return `${s}–${e}`
  if (s) return `${s}〜`
  if (e) return `〜${e}`
  return ''
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

export function getJstToday(): string {
  const now = new Date(Date.now() + JST_OFFSET_MS)
  return now.toISOString().slice(0, 10)
}

// 期間が「希望提出受付中」かどうか
export function isPeriodOpen(period: ActivityPeriod | null, now: Date = new Date()): boolean {
  if (!period) return false
  if (period.locked_at) return false
  return new Date(period.deadline_at).getTime() > now.getTime()
}

// 期間が「締切過ぎ＆未集計」かどうか
export function isPeriodPendingLock(period: ActivityPeriod | null, now: Date = new Date()): boolean {
  if (!period) return false
  if (period.locked_at) return false
  return new Date(period.deadline_at).getTime() <= now.getTime()
}

// 該当月のデフォルト締切（前月最終日12:00 JST）をUTCのDateで返す
export function getDefaultDeadlineForMonth(year: number, month: number): Date {
  // 該当月の1日 00:00 JST から12時間引く = 前月最終日 12:00 JST
  // JSTで表現された Date を作って toISOString で UTC に変換
  // year/month: month は 1-12
  const firstOfMonthJstMs = Date.UTC(year, month - 1, 1, 0, 0, 0) - JST_OFFSET_MS
  return new Date(firstOfMonthJstMs - 12 * 60 * 60 * 1000)
}

// timestamptz文字列を datetime-local input value (JST) に変換
export function deadlineToInputValue(deadlineIso: string): string {
  const d = new Date(deadlineIso)
  const jst = new Date(d.getTime() + JST_OFFSET_MS)
  return jst.toISOString().slice(0, 16)
}

// datetime-local input value (JST) を ISO timestamp に変換
export function inputValueToDeadline(value: string): string {
  // value は "2026-04-30T12:00" 形式（JSTとして解釈）
  const jstAsUtcMs = new Date(value + ':00Z').getTime()
  return new Date(jstAsUtcMs - JST_OFFSET_MS).toISOString()
}

export function formatDeadline(deadlineIso: string): string {
  const d = new Date(deadlineIso)
  const jst = new Date(d.getTime() + JST_OFFSET_MS)
  const y = jst.getUTCFullYear()
  const mo = jst.getUTCMonth() + 1
  const da = jst.getUTCDate()
  const hh = String(jst.getUTCHours()).padStart(2, '0')
  const mm = String(jst.getUTCMinutes()).padStart(2, '0')
  return `${y}/${mo}/${da} ${hh}:${mm}`
}

// 順位の日本語ラベル
export function rankLabel(rank: number): string {
  return `第${rank}希望`
}
