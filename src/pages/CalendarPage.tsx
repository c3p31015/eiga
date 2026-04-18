import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

type Movie = {
  id: string
  title: string
  description: string | null
}

type Vote = {
  id: string
  user_id: string
  movie_id: string
  date: string
  profiles: { display_name: string } | null
}

type DayVotes = Record<string, Vote[]> // movie_id -> votes

const DAY_LABELS = ['月', '火', '水', '木', '金']

function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// 月の月〜金だけを週ごとにまとめた2次元配列を返す
function getMonthWeeks(year: number, month: number): (Date | null)[][] {
  const firstOfMonth = new Date(year, month, 1)
  const lastOfMonth = new Date(year, month + 1, 0)

  const firstDayOfWeek = firstOfMonth.getDay() // 0=日, 1=月, ...
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
  const { user } = useAuth()
  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [movies, setMovies] = useState<Movie[]>([])
  const [monthVotes, setMonthVotes] = useState<Record<string, DayVotes>>({}) // date -> DayVotes
  const [loading, setLoading] = useState(true)

  const weeks = getMonthWeeks(viewYear, viewMonth)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const firstDay = formatDate(new Date(viewYear, viewMonth, 1))
    const lastDay = formatDate(new Date(viewYear, viewMonth + 1, 0))

    const [moviesRes, votesRes] = await Promise.all([
      supabase.from('movies').select('id, title, description').order('title'),
      supabase
        .from('votes')
        .select('*, profiles(display_name)')
        .gte('date', firstDay)
        .lte('date', lastDay),
    ])

    setMovies(moviesRes.data ?? [])

    const grouped: Record<string, DayVotes> = {}
    for (const vote of (votesRes.data as Vote[]) ?? []) {
      if (!grouped[vote.date]) grouped[vote.date] = {}
      if (!grouped[vote.date][vote.movie_id]) grouped[vote.date][vote.movie_id] = []
      grouped[vote.date][vote.movie_id].push(vote)
    }
    setMonthVotes(grouped)
    setLoading(false)
  }, [viewYear, viewMonth])

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

  const toggleVote = async (movieId: string) => {
    if (!selectedDate || !user) return
    const dayVotes = monthVotes[selectedDate]?.[movieId] ?? []
    const myVote = dayVotes.find((v) => v.user_id === user.id)

    if (myVote) {
      await supabase.from('votes').delete().eq('id', myVote.id)
    } else {
      await supabase.from('votes').insert({
        user_id: user.id,
        movie_id: movieId,
        date: selectedDate,
      })
    }
    fetchData()
  }

  const getTopMovie = (dateStr: string): { title: string; count: number } | null => {
    const dayVotes = monthVotes[dateStr]
    if (!dayVotes) return null
    let maxCount = 0
    let topMovieId = ''
    for (const [movieId, votes] of Object.entries(dayVotes)) {
      if (votes.length > maxCount) {
        maxCount = votes.length
        topMovieId = movieId
      }
    }
    if (maxCount === 0) return null
    const movie = movies.find((m) => m.id === topMovieId)
    return movie ? { title: movie.title, count: maxCount } : null
  }

  const selectedDayVotes = selectedDate ? monthVotes[selectedDate] ?? {} : {}
  const todayStr = formatDate(today)

  return (
    <div className="space-y-6">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-800">
          {viewYear}年{viewMonth + 1}月
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={prevMonth}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
          >
            &larr; 前月
          </button>
          <button
            onClick={thisMonth}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
          >
            今月
          </button>
          <button
            onClick={nextMonth}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
          >
            翌月 &rarr;
          </button>
        </div>
      </div>

      {/* Calendar grid */}
      {loading ? (
        <p className="text-gray-500 text-sm">読み込み中...</p>
      ) : (
        <div className="space-y-2">
          {/* Weekday header */}
          <div className="grid grid-cols-5 gap-2">
            {DAY_LABELS.map((label) => (
              <div key={label} className="text-center text-sm font-medium text-gray-500 py-1">
                {label}
              </div>
            ))}
          </div>
          {/* Weeks */}
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-5 gap-2">
              {week.map((date, di) => {
                if (!date) {
                  return <div key={di} className="rounded-xl border-2 border-transparent p-3" />
                }
                const dateStr = formatDate(date)
                const isSelected = selectedDate === dateStr
                const isToday = todayStr === dateStr
                const topMovie = getTopMovie(dateStr)
                const totalVotes = Object.values(monthVotes[dateStr] ?? {}).reduce(
                  (sum, votes) => sum + votes.length,
                  0
                )

                return (
                  <button
                    key={di}
                    onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                    className={`rounded-xl border-2 p-3 text-left transition-all min-h-[88px] ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50'
                        : isToday
                          ? 'border-blue-200 bg-white hover:border-blue-300'
                          : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="mb-1">
                      <span
                        className={`text-base font-bold ${isToday ? 'text-blue-600' : 'text-gray-800'}`}
                      >
                        {date.getDate()}
                      </span>
                    </div>
                    {topMovie ? (
                      <div className="text-xs">
                        <p className="font-medium text-gray-700 truncate">{topMovie.title}</p>
                        <p className="text-gray-400 mt-0.5">
                          {topMovie.count}票 (全{totalVotes}票)
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400">投票なし</p>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {/* Voting panel */}
      {selectedDate && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4">
            {(() => {
              const d = new Date(selectedDate + 'T00:00:00')
              return `${d.getMonth() + 1}月${d.getDate()}日（${DAY_LABELS[d.getDay() - 1]}）`
            })()}
            の投票
          </h3>

          {movies.length === 0 ? (
            <p className="text-gray-500 text-sm">
              映画が登録されていません。「映画一覧」ページから追加してください。
            </p>
          ) : (
            <div className="space-y-2">
              {movies
                .map((movie) => {
                  const votes = selectedDayVotes[movie.id] ?? []
                  const hasVoted = votes.some((v) => v.user_id === user!.id)
                  return { movie, votes, hasVoted }
                })
                .sort((a, b) => b.votes.length - a.votes.length)
                .map(({ movie, votes, hasVoted }) => (
                  <div
                    key={movie.id}
                    className={`flex items-center justify-between rounded-lg border px-4 py-3 transition-colors ${
                      hasVoted ? 'border-blue-200 bg-blue-50' : 'border-gray-200'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-gray-800">{movie.title}</span>
                      {movie.description && (
                        <span className="ml-2 text-sm text-gray-500">{movie.description}</span>
                      )}
                      {votes.length > 0 && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {votes.map((v) => v.profiles?.display_name ?? '?').join('、')}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 ml-4">
                      <span
                        className={`text-sm font-bold ${votes.length > 0 ? 'text-blue-600' : 'text-gray-400'}`}
                      >
                        {votes.length}票
                      </span>
                      <button
                        onClick={() => toggleVote(movie.id)}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                          hasVoted
                            ? 'bg-blue-600 text-white hover:bg-blue-700'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {hasVoted ? '投票済み' : '投票する'}
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
