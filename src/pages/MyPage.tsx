import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import PasswordChangeModal from '../components/PasswordChangeModal'
import WatchlistSection from '../components/WatchlistSection'
import { fetchWatchlist, type WatchlistItem } from '../lib/watchlist'
import {
  AlertIcon,
  ChevronRightIcon,
  FilmIcon,
  PinIcon,
  UsersIcon,
} from '../components/icons'
import {
  type ActivityPeriod,
  type ActivityAssignment,
  type PeriodMovieDate,
  type MovieWish,
  isPeriodOpen,
  getJstToday,
} from '../lib/activity'

const FULL_DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}/${d.getDate()}（${FULL_DAY_LABELS[d.getDay()]}）`
}

type CurrentMonth = {
  year: number
  month: number // 1-12
  period: ActivityPeriod | null
  dateCount: number
  movieCount: number
  submitted: boolean
}

export default function MyPage() {
  const { user } = useAuth()

  const [loading, setLoading] = useState(true)
  const [current, setCurrent] = useState<CurrentMonth | null>(null)
  const [hosting, setHosting] = useState<ActivityAssignment[]>([])
  const [attending, setAttending] = useState<ActivityAssignment[]>([])
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([])
  const [passwordOpen, setPasswordOpen] = useState(false)

  const fetchAll = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const today = getJstToday()
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1

    // 今月の申請状況
    const { data: periodIdData } = await supabase.rpc('ensure_period', {
      p_year: year,
      p_month: month,
    })
    const periodId = (periodIdData as string | null) ?? null

    const [periodRes, datesRes, wishesRes, assignRes, goingRes, list] = await Promise.all([
      periodId
        ? supabase.from('activity_periods').select('*').eq('id', periodId).maybeSingle()
        : Promise.resolve({ data: null }),
      periodId
        ? supabase
            .from('period_movie_dates')
            .select('*')
            .eq('period_id', periodId)
            .eq('user_id', user.id)
        : Promise.resolve({ data: [] }),
      periodId
        ? supabase
            .from('period_movie_wishes')
            .select('*')
            .eq('period_id', periodId)
            .eq('user_id', user.id)
        : Promise.resolve({ data: [] }),
      // 今後の確定上映（主催 / 参加の両方に使う）
      supabase
        .from('activity_assignments')
        .select('*, profiles:host_user_id(display_name)')
        .gte('date', today)
        .order('date', { ascending: true }),
      // 自分が「参加」表明した今後の日
      supabase
        .from('activity_attendances')
        .select('date')
        .eq('user_id', user.id)
        .eq('status', 'going')
        .gte('date', today),
      fetchWatchlist(user.id).catch(() => [] as WatchlistItem[]),
    ])

    const period = (periodRes.data as ActivityPeriod | null) ?? null
    const dates = (datesRes.data as PeriodMovieDate[]) ?? []
    const wishes = (wishesRes.data as MovieWish[]) ?? []
    const submitted =
      wishes.length > 0 &&
      wishes.every((w) => !!w.submitted_at) &&
      dates.length > 0 &&
      dates.every((d) => !!d.submitted_at)

    setCurrent({
      year,
      month,
      period,
      dateCount: dates.length,
      movieCount: wishes.length,
      submitted,
    })

    const assignments = (assignRes.data as unknown as ActivityAssignment[]) ?? []
    setHosting(assignments.filter((a) => a.host_user_id === user.id))

    const goingDates = new Set(((goingRes.data as { date: string }[]) ?? []).map((r) => r.date))
    setAttending(assignments.filter((a) => goingDates.has(a.date)))

    setWatchlist(list)
    setLoading(false)
  }, [user])

  useEffect(() => {
    void Promise.resolve().then(fetchAll)
  }, [fetchAll])

  if (!user) return null

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] font-semibold text-accent uppercase tracking-wider">マイページ</p>
      </div>

      {/* プロフィール */}
      <ProfileSection onPasswordClick={() => setPasswordOpen(true)} />

      {/* 申請状況 */}
      <ApplicationStatusSection loading={loading} current={current} />

      {/* 主催予定 */}
      <UpcomingSection
        title="主催予定の上映"
        icon={<PinIcon size={15} className="text-accent" />}
        loading={loading}
        assignments={hosting}
        emptyText="確定した主催予定はありません"
        showHost={false}
      />

      {/* 参加予定 */}
      <UpcomingSection
        title="参加予定の上映"
        icon={<UsersIcon size={15} className="text-accent" />}
        loading={loading}
        assignments={attending}
        emptyText="参加表明した今後の上映はありません（カレンダーから参加を表明できます）"
        showHost
      />

      {/* 観たい映画リスト */}
      {loading ? (
        <div className="h-24 rounded-xl bg-card animate-pulse" aria-hidden="true" />
      ) : (
        <WatchlistSection userId={user.id} items={watchlist} onChange={setWatchlist} />
      )}

      {passwordOpen && <PasswordChangeModal onClose={() => setPasswordOpen(false)} />}
    </div>
  )
}

function ProfileSection({ onPasswordClick }: { onPasswordClick: () => void }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-bold text-ink font-display">プロフィール</h3>
      <div className="rounded-xl border border-line bg-card p-4">
        <button
          onClick={onPasswordClick}
          className="px-3 py-2 text-xs font-semibold rounded-lg border border-line text-ink-muted hover:text-ink hover:border-accent/40 transition-colors"
        >
          パスワードを変更
        </button>
      </div>
    </section>
  )
}

function ApplicationStatusSection({
  loading,
  current,
}: {
  loading: boolean
  current: CurrentMonth | null
}) {
  if (loading) {
    return <div className="h-20 rounded-xl bg-card animate-pulse" aria-hidden="true" />
  }
  if (!current || !current.period) return null

  const { year, month, period, dateCount, movieCount, submitted } = current
  const open = isPeriodOpen(period)
  const locked = !!period.locked_at

  let badge: { text: string; cls: string }
  if (submitted) {
    badge = { text: '提出済み', cls: 'text-success bg-success-bg/60 border-success/30' }
  } else if (locked) {
    badge = { text: '確定済み', cls: 'text-ink-muted bg-card border-line' }
  } else if (open) {
    badge = { text: '未提出', cls: 'text-danger bg-danger-bg/60 border-danger/30' }
  } else {
    badge = { text: '締切', cls: 'text-ink-muted bg-card border-line' }
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-bold text-ink font-display">今月の申請状況</h3>
      <div className="rounded-xl border border-line bg-card p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-ink tabular-nums">
            {year}年{month}月
          </span>
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${badge.cls}`}>
            {badge.text}
          </span>
        </div>
        <p className="text-[12px] text-ink-muted tabular-nums">
          映画 {movieCount}本 ／ 候補日 {dateCount}件
        </p>
        {open && !submitted && (
          <p className="text-[11px] text-danger inline-flex items-center gap-1">
            <AlertIcon size={12} />
            まだ提出していません。締切前に提出してください。
          </p>
        )}
        {open && (
          <Link
            to={`/apply?year=${year}&month=${month}`}
            className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline"
          >
            申請ページを開く
            <ChevronRightIcon size={15} />
          </Link>
        )}
      </div>
    </section>
  )
}

function UpcomingSection({
  title,
  icon,
  loading,
  assignments,
  emptyText,
  showHost,
}: {
  title: string
  icon: ReactNode
  loading: boolean
  assignments: ActivityAssignment[]
  emptyText: string
  showHost: boolean
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-bold text-ink font-display inline-flex items-center gap-1.5">
        {icon}
        {title}
      </h3>
      {loading ? (
        <div className="h-16 rounded-xl bg-card animate-pulse" aria-hidden="true" />
      ) : assignments.length === 0 ? (
        <p className="text-[12px] text-ink-muted rounded-xl border border-line bg-card px-3 py-3">
          {emptyText}
        </p>
      ) : (
        <ul className="space-y-2">
          {assignments.map((a) => (
            <li
              key={a.date}
              className="rounded-xl border border-line bg-card px-3 py-2.5 flex items-center gap-3"
            >
              <div className="shrink-0 text-center min-w-[4rem]">
                <span className="block text-sm font-bold text-ink tabular-nums">
                  {formatShortDate(a.date)}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                {a.movie_title ? (
                  <p className="text-sm font-semibold text-ink truncate inline-flex items-center gap-1">
                    <FilmIcon size={12} className="text-accent shrink-0" />
                    {a.movie_title}
                  </p>
                ) : (
                  <p className="text-sm text-ink-muted">作品未定</p>
                )}
                <p className="text-[11px] text-ink-muted truncate">
                  {a.movie_start_time && `開始 ${a.movie_start_time.slice(0, 5)}`}
                  {showHost && a.profiles?.display_name && (
                    <span>
                      {a.movie_start_time ? ' ・ ' : ''}主催 {a.profiles.display_name}
                    </span>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
