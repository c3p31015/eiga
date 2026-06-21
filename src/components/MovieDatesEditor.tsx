import { useState } from 'react'
import {
  resolveActivity,
  formatTimeRange,
  timeStringToMinutes,
  minutesToTimeString,
  type ActivityRule,
  type ActivityDay,
} from '../lib/activity'
import {
  AlertIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  FilmIcon,
  TrashIcon,
} from './icons'

// 開始時刻を一括適用する小コントロール（映画ごと／全映画で再利用）
export function BulkTimeControl({
  label,
  defaultTime = '18:10',
  disabled,
  onApply,
}: {
  label: string
  defaultTime?: string
  disabled?: boolean
  onApply: (startTime: string) => void
}) {
  const [t, setT] = useState(defaultTime)
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-bg/40 px-2.5 py-1.5">
      <span className="text-[11px] text-ink-muted flex-1 min-w-0">{label}</span>
      <input
        type="time"
        step={300}
        value={t}
        disabled={disabled}
        onChange={(e) => setT(e.target.value)}
        onClick={openTimePicker}
        aria-label={label}
        className="shrink-0 px-2 py-1 bg-bg border border-line rounded-lg text-sm text-ink cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent disabled:opacity-50"
      />
      <button
        onClick={() => t && onApply(t)}
        disabled={disabled || !t}
        className="shrink-0 px-3 py-1 text-xs font-semibold rounded-lg bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        一括適用
      </button>
    </div>
  )
}

const DAY_LABELS = ['月', '火', '水', '木', '金']

export type CandidateDate = { date: string; startTime: string }
export type EditorMovie = {
  title: string
  durationMinutes: number | null
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

// クリックで時刻ピッカーを開く（時計アイコン以外の枠内でも）
function openTimePicker(e: React.MouseEvent<HTMLInputElement>) {
  const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void }
  try {
    el.showPicker?.()
  } catch {
    /* 非対応ブラウザは通常入力にフォールバック */
  }
}

// すべての映画に同じ候補日を一括適用するコントロール（自前のカレンダー選択）
export function BulkDatesControl({
  weeks,
  rulesMap,
  daysMap,
  todayStr,
  disabled,
  onApply,
}: {
  weeks: (Date | null)[][]
  rulesMap: Map<number, ActivityRule>
  daysMap: Map<string, ActivityDay>
  todayStr: string
  disabled?: boolean
  onApply: (dates: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])

  const toggle = (d: string) =>
    setSelected((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))

  const apply = () => {
    if (selected.length === 0) return
    if (!confirm('すべての映画の候補日を、この選択で上書きします。よろしいですか？')) return
    onApply(selected)
  }

  return (
    <div className="rounded-lg border border-line bg-bg/40 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="text-[12px] font-semibold text-ink">
          すべての映画に同じ候補日を一括適用
        </span>
        <span className="text-ink-muted">
          {open ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
        </span>
      </button>

      {open && (
        <div className="border-t border-line px-3 py-3 space-y-2">
          <p className="text-[11px] text-ink-muted">
            日付を選ぶと（タップ順が優先順）、その候補日を全映画にまとめて設定します。開始時刻は各映画の既存値を保持し、新しい日は 18:10 になります。
          </p>
          <div className="space-y-1.5">
            <div className="grid grid-cols-5 gap-1.5">
              {DAY_LABELS.map((label) => (
                <div key={label} className="text-center text-xs font-medium text-ink-muted py-0.5">
                  {label}
                </div>
              ))}
            </div>
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-5 gap-1.5">
                {week.map((date, di) => {
                  if (!date) return <div key={di} className="rounded-lg" />
                  const dateStr = formatDate(date)
                  const isToday = todayStr === dateStr
                  const activity = resolveActivity(dateStr, rulesMap, daysMap)
                  const isActivity = activity.active
                  const idx = selected.indexOf(dateStr)
                  const isSel = idx >= 0
                  const tappable = isActivity && !disabled

                  let cellClass = 'border-line bg-card opacity-40 cursor-not-allowed'
                  let dateClass = 'text-ink-dim'
                  let subClass = 'text-ink-dim'
                  if (isActivity) {
                    if (isSel) {
                      cellClass = 'border-accent-strong bg-accent text-bg'
                      dateClass = 'text-bg'
                      subClass = 'text-bg/80'
                    } else {
                      cellClass = isToday
                        ? 'border-accent/60 bg-accent/10 hover:bg-accent/20'
                        : 'border-line bg-card hover:border-accent/50 hover:bg-card-hover'
                      dateClass = 'text-ink'
                      subClass = 'text-ink-muted'
                    }
                  }
                  const timeLabel = isActivity ? formatTimeRange(activity.start_time, activity.end_time) : ''

                  return (
                    <button
                      key={di}
                      onClick={() => tappable && toggle(dateStr)}
                      disabled={!tappable}
                      aria-pressed={isSel}
                      className={`relative aspect-square rounded-lg border p-1 flex flex-col items-center justify-between text-center transition-colors ${
                        tappable ? 'active:scale-95' : ''
                      } ${cellClass}`}
                    >
                      <span className={`text-sm font-bold leading-none ${dateClass}`}>{date.getDate()}</span>
                      {isActivity ? (
                        <span className={`text-[9px] leading-none ${subClass}`}>{timeLabel || '-'}</span>
                      ) : (
                        <span className={`text-[10px] leading-none ${subClass}`}>休</span>
                      )}
                      {isSel && (
                        <span className="absolute top-0.5 left-0.5 text-[9px] font-bold px-1 rounded bg-bg text-accent leading-tight">
                          {idx + 1}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              onClick={() => setSelected([])}
              disabled={disabled || selected.length === 0}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-line text-ink-muted hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              選択をクリア
            </button>
            <button
              onClick={apply}
              disabled={disabled || selected.length === 0}
              className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-accent text-bg hover:bg-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {selected.length > 0 ? `${selected.length}日を全映画に適用` : '日付を選択してください'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

type Props = {
  movies: EditorMovie[]
  weeks: (Date | null)[][]
  rulesMap: Map<number, ActivityRule>
  daysMap: Map<string, ActivityDay>
  todayStr: string
  disabled: boolean
  expandedIndex: number | null
  onToggleExpand: (index: number) => void
  onToggleDate: (movieIndex: number, date: string) => void
  onSetStartTime: (movieIndex: number, date: string, startTime: string) => void
  onSetMovieTime: (movieIndex: number, startTime: string) => void
  onMoveDate: (movieIndex: number, date: string, dir: -1 | 1) => void
  onRemoveDate: (movieIndex: number, date: string) => void
}

export default function MovieDatesEditor({
  movies,
  weeks,
  rulesMap,
  daysMap,
  todayStr,
  disabled,
  expandedIndex,
  onToggleExpand,
  onToggleDate,
  onSetStartTime,
  onSetMovieTime,
  onMoveDate,
  onRemoveDate,
}: Props) {
  // date → それを候補にしている映画 index の集合（同じ日を複数映画で共有できる）
  const dateUsers = new Map<string, number[]>()
  movies.forEach((m, i) => {
    for (const d of m.dates) {
      const list = dateUsers.get(d.date)
      if (list) list.push(i)
      else dateUsers.set(d.date, [i])
    }
  })

  return (
    <div className="space-y-2.5">
      {movies.map((movie, mi) => {
        const expanded = expandedIndex === mi
        const ordered = movie.dates // 既に priority 順
        return (
          <div key={mi} className="rounded-xl border border-line bg-card overflow-hidden">
            <button
              onClick={() => onToggleExpand(mi)}
              className="w-full flex items-center gap-3 px-3 py-3 text-left min-w-0"
            >
              <span className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg bg-accent/15 text-accent text-xs font-bold tabular-nums">
                {mi + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink truncate">
                  <FilmIcon size={12} className="inline -mt-0.5 mr-1 text-accent" />
                  {movie.title}
                </p>
                <p className="text-[12px] mt-0.5 text-ink-muted">
                  {movie.durationMinutes != null && `${movie.durationMinutes}分 ・ `}
                  候補日 {movie.dates.length}件
                </p>
              </div>
              <span className="shrink-0 text-ink-muted">
                {expanded ? <ChevronUpIcon size={18} /> : <ChevronDownIcon size={18} />}
              </span>
            </button>

            {expanded && (
              <div className="border-t border-line px-3 py-3 space-y-3 bg-bg/30">
                {/* カレンダー：この映画の候補日を選ぶ */}
                <div className="space-y-1.5">
                  <div className="grid grid-cols-5 gap-1.5">
                    {DAY_LABELS.map((label) => (
                      <div key={label} className="text-center text-xs font-medium text-ink-muted py-0.5">
                        {label}
                      </div>
                    ))}
                  </div>
                  {weeks.map((week, wi) => (
                    <div key={wi} className="grid grid-cols-5 gap-1.5">
                      {week.map((date, di) => {
                        if (!date) return <div key={di} className="rounded-lg" />
                        const dateStr = formatDate(date)
                        const isToday = todayStr === dateStr
                        const activity = resolveActivity(dateStr, rulesMap, daysMap)
                        const isActivity = activity.active
                        const users = dateUsers.get(dateStr) ?? []
                        const mineIdx = ordered.findIndex((d) => d.date === dateStr)
                        const isMine = mineIdx >= 0
                        // 他の映画でも候補になっている日（共有可・印だけ付ける）
                        const usedByOther = users.some((u) => u !== mi)
                        const tappable = isActivity && !disabled

                        let cellClass = 'border-line bg-card opacity-40 cursor-not-allowed'
                        let dateClass = 'text-ink-dim'
                        let subClass = 'text-ink-dim'
                        if (isActivity) {
                          if (isMine) {
                            cellClass = 'border-accent-strong bg-accent text-bg'
                            dateClass = 'text-bg'
                            subClass = 'text-bg/80'
                          } else {
                            cellClass = isToday
                              ? 'border-accent/60 bg-accent/10 hover:bg-accent/20'
                              : 'border-line bg-card hover:border-accent/50 hover:bg-card-hover'
                            dateClass = 'text-ink'
                            subClass = 'text-ink-muted'
                          }
                        }

                        const timeLabel = isActivity
                          ? formatTimeRange(activity.start_time, activity.end_time)
                          : ''

                        return (
                          <button
                            key={di}
                            onClick={() => tappable && onToggleDate(mi, dateStr)}
                            disabled={!tappable}
                            aria-pressed={isMine}
                            className={`relative aspect-square rounded-lg border p-1 flex flex-col items-center justify-between text-center transition-colors ${
                              tappable ? 'active:scale-95' : ''
                            } ${cellClass}`}
                          >
                            <span className={`text-sm font-bold leading-none ${dateClass}`}>
                              {date.getDate()}
                            </span>
                            {isActivity ? (
                              <span className={`text-[9px] leading-none ${subClass}`}>
                                {timeLabel || '-'}
                              </span>
                            ) : (
                              <span className={`text-[10px] leading-none ${subClass}`}>休</span>
                            )}
                            {isMine && (
                              <span className="absolute top-0.5 left-0.5 text-[9px] font-bold px-1 rounded bg-bg text-accent leading-tight">
                                {mineIdx + 1}
                              </span>
                            )}
                            {/* 他の映画でも候補になっている印 */}
                            {!isMine && usedByOther && (
                              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent/70" />
                            )}
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </div>

                {/* 候補日リスト（優先順・開始時刻） */}
                {ordered.length === 0 ? (
                  <p className="text-[11px] text-ink-muted inline-flex items-center gap-1">
                    <AlertIcon size={12} className="text-ink-dim" />
                    候補日を1つ以上選んでください（タップした順が優先順）
                  </p>
                ) : (
                  <>
                  <BulkTimeControl
                    label="この映画の全候補日に開始時刻を"
                    disabled={disabled}
                    onApply={(t) => onSetMovieTime(mi, t)}
                  />
                  <ul className="space-y-1.5">
                    {ordered.map((cd, i) => {
                      const startMin = timeStringToMinutes(cd.startTime)
                      const endLabel =
                        movie.durationMinutes != null && startMin != null
                          ? minutesToTimeString(startMin + movie.durationMinutes)
                          : null
                      return (
                        <li
                          key={cd.date}
                          className="flex items-center gap-2 rounded-lg border border-line bg-bg/40 px-2.5 py-2"
                        >
                          <span className="shrink-0 inline-flex items-center justify-center min-w-[2.75rem] px-1 h-6 rounded bg-accent/15 text-accent text-[11px] font-bold">
                            第{i + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-semibold text-ink">{formatDateLabel(cd.date)}</span>
                            {endLabel && (
                              <span className="ml-2 text-[11px] text-ink-muted tabular-nums">
                                〜{endLabel}
                              </span>
                            )}
                          </div>
                          <span className="shrink-0 inline-flex items-center gap-1">
                            <ClockIcon size={13} className="text-ink-dim" />
                            <input
                              type="time"
                              step={300}
                              value={cd.startTime}
                              disabled={disabled}
                              onChange={(e) => onSetStartTime(mi, cd.date, e.target.value)}
                              onClick={openTimePicker}
                              aria-label={`${formatDateLabel(cd.date)}の開始時刻`}
                              className={`px-2 py-1 bg-bg border rounded-lg text-sm text-ink cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent disabled:opacity-50 ${
                                cd.startTime ? 'border-line' : 'border-danger'
                              }`}
                            />
                          </span>
                          <span className="shrink-0 flex flex-col -my-1">
                            <button
                              onClick={() => onMoveDate(mi, cd.date, -1)}
                              disabled={disabled || i === 0}
                              aria-label="優先順を上げる"
                              className="px-1 text-ink-muted hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              <ChevronUpIcon size={15} />
                            </button>
                            <button
                              onClick={() => onMoveDate(mi, cd.date, 1)}
                              disabled={disabled || i === ordered.length - 1}
                              aria-label="優先順を下げる"
                              className="px-1 text-ink-muted hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              <ChevronDownIcon size={15} />
                            </button>
                          </span>
                          <button
                            onClick={() => onRemoveDate(mi, cd.date)}
                            disabled={disabled}
                            aria-label="候補日から外す"
                            className="shrink-0 p-1 rounded-lg text-ink-muted hover:text-danger hover:bg-danger/10 disabled:opacity-40 transition-colors"
                          >
                            <TrashIcon size={14} />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
