import { useEffect, useRef, useState } from 'react'
import { AlertIcon, FilmIcon, GripIcon, TrashIcon } from './icons'
import {
  resolveActivity,
  formatTimeRange,
  rankLabel,
  type ActivityRule,
  type ActivityDay,
  type DatePreference,
  type MovieWish,
} from '../lib/activity'

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

type Props = {
  prefs: DatePreference[] // rank 昇順（希望日）
  movieWishes: MovieWish[] // rank 昇順（映画）
  rulesMap: Map<number, ActivityRule>
  daysMap: Map<string, ActivityDay>
  disabled: boolean
  onReorder: (orderedDates: string[]) => void
  onRemove: (date: string) => Promise<string | null> | void
  onSetStartTime: (date: string, startTime: string) => void
}

export default function RankTimeEditor({
  prefs,
  movieWishes,
  rulesMap,
  daysMap,
  disabled,
  onReorder,
  onRemove,
  onSetStartTime,
}: Props) {
  const [removing, setRemoving] = useState<string | null>(null)

  const [dragDate, setDragDate] = useState<string | null>(null)
  const [dragOrder, setDragOrder] = useState<string[] | null>(null)
  const [dragY, setDragY] = useState(0)
  const itemRefs = useRef(new Map<string, HTMLLIElement>())
  const drag = useRef<{ pointerStart: number } | null>(null)

  const order = dragOrder ?? prefs.map((p) => p.date)
  const byDate = new Map(prefs.map((p) => [p.date, p]))

  useEffect(() => {
    if (!dragDate) return

    const onMove = (e: PointerEvent) => {
      if (!drag.current) return
      e.preventDefault()
      let dy = e.clientY - drag.current.pointerStart
      const cur = order.indexOf(dragDate)

      if (dy < 0 && cur > 0) {
        const h = itemRefs.current.get(order[cur - 1])?.offsetHeight ?? 64
        if (-dy > h / 2) {
          const next = [...order]
          ;[next[cur - 1], next[cur]] = [next[cur], next[cur - 1]]
          setDragOrder(next)
          drag.current.pointerStart -= h
          dy = e.clientY - drag.current.pointerStart
        }
      } else if (dy > 0 && cur < order.length - 1) {
        const h = itemRefs.current.get(order[cur + 1])?.offsetHeight ?? 64
        if (dy > h / 2) {
          const next = [...order]
          ;[next[cur + 1], next[cur]] = [next[cur], next[cur + 1]]
          setDragOrder(next)
          drag.current.pointerStart += h
          dy = e.clientY - drag.current.pointerStart
        }
      }
      setDragY(dy)
    }

    const onUp = () => {
      const committed = order
      drag.current = null
      navigator.vibrate?.(10)
      onReorder(committed)
      setDragDate(null)
      setDragOrder(null)
      setDragY(0)
    }

    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [dragDate, order, onReorder])

  const startDrag = (date: string) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled) return
    e.preventDefault()
    drag.current = { pointerStart: e.clientY }
    setDragDate(date)
    setDragOrder(prefs.map((p) => p.date))
    setDragY(0)
    navigator.vibrate?.(10)
  }

  const handleRemove = async (date: string, label: string) => {
    if (!confirm(`${label} を希望日から外しますか？`)) return
    setRemoving(date)
    await onRemove(date)
    setRemoving(null)
  }

  return (
    <ul className="space-y-2">
      {order.map((date, idx) => {
        const pref = byDate.get(date)
        if (!pref) return null
        const dt = new Date(date + 'T00:00:00')
        const dateLabel = `${dt.getMonth() + 1}/${dt.getDate()}（${DAY_LABELS[dt.getDay()]}）`
        const activity = resolveActivity(date, rulesMap, daysMap)
        const timeLabel = formatTimeRange(activity.start_time, activity.end_time)
        const movie = movieWishes[idx] ?? null
        // 開始時刻は希望日（順位）に紐づく。映画の無い順位でも入力できる。
        const startValue = pref.movie_start_time?.slice(0, 5) ?? ''
        const startMissing = !startValue
        const dragging = dragDate === date
        return (
          <li
            key={date}
            ref={(el) => {
              if (el) itemRefs.current.set(date, el)
              else itemRefs.current.delete(date)
            }}
            style={
              dragging
                ? { transform: `translateY(${dragY}px)`, zIndex: 20, position: 'relative' }
                : undefined
            }
            className={`rounded-xl border bg-card overflow-hidden ${
              dragging ? 'border-accent shadow-lg shadow-black/40 ring-1 ring-accent/40' : 'border-line'
            }`}
          >
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-line bg-bg/40">
              <button
                type="button"
                onPointerDown={startDrag(date)}
                disabled={disabled}
                aria-label="ドラッグして順位を入れ替え"
                title="ドラッグして順位を入れ替え"
                style={{ touchAction: 'none' }}
                className="shrink-0 -ml-1 p-1 flex items-center justify-center text-ink-dim hover:text-ink-muted cursor-grab active:cursor-grabbing disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <GripIcon size={18} />
              </button>
              <span className="shrink-0 inline-flex items-center justify-center min-w-[3.25rem] px-1.5 h-6 rounded bg-accent/15 text-accent text-[11px] font-bold">
                {rankLabel(idx + 1)}
              </span>
              <span className="flex-1 min-w-0 text-sm font-semibold text-ink truncate">
                {dateLabel}
                {timeLabel && (
                  <span className="ml-2 text-[11px] font-normal text-ink-muted">{timeLabel}</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => handleRemove(date, dateLabel)}
                disabled={disabled || removing === date}
                aria-label="希望日から外す"
                title="希望日から外す"
                className="shrink-0 p-1.5 rounded-lg text-ink-muted hover:text-danger hover:bg-danger/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <TrashIcon size={15} />
              </button>
            </div>

            <div className="px-3 py-2.5 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                {movie ? (
                  <span className="inline-flex items-center gap-1 text-sm text-ink min-w-0 max-w-full">
                    <FilmIcon size={13} className="text-accent shrink-0" />
                    <span className="truncate">{movie.movie_title}</span>
                  </span>
                ) : (
                  <p className="text-[11px] text-ink-muted inline-flex items-start gap-1">
                    <AlertIcon size={12} className="text-ink-dim shrink-0 mt-0.5" />
                    映画なし — 上位の映画がすべて当選した場合は破棄されます
                  </p>
                )}
              </div>
              <label className="shrink-0 flex items-center gap-1.5">
                <span className="text-[11px] text-ink-muted">開始</span>
                <input
                  type="time"
                  step={300}
                  value={startValue}
                  disabled={disabled}
                  onChange={(e) => onSetStartTime(date, e.target.value)}
                  aria-label={`第${idx + 1}希望の開始時刻`}
                  className={`px-2 py-1.5 bg-bg border rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent disabled:opacity-50 ${
                    startMissing ? 'border-danger' : 'border-line'
                  }`}
                />
              </label>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
