import { useState, useEffect, useCallback, useMemo, useId } from 'react'
import { supabase } from '../lib/supabase'
import {
  type ActivityRule,
  type ActivityDay,
  resolveActivity,
  formatTimeRange,
  formatTime,
} from '../lib/activity'
import { ChevronLeftIcon, ChevronRightIcon } from './icons'

const WEEKDAY_LABELS: Record<number, string> = {
  1: '月', 2: '火', 3: '水', 4: '木', 5: '金',
}

const DAY_HEAD = ['月', '火', '水', '木', '金']

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

type ActivityScheduleEditorProps = {
  viewYear: number
  viewMonth: number
  onPrevMonth: () => void
  onNextMonth: () => void
}

export default function ActivityScheduleEditor({
  viewYear,
  viewMonth,
  onPrevMonth,
  onNextMonth,
}: ActivityScheduleEditorProps) {
  const [rules, setRules] = useState<ActivityRule[]>([])
  const [days, setDays] = useState<ActivityDay[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const toggleSelectedDate = (dateStr: string) => {
    setSelectedDates((prev) => {
      const next = new Set(prev)
      if (next.has(dateStr)) next.delete(dateStr)
      else next.add(dateStr)
      return next
    })
  }
  const clearSelection = () => setSelectedDates(new Set())

  const rulesMap = useMemo(() => {
    const m = new Map<number, ActivityRule>()
    for (const r of rules) m.set(r.weekday, r)
    return m
  }, [rules])

  const daysMap = useMemo(() => {
    const m = new Map<string, ActivityDay>()
    for (const d of days) m.set(d.date, d)
    return m
  }, [days])

  const flash = (msg: string, isError = false) => {
    if (isError) {
      setError(msg)
      setSuccess('')
    } else {
      setSuccess(msg)
      setError('')
    }
    setTimeout(() => { setError(''); setSuccess('') }, 2500)
  }

  const fetchData = useCallback(async () => {
    setLoading(true)
    const firstDay = formatDate(new Date(viewYear, viewMonth, 1))
    const lastDay = formatDate(new Date(viewYear, viewMonth + 1, 0))
    const [rulesRes, daysRes] = await Promise.all([
      supabase.from('activity_rules').select('*').order('weekday'),
      supabase
        .from('activity_days')
        .select('*')
        .gte('date', firstDay)
        .lte('date', lastDay),
    ])
    setRules((rulesRes.data as ActivityRule[]) ?? [])
    setDays((daysRes.data as ActivityDay[]) ?? [])
    setLoading(false)
  }, [viewYear, viewMonth])

  useEffect(() => {
    void Promise.resolve().then(fetchData)
  }, [fetchData])

  const updateRule = async (weekday: number, patch: Partial<ActivityRule>) => {
    const prev = rulesMap.get(weekday)
    if (!prev) return
    const next = { ...prev, ...patch }
    setRules(rules.map((r) => (r.weekday === weekday ? next : r)))
    const { error: err } = await supabase
      .from('activity_rules')
      .update({
        enabled: next.enabled,
        start_time: next.start_time,
        end_time: next.end_time,
        room: next.room,
        updated_at: new Date().toISOString(),
      })
      .eq('weekday', weekday)
    if (err) {
      flash(`曜日ルールの更新に失敗: ${err.message}`, true)
      await fetchData()
    } else {
      flash(`${WEEKDAY_LABELS[weekday]}曜のルールを保存しました`)
    }
  }

  const weeks = getMonthWeeks(viewYear, viewMonth)

  return (
    <section className="space-y-5">
      <h3 className="text-lg font-bold text-ink font-display">活動日・活動時間</h3>

      {error && (
        <p aria-live="polite" className="text-sm text-danger bg-danger-bg/60 border border-danger/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      {success && (
        <p aria-live="polite" className="text-sm text-success bg-success-bg/60 border border-success/30 rounded-lg px-3 py-2">
          {success}
        </p>
      )}

      <div className="bg-card rounded-xl border border-line p-5 space-y-3">
        <h4 className="font-semibold text-ink">曜日ごとの基本ルール</h4>
        <p className="text-xs text-ink-muted">
          ここで有効にした曜日が毎週の活動日になります。特定の日だけ変更したい場合は下の「個別の日付設定」で上書きできます。
        </p>
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((wd) => {
            const rule = rulesMap.get(wd)
            if (!rule) return null
            return (
              <WeeklyRuleRow
                key={wd}
                rule={rule}
                onUpdate={(patch) => updateRule(wd, patch)}
              />
            )
          })}
        </div>
      </div>

      <div className="bg-card rounded-xl border border-line p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-ink">個別の日付設定</h4>
          <div className="flex items-center gap-1">
            <button
              onClick={onPrevMonth}
              aria-label="前月"
              className="p-2 rounded-lg text-ink-muted hover:text-ink hover:bg-card-hover transition-colors"
            >
              <ChevronLeftIcon />
            </button>
            <span className="text-sm font-medium text-ink min-w-[6rem] text-center">
              {viewYear}年{viewMonth + 1}月
            </span>
            <button
              onClick={onNextMonth}
              aria-label="翌月"
              className="p-2 rounded-lg text-ink-muted hover:text-ink hover:bg-card-hover transition-colors"
            >
              <ChevronRightIcon />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2"><div className="h-9 rounded-lg bg-card animate-pulse" /><div className="h-9 rounded-lg bg-card animate-pulse" /></div>
        ) : (
          <div className="space-y-1.5">
            <div className="grid grid-cols-5 gap-1.5">
              {DAY_HEAD.map((label) => (
                <div
                  key={label}
                  className="text-center text-xs font-medium text-ink-muted py-1"
                >
                  {label}
                </div>
              ))}
            </div>
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-5 gap-1.5">
                {week.map((date, di) => {
                  if (!date) return <div key={di} className="rounded-lg" />
                  const dateStr = formatDate(date)
                  const activity = resolveActivity(dateStr, rulesMap, daysMap)
                  const override = daysMap.get(dateStr)
                  const isSelected = selectedDates.has(dateStr)
                  const isActive = activity.active

                  let cellClass = 'border-line bg-bg'
                  let dateClass = 'text-ink-dim'
                  let subClass = 'text-ink-dim'
                  if (isActive) {
                    cellClass = 'border-accent/70 bg-accent text-bg'
                    dateClass = 'text-bg'
                    subClass = 'text-bg/80'
                  }
                  if (isSelected) {
                    cellClass += ' ring-2 ring-accent-strong'
                  }

                  return (
                    <button
                      key={di}
                      onClick={() => toggleSelectedDate(dateStr)}
                      className={`relative aspect-square rounded-lg border p-1.5 flex flex-col items-center justify-between transition-all active:scale-95 ${cellClass}`}
                    >
                      <span className={`text-sm font-bold leading-none ${dateClass}`}>
                        {date.getDate()}
                      </span>
                      {isActive ? (
                        <div className="flex flex-col items-center gap-0.5 w-full px-0.5 min-h-0">
                          {activity.room && (
                            <span className={`text-[9px] font-medium leading-none truncate max-w-full ${subClass}`}>
                              {activity.room}
                            </span>
                          )}
                          <span className={`text-[9px] leading-none ${subClass}`}>
                            {formatTimeRange(activity.start_time, activity.end_time) || '活動'}
                          </span>
                        </div>
                      ) : (
                        <span className={`text-[9px] leading-none ${subClass}`}>休</span>
                      )}
                      {override && (
                        <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-bg border border-accent" />
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        )}

        {selectedDates.size > 0 && (
          <DateOverridePanel
            dates={Array.from(selectedDates).sort()}
            daysMap={daysMap}
            rulesMap={rulesMap}
            onSaved={async (msg) => {
              flash(msg)
              clearSelection()
              await fetchData()
            }}
            onError={(msg) => flash(msg, true)}
            onClose={clearSelection}
          />
        )}

        <p className="text-xs text-ink-dim text-center">
          日付をタップで選択（複数可）
        </p>

        <div className="flex items-center justify-center gap-4 text-[11px] text-ink-muted pt-2">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-accent border border-accent/70" />
            活動日
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-bg border border-line" />
            休み
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-bg border border-accent" />
            個別設定あり
          </span>
        </div>
      </div>
    </section>
  )
}

type WeeklyRuleRowProps = {
  rule: ActivityRule
  onUpdate: (patch: Partial<ActivityRule>) => void
}

function WeeklyRuleRow({ rule, onUpdate }: WeeklyRuleRowProps) {
  const [roomDraft, setRoomDraft] = useState(rule.room ?? '')
  const baseId = useId()
  const enabledId = `${baseId}-enabled`
  const startId = `${baseId}-start`
  const endId = `${baseId}-end`
  const roomId = `${baseId}-room`

  useEffect(() => {
    void Promise.resolve().then(() => setRoomDraft(rule.room ?? ''))
  }, [rule.room])

  const commitRoom = () => {
    const next = roomDraft.trim() || null
    if (next !== (rule.room ?? null)) onUpdate({ room: next })
  }

  return (
    <div className="py-1 flex flex-wrap items-center gap-x-3 gap-y-2">
      <label htmlFor={enabledId} className="flex items-center gap-2 cursor-pointer shrink-0">
        <input
          id={enabledId}
          name="enabled"
          type="checkbox"
          checked={rule.enabled}
          onChange={(e) => onUpdate({ enabled: e.target.checked })}
          className="w-4 h-4 rounded border-line bg-bg text-accent focus:ring-accent/50"
        />
        <span className="text-sm font-medium text-ink w-8">
          {WEEKDAY_LABELS[rule.weekday]}曜
        </span>
      </label>
      <div className="flex items-center gap-2">
        <input
          id={startId}
          name="startTime"
          aria-label="開始時刻"
          type="time"
          value={formatTime(rule.start_time) ?? ''}
          onChange={(e) => onUpdate({ start_time: e.target.value })}
          disabled={!rule.enabled}
          className="px-2 py-1.5 bg-bg border border-line rounded-lg text-sm text-ink disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
        />
        <span className="text-ink-dim text-sm">〜</span>
        <input
          id={endId}
          name="endTime"
          aria-label="終了時刻"
          type="time"
          value={formatTime(rule.end_time) ?? ''}
          onChange={(e) => onUpdate({ end_time: e.target.value })}
          disabled={!rule.enabled}
          className="px-2 py-1.5 bg-bg border border-line rounded-lg text-sm text-ink disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
        />
      </div>
      <input
        id={roomId}
        name="room"
        aria-label="教室"
        autoComplete="off"
        type="text"
        value={roomDraft}
        onChange={(e) => setRoomDraft(e.target.value)}
        onBlur={commitRoom}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        disabled={!rule.enabled}
        placeholder="教室（任意）"
        className="flex-1 min-w-[8rem] px-2 py-1.5 bg-bg border border-line rounded-lg text-sm text-ink placeholder:text-ink-dim disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
      />
    </div>
  )
}

type PanelProps = {
  dates: string[]
  daysMap: Map<string, ActivityDay>
  rulesMap: Map<number, ActivityRule>
  onSaved: (msg: string) => Promise<void> | void
  onError: (msg: string) => void
  onClose: () => void
}

type Mode = 'default' | 'active' | 'inactive'
type TimeMode = 'rule' | 'custom'
type RoomMode = 'rule' | 'custom'

const WEEKDAY_SHORT = ['日', '月', '火', '水', '木', '金', '土']

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY_SHORT[d.getDay()]})`
}

function DateOverridePanel({
  dates,
  daysMap,
  rulesMap,
  onSaved,
  onError,
  onClose,
}: PanelProps) {
  const isBatch = dates.length > 1
  const singleDate = dates.length === 1 ? dates[0] : null
  const singleOverride = singleDate ? daysMap.get(singleDate) : undefined
  const singleRule = singleDate
    ? rulesMap.get(
        new Date(singleDate + 'T00:00:00').getDay() === 0
          ? 7
          : new Date(singleDate + 'T00:00:00').getDay()
      )
    : undefined

  const initialMode: Mode = !singleOverride
    ? (isBatch ? 'active' : 'default')
    : singleOverride.is_active
      ? 'active'
      : 'inactive'

  const initialStart =
    formatTime(singleOverride?.start_time ?? null) ??
    formatTime(singleRule?.start_time ?? null) ??
    '19:00'
  const initialEnd =
    formatTime(singleOverride?.end_time ?? null) ??
    formatTime(singleRule?.end_time ?? null) ??
    '21:00'
  const initialTimeMode: TimeMode =
    !isBatch && singleOverride?.start_time ? 'custom' : 'rule'

  const initialRoom =
    singleOverride?.room ?? singleRule?.room ?? ''
  const initialRoomMode: RoomMode =
    !isBatch && singleOverride?.room ? 'custom' : 'rule'

  const [mode, setMode] = useState<Mode>(initialMode)
  const [timeMode, setTimeMode] = useState<TimeMode>(initialTimeMode)
  const [startTime, setStartTime] = useState(initialStart)
  const [endTime, setEndTime] = useState(initialEnd)
  const [roomMode, setRoomMode] = useState<RoomMode>(initialRoomMode)
  const [room, setRoom] = useState(initialRoom)
  const [note, setNote] = useState(singleOverride?.note ?? '')
  const [saving, setSaving] = useState(false)
  const resetKey = dates.join(',')
  const baseId = useId()
  const modeDefaultId = `${baseId}-mode-default`
  const modeActiveId = `${baseId}-mode-active`
  const modeInactiveId = `${baseId}-mode-inactive`
  const timeRuleId = `${baseId}-time-rule`
  const timeCustomId = `${baseId}-time-custom`
  const customStartId = `${baseId}-custom-start`
  const customEndId = `${baseId}-custom-end`
  const roomRuleId = `${baseId}-room-rule`
  const roomCustomId = `${baseId}-room-custom`
  const roomInputId = `${baseId}-room-input`
  const noteId = `${baseId}-note`

  useEffect(() => {
    void Promise.resolve().then(() => {
      setMode(initialMode)
      setTimeMode(initialTimeMode)
      setStartTime(initialStart)
      setEndTime(initialEnd)
      setRoomMode(initialRoomMode)
      setRoom(initialRoom)
      setNote(singleOverride?.note ?? '')
    })
  }, [
    resetKey,
    initialMode,
    initialTimeMode,
    initialStart,
    initialEnd,
    initialRoomMode,
    initialRoom,
    singleOverride?.note,
  ])

  const headingLabel = isBatch
    ? `${dates.length}件の日付`
    : formatDateLabel(dates[0])

  const handleSave = async () => {
    setSaving(true)
    if (mode === 'default') {
      const { error: err } = await supabase
        .from('activity_days')
        .delete()
        .in('date', dates)
      setSaving(false)
      if (err) {
        onError(`個別設定の解除に失敗: ${err.message}`)
        return
      }
      await onSaved(`${dates.length}件の個別設定を解除しました`)
      onClose()
      return
    }

    const useCustomTime = mode === 'active' && timeMode === 'custom'
    const useCustomRoom = mode === 'active' && roomMode === 'custom'
    const nowIso = new Date().toISOString()
    const rows = dates.map((date) => ({
      date,
      is_active: mode === 'active',
      start_time: useCustomTime ? startTime : null,
      end_time: useCustomTime ? endTime : null,
      room: useCustomRoom ? (room.trim() || null) : null,
      note: !isBatch && mode === 'active' ? (note.trim() || null) : null,
      updated_at: nowIso,
    }))

    const { error: err } = await supabase
      .from('activity_days')
      .upsert(rows, { onConflict: 'date' })
    setSaving(false)
    if (err) {
      onError(`保存に失敗: ${err.message}`)
      return
    }
    await onSaved(`${dates.length}件の個別設定を保存しました`)
    onClose()
  }

  const previewDates = dates.slice(0, 8).map(formatDateLabel).join('、')
  const moreCount = dates.length - 8

  return (
    <div className="bg-bg border border-accent/40 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-ink tabular-nums">{headingLabel}を編集</p>
          <p className="text-xs text-ink-muted mt-0.5 break-words tabular-nums">
            {previewDates}{moreCount > 0 && ` ほか${moreCount}件`}
          </p>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 text-xs text-ink-muted hover:text-ink"
        >
          選択解除
        </button>
      </div>

      <div className="space-y-2">
        <label htmlFor={modeDefaultId} className="flex items-start gap-2 cursor-pointer">
          <input
            id={modeDefaultId}
            type="radio"
            name="mode"
            checked={mode === 'default'}
            onChange={() => setMode('default')}
            className="mt-1 text-accent focus:ring-accent/50"
          />
          <span className="text-sm text-ink">
            曜日ルール通り
            <span className="text-ink-muted text-xs ml-1">（個別設定を削除）</span>
          </span>
        </label>
        <label htmlFor={modeActiveId} className="flex items-start gap-2 cursor-pointer">
          <input
            id={modeActiveId}
            type="radio"
            name="mode"
            checked={mode === 'active'}
            onChange={() => setMode('active')}
            className="mt-1 text-accent focus:ring-accent/50"
          />
          <span className="text-sm text-ink">活動日にする</span>
        </label>
        <label htmlFor={modeInactiveId} className="flex items-start gap-2 cursor-pointer">
          <input
            id={modeInactiveId}
            type="radio"
            name="mode"
            checked={mode === 'inactive'}
            onChange={() => setMode('inactive')}
            className="mt-1 text-accent focus:ring-accent/50"
          />
          <span className="text-sm text-ink">休みにする</span>
        </label>
      </div>

      {mode === 'active' && (
        <div className="space-y-2 pl-6">
          <div className="space-y-1.5">
            <label htmlFor={timeRuleId} className="flex items-center gap-2 cursor-pointer">
              <input
                id={timeRuleId}
                type="radio"
                name="timeMode"
                checked={timeMode === 'rule'}
                onChange={() => setTimeMode('rule')}
                className="text-accent focus:ring-accent/50"
              />
              <span className="text-sm text-ink">
                曜日ルールの時間を使う
              </span>
            </label>
            <label htmlFor={timeCustomId} className="flex items-center gap-2 cursor-pointer">
              <input
                id={timeCustomId}
                type="radio"
                name="timeMode"
                checked={timeMode === 'custom'}
                onChange={() => setTimeMode('custom')}
                className="text-accent focus:ring-accent/50"
              />
              <span className="text-sm text-ink">時間を指定</span>
            </label>
          </div>
          {timeMode === 'custom' && (
            <div className="flex items-center gap-2 pl-6">
              <input
                id={customStartId}
                name="customStartTime"
                aria-label="開始時刻"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="px-2 py-1.5 bg-bg border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
              />
              <span className="text-ink-dim">〜</span>
              <input
                id={customEndId}
                name="customEndTime"
                aria-label="終了時刻"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="px-2 py-1.5 bg-bg border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
              />
            </div>
          )}

          <div className="space-y-1.5 pt-1">
            <label htmlFor={roomRuleId} className="flex items-center gap-2 cursor-pointer">
              <input
                id={roomRuleId}
                type="radio"
                name="roomMode"
                checked={roomMode === 'rule'}
                onChange={() => setRoomMode('rule')}
                className="text-accent focus:ring-accent/50"
              />
              <span className="text-sm text-ink">
                曜日ルールの教室を使う
                {singleRule?.room && (
                  <span className="text-ink-muted text-xs ml-1">（{singleRule.room}）</span>
                )}
              </span>
            </label>
            <label htmlFor={roomCustomId} className="flex items-center gap-2 cursor-pointer">
              <input
                id={roomCustomId}
                type="radio"
                name="roomMode"
                checked={roomMode === 'custom'}
                onChange={() => setRoomMode('custom')}
                className="text-accent focus:ring-accent/50"
              />
              <span className="text-sm text-ink">教室を指定</span>
            </label>
          </div>
          {roomMode === 'custom' && (
            <input
              id={roomInputId}
              name="customRoom"
              aria-label="教室"
              autoComplete="off"
              type="text"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="例: 301教室、視聴覚室"
              className="w-full px-3 py-2 bg-bg border border-line rounded-lg text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
            />
          )}

          {!isBatch && (
            <input
              id={noteId}
              name="note"
              aria-label="メモ"
              autoComplete="off"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="メモ（任意）例: 特別上映、ゲスト回 など"
              className="w-full px-3 py-2 bg-bg border border-line rounded-lg text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
            />
          )}
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full inline-flex items-center justify-center px-4 py-2 bg-accent text-bg text-sm font-semibold rounded-lg hover:bg-accent-strong disabled:opacity-50 transition-colors tabular-nums"
      >
        {saving ? '保存中…' : `${dates.length}件に適用して保存`}
      </button>
    </div>
  )
}
