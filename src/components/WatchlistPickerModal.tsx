import { useState, useEffect, useId } from 'react'
import { type WatchlistItem } from '../lib/watchlist'
import { BookmarkIcon, CheckIcon, FilmIcon } from './icons'

type Props = {
  items: WatchlistItem[]
  onClose: () => void
  onConfirm: (selected: WatchlistItem[]) => void
}

export default function WatchlistPickerModal({ items, onClose, onConfirm }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const titleId = useId()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleConfirm = () => {
    onConfirm(items.filter((it) => selectedIds.has(it.id)))
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 px-4 py-6 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-line bg-card shadow-xl flex flex-col max-h-[80vh]"
        style={{ overscrollBehavior: 'contain' }}
      >
        <div className="flex items-start justify-between gap-3 p-4 border-b border-line">
          <div>
            <h2 id={titleId} className="text-base font-bold text-ink font-display inline-flex items-center gap-1.5">
              <BookmarkIcon size={15} className="text-accent" />
              リストから映画を追加
            </h2>
            <p className="text-[11px] text-ink-muted mt-1">
              追加したい映画を選んでください。複数選択できます。
            </p>
          </div>
          <button
            onClick={onClose}
            className="px-2 py-1 text-xs rounded-md text-ink-muted hover:text-ink hover:bg-bg transition-colors shrink-0"
          >
            閉じる
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {items.length === 0 ? (
            <p className="text-sm text-ink-muted text-center py-8">
              観たい映画リストが空です。マイページから映画を追加できます。
            </p>
          ) : (
            items.map((item) => {
              const selected = selectedIds.has(item.id)
              return (
                <button
                  key={item.id}
                  onClick={() => toggle(item.id)}
                  aria-pressed={selected}
                  className={`w-full text-left rounded-xl border px-3 py-2.5 flex items-center gap-3 transition-colors ${
                    selected
                      ? 'border-accent bg-accent/10'
                      : 'border-line bg-bg hover:border-accent/40'
                  }`}
                >
                  <span
                    className={`shrink-0 w-5 h-5 rounded border flex items-center justify-center ${
                      selected ? 'bg-accent border-accent text-bg' : 'border-line text-transparent'
                    }`}
                  >
                    <CheckIcon size={13} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink truncate inline-flex items-center gap-1">
                      <FilmIcon size={12} className="text-accent shrink-0" />
                      {item.title}
                    </p>
                    <p className="text-[12px] text-ink-muted truncate">
                      {item.duration_minutes != null && `${item.duration_minutes}分`}
                      {item.genre && `${item.duration_minutes != null ? ' ・ ' : ''}${item.genre}`}
                      {item.has_gore && <span className="text-danger"> ・ グロ描写あり</span>}
                    </p>
                  </div>
                </button>
              )
            })
          )}
        </div>

        <div className="p-3 border-t border-line">
          <button
            onClick={handleConfirm}
            disabled={selectedIds.size === 0}
            className="w-full px-4 py-2.5 bg-accent text-bg text-sm font-semibold rounded-lg hover:bg-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {selectedIds.size > 0 ? `${selectedIds.size}件を追加` : '映画を選択してください'}
          </button>
        </div>
      </div>
    </div>
  )
}
