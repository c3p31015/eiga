import { useState, useEffect, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

type Movie = {
  id: string
  title: string
  description: string | null
  added_by: string
  created_at: string
  profiles: { display_name: string } | null
}

export default function MoviesPage() {
  const { user } = useAuth()
  const [movies, setMovies] = useState<Movie[]>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const fetchMovies = async () => {
    const { data } = await supabase
      .from('movies')
      .select('*, profiles(display_name)')
      .order('created_at', { ascending: false })
    setMovies((data as Movie[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    fetchMovies()
  }, [])

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setSubmitting(true)
    await supabase.from('movies').insert({
      title: title.trim(),
      description: description.trim() || null,
      added_by: user!.id,
    })
    setTitle('')
    setDescription('')
    setSubmitting(false)
    fetchMovies()
  }

  const handleDelete = async (movieId: string) => {
    if (!confirm('この映画を削除しますか？')) return
    await supabase.from('movies').delete().eq('id', movieId)
    fetchMovies()
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-800">映画を追加</h2>

      <form onSubmit={handleAdd} className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
            映画タイトル
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="例: 千と千尋の神隠し"
          />
        </div>
        <div>
          <label htmlFor="desc" className="block text-sm font-medium text-gray-700 mb-1">
            メモ（任意）
          </label>
          <input
            id="desc"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="例: ジブリ作品、2時間5分"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {submitting ? '追加中...' : '追加する'}
        </button>
      </form>

      <h2 className="text-xl font-bold text-gray-800">映画一覧</h2>

      {loading ? (
        <p className="text-gray-500 text-sm">読み込み中...</p>
      ) : movies.length === 0 ? (
        <p className="text-gray-500 text-sm bg-white rounded-xl border border-gray-200 p-6">
          まだ映画が登録されていません。上のフォームから追加してください。
        </p>
      ) : (
        <div className="space-y-2">
          {movies.map((movie) => (
            <div
              key={movie.id}
              className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex items-center justify-between"
            >
              <div>
                <span className="font-medium text-gray-800">{movie.title}</span>
                {movie.description && (
                  <span className="ml-2 text-sm text-gray-500">{movie.description}</span>
                )}
                <span className="ml-3 text-xs text-gray-400">
                  追加: {movie.profiles?.display_name ?? '不明'}
                </span>
              </div>
              {movie.added_by === user?.id && (
                <button
                  onClick={() => handleDelete(movie.id)}
                  className="text-sm text-red-500 hover:text-red-700 transition-colors"
                >
                  削除
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
