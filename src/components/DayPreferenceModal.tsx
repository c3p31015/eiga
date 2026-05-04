import { useEffect, useState } from 'react'
import {
  CloseIcon,
  CheckIcon,
  ClockIcon,
  PinIcon,
  FilmIcon,
  UsersIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  PlusIcon,
  TrashIcon,
  LinkIcon,
} from './icons'
import {
  formatTimeRange,
  rankLabel,
  type ActivityAssignment,
  type ActivityPeriod,
  type Attendance,
  type AttendanceStatus,
  type DatePreference,
} from '../lib/activity'
import HostMovieEditor from './HostMovieEditor'

type Props = {
  // 'view' = 活動日確認ページ用 (Assignment + Attendance のみ)
  // 'apply' = 活動申請ページ用 (Preference 編集のみ)
  mode: 'view' | 'apply'
  dateStr: string
  currentUserId: string | null
  period: ActivityPeriod | null
  activityStart: string | null
  activityEnd: string | null
  activityRoom: string | null
  // 自分の希望リスト（rank昇順）
  myPreferences: DatePreference[]
  // この日付を希望している全ユーザー（rank問わず）
  preferencesForDate: DatePreference[]
  // 確定済みの場合の割り当て
  assignment: ActivityAssignment | null
  hostName: string | null
  attendances: Attendance[]
  onSavePreferences: (dates: string[]) => Promise<string | null>
  onAttendanceChange: (status: AttendanceStatus | null) => Promise<string | null>
  onAssignmentSaved: () => void
  onClose: () => void
}

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

export default function DayPreferenceModal({
  mode,
  dateStr,
  currentUserId,
  period,
  activityStart,
  activityEnd,
  activityRoom,
  myPreferences,
  preferencesForDate,
  assignment,
  hostName,
  attendances,
  onSavePreferences,
  onAttendanceChange,
  onAssignmentSaved,
  onClose,
}: Props) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [attendanceBusy, setAttendanceBusy] = useState<AttendanceStatus | 'clear' | null>(null)

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

  const d = new Date(dateStr + 'T00:00:00')
  const heading = `${d.getMonth() + 1}月${d.getDate()}日（${DAY_LABELS[d.getDay()]}）`
  const timeLabel = formatTimeRange(activityStart, activityEnd)

  const myRankForDate = myPreferences.find((p) => p.date === dateStr)?.rank ?? null
  const periodLocked = !!period?.locked_at
  const periodOpen =
    !!period && !period.locked_at && new Date(period.deadline_at).getTime() > Date.now()

  const otherPrefsForDate = preferencesForDate.filter((p) => p.user_id !== currentUserId)

  const handleSave = async (newDates: string[]) => {
    setError(null)
    setBusy(true)
    const err = await onSavePreferences(newDates)
    setBusy(false)
    if (err) setError(err)
  }

  const addThisDate = () => {
    const ordered = myPreferences.map((p) => p.date)
    if (!ordered.includes(dateStr)) ordered.push(dateStr)
    handleSave(ordered)
  }
  const removeThisDate = () => {
    const ordered = myPreferences.map((p) => p.date).filter((dt) => dt !== dateStr)
    handleSave(ordered)
  }
  const moveRank = (date: string, direction: -1 | 1) => {
    const ordered = myPreferences.map((p) => p.date)
    const idx = ordered.indexOf(date)
    if (idx < 0) return
    const newIdx = idx + direction
    if (newIdx < 0 || newIdx >= ordered.length) return
    ;[ordered[idx], ordered[newIdx]] = [ordered[newIdx], ordered[idx]]
    handleSave(ordered)
  }

  const myAttendance = attendances.find((a) => a.user_id === currentUserId)
  const goingAttendees = attendances.filter((a) => a.status === 'going')
  const notGoingAttendees = attendances.filter((a) => a.status === 'not_going')

  const handleAttendance = async (next: AttendanceStatus) => {
    setError(null)
    const target = myAttendance?.status === next ? null : next
    setAttendanceBusy(target ?? 'clear')
    const err = await onAttendanceChange(target)
    if (err) setError(err)
    setAttendanceBusy(null)
  }

  return (
    <div className="fixed inset-0 z-30 flex items-stretch justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-3xl bg-bg flex flex-col shadow-2xl sm:my-8 sm:rounded-2xl sm:max-h-[calc(100vh-4rem)] sm:border sm:border-line">
        <div className="sticky top-0 flex items-center justify-between px-5 py-4 border-b border-line bg-bg">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-ink">{heading}</h3>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
              {timeLabel && (
                <p className="inline-flex items-center gap-1 text-xs font-medium text-accent">
                  <ClockIcon size={13} />
                  {timeLabel}
                </p>
              )}
              {activityRoom && (
                <p className="inline-flex items-center gap-1 text-xs font-medium text-accent">
                  <PinIcon size={13} />
                  {activityRoom}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="閉じる"
            className="p-2 -mr-2 text-ink-muted hover:text-ink transition-colors"
          >
            <CloseIcon />
          </button>
        </div>

        <div
          className="flex-1 overflow-y-auto px-5 py-4 space-y-3"
          style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        >
          {error && (
            <p className="text-sm text-danger bg-danger-bg/60 border border-danger/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {mode === 'view' && periodLocked && (
            <AssignmentSection
              assignment={assignment}
              hostName={hostName}
              isHost={!!currentUserId && assignment?.host_user_id === currentUserId}
              onAssignmentSaved={onAssignmentSaved}
            />
          )}

          {mode === 'view' && (periodLocked || (assignment && assignment.host_user_id)) && (
            <AttendanceSection
              isAuthenticated={!!currentUserId}
              myStatus={myAttendance?.status ?? null}
              going={goingAttendees}
              notGoing={notGoingAttendees}
              busy={attendanceBusy}
              onChange={handleAttendance}
            />
          )}

          {mode === 'view' && !periodLocked && (
            <div className="py-8 text-center space-y-2">
              <p className="text-sm text-ink-muted">
                希望提出受付中です。<br />
                「申請」タブから希望日を提出してください。
              </p>
            </div>
          )}

          {mode === 'apply' && !periodLocked && (
            <PreferenceSection
              periodOpen={periodOpen}
              myRankForDate={myRankForDate}
              myPreferences={myPreferences}
              othersForDateCount={otherPrefsForDate.length}
              othersForDateNames={otherPrefsForDate
                .map((p) => p.profiles?.display_name ?? '?')
                .filter((n, i, a) => a.indexOf(n) === i)}
              busy={busy}
              onAdd={addThisDate}
              onRemove={removeThisDate}
              onMove={moveRank}
            />
          )}

          {mode === 'apply' && periodLocked && (
            <div className="py-8 text-center space-y-2">
              <p className="text-sm text-ink-muted">
                この月の申請は集計済みです。<br />
                確定した活動日は「カレンダー」タブで確認できます。
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function AssignmentSection({
  assignment,
  hostName,
  isHost,
  onAssignmentSaved,
}: {
  assignment: ActivityAssignment | null
  hostName: string | null
  isHost: boolean
  onAssignmentSaved: () => void
}) {
  if (!assignment) {
    return (
      <div className="py-8 text-center space-y-2">
        <p className="text-sm text-ink-muted">
          この日の希望者がいなかったため、活動はありません。
        </p>
      </div>
    )
  }
  if (!assignment.host_user_id) {
    return (
      <div className="py-6 text-center space-y-2">
        <p className="text-sm text-ink-muted">主催者が割り当てられていません</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-accent/30 bg-accent/5 px-4 py-3">
        <p className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-1">
          主催者
        </p>
        <p className="text-base font-bold text-ink">{hostName ?? '不明'}</p>
      </div>

      {assignment.movie_title ? (
        <div className="space-y-3">
          <div className="flex items-center gap-1.5">
            <FilmIcon size={14} className="text-accent" />
            <span className="text-[11px] font-semibold text-accent uppercase tracking-wider">
              上映作品
            </span>
          </div>
          <div className="bg-card border border-line rounded-xl overflow-hidden">
            {assignment.movie_poster_url && (
              <img
                src={assignment.movie_poster_url}
                alt={assignment.movie_title}
                className="w-full max-h-80 object-contain bg-black/20"
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.display = 'none'
                }}
              />
            )}
            <div className="px-4 py-3 space-y-2">
              <h4 className="text-xl font-bold text-ink leading-tight break-words">
                {assignment.movie_title}
              </h4>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
                {assignment.movie_genre && (
                  <span className="inline-flex items-center gap-0.5">
                    {assignment.movie_genre}
                  </span>
                )}
                {assignment.movie_duration_minutes !== null && (
                  <span className="inline-flex items-center gap-0.5">
                    <ClockIcon size={11} />
                    {assignment.movie_duration_minutes}分
                  </span>
                )}
                {assignment.movie_watch_url && (
                  <a
                    href={assignment.movie_watch_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-accent hover:text-accent-strong"
                  >
                    <LinkIcon size={11} />
                    視聴URL
                  </a>
                )}
              </div>
              {assignment.movie_description && (
                <p className="text-sm text-ink-muted whitespace-pre-wrap">
                  {assignment.movie_description}
                </p>
              )}
            </div>
          </div>
        </div>
      ) : (
        !isHost && (
          <p className="text-sm text-ink-muted bg-card border border-line rounded-xl px-4 py-3">
            上映作品はまだ決まっていません
          </p>
        )
      )}

      {isHost && <HostMovieEditor assignment={assignment} onSaved={onAssignmentSaved} />}
    </div>
  )
}

function PreferenceSection({
  periodOpen,
  myRankForDate,
  myPreferences,
  othersForDateCount,
  othersForDateNames,
  busy,
  onAdd,
  onRemove,
  onMove,
}: {
  periodOpen: boolean
  myRankForDate: number | null
  myPreferences: DatePreference[]
  othersForDateCount: number
  othersForDateNames: string[]
  busy: boolean
  onAdd: () => void
  onRemove: () => void
  onMove: (date: string, direction: -1 | 1) => void
}) {
  if (!periodOpen) {
    return (
      <div className="py-8 text-center space-y-2">
        <p className="text-sm text-ink-muted">
          希望提出は締め切られました。<br />
          まもなく主催者が確定します。
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-card px-4 py-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">この日の希望</p>
            <p className="text-[11px] text-ink-muted mt-0.5">
              {myRankForDate !== null
                ? `あなたの${rankLabel(myRankForDate)}`
                : 'まだ希望日に追加されていません'}
            </p>
          </div>
          {myRankForDate !== null ? (
            <button
              onClick={onRemove}
              disabled={busy}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20 disabled:opacity-60 transition-colors"
            >
              <TrashIcon size={13} />
              希望から外す
            </button>
          ) : (
            <button
              onClick={onAdd}
              disabled={busy}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent text-bg hover:bg-accent-strong disabled:opacity-60 transition-colors"
            >
              <PlusIcon size={13} />
              希望日に追加
            </button>
          )}
        </div>

        <div className="text-[11px] text-ink-muted">
          <span className="inline-flex items-center gap-1">
            <UsersIcon size={11} />
            {othersForDateCount > 0
              ? `他${othersForDateCount}人が希望: ${othersForDateNames.join('、')}`
              : 'まだ他に希望者はいません'}
          </span>
        </div>
      </div>

      {myPreferences.length > 0 && (
        <div className="rounded-xl border border-line bg-card px-4 py-3 space-y-2">
          <p className="text-sm font-semibold text-ink mb-1">あなたの希望順位</p>
          <p className="text-[11px] text-ink-muted -mt-1 mb-2">
            上位ほど優先されます。↑↓で順位を入れ替え
          </p>
          <ul className="space-y-1.5">
            {myPreferences.map((pref, idx) => {
              const dt = new Date(pref.date + 'T00:00:00')
              const label = `${dt.getMonth() + 1}月${dt.getDate()}日（${DAY_LABELS[dt.getDay()]}）`
              return (
                <li
                  key={pref.id}
                  className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-bg border border-line"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="shrink-0 text-[11px] font-bold text-accent w-12">
                      {rankLabel(pref.rank)}
                    </span>
                    <span className="text-sm text-ink truncate">{label}</span>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={() => onMove(pref.date, -1)}
                      disabled={busy || idx === 0}
                      aria-label="順位を上げる"
                      className="p-1.5 rounded text-ink-muted hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronUpIcon size={14} />
                    </button>
                    <button
                      onClick={() => onMove(pref.date, 1)}
                      disabled={busy || idx === myPreferences.length - 1}
                      aria-label="順位を下げる"
                      className="p-1.5 rounded text-ink-muted hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronDownIcon size={14} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

function AttendanceSection({
  isAuthenticated,
  myStatus,
  going,
  notGoing,
  busy,
  onChange,
}: {
  isAuthenticated: boolean
  myStatus: AttendanceStatus | null
  going: Attendance[]
  notGoing: Attendance[]
  busy: AttendanceStatus | 'clear' | null
  onChange: (status: AttendanceStatus) => void
}) {
  const isGoingActive = myStatus === 'going'
  const isNotGoingActive = myStatus === 'not_going'

  return (
    <div className="rounded-xl border border-line bg-card px-4 py-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
          <UsersIcon size={14} />
          参加メンバー
          <span className="text-ink-muted font-normal">({going.length}人)</span>
        </span>
        {isAuthenticated && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onChange('going')}
              disabled={busy !== null}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors disabled:opacity-60 ${
                isGoingActive
                  ? 'bg-accent text-bg hover:bg-accent-strong'
                  : 'bg-card-hover text-ink border border-line hover:border-accent/50'
              }`}
            >
              {isGoingActive && <CheckIcon size={13} />}
              参加
            </button>
            <button
              onClick={() => onChange('not_going')}
              disabled={busy !== null}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors disabled:opacity-60 ${
                isNotGoingActive
                  ? 'bg-ink-muted text-bg'
                  : 'bg-card-hover text-ink-muted border border-line hover:border-ink-muted/60'
              }`}
            >
              {isNotGoingActive && <CheckIcon size={13} />}
              不参加
            </button>
          </div>
        )}
      </div>

      {going.length > 0 ? (
        <p className="text-xs text-ink-muted">
          {going.map((a) => a.profiles?.display_name ?? '?').join('、')}
        </p>
      ) : (
        <p className="text-xs text-ink-dim">まだ参加表明はありません</p>
      )}

      {notGoing.length > 0 && (
        <p className="text-[11px] text-ink-dim">
          不参加: {notGoing.map((a) => a.profiles?.display_name ?? '?').join('、')}
        </p>
      )}
    </div>
  )
}
