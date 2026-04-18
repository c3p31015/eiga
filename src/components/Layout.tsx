import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function Layout() {
  const { profile, signOut } = useAuth()

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-800">映画鑑賞サークル</h1>
          <div className="flex items-center gap-4">
            <nav className="flex gap-1">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    isActive ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                  }`
                }
              >
                カレンダー
              </NavLink>
              <NavLink
                to="/movies"
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    isActive ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                  }`
                }
              >
                映画一覧
              </NavLink>
              {profile?.is_admin && (
                <NavLink
                  to="/admin"
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      isActive ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                    }`
                  }
                >
                  管理
                </NavLink>
              )}
            </nav>
            <div className="flex items-center gap-2 pl-4 border-l border-gray-200">
              <span className="text-sm text-gray-600">{profile?.display_name}</span>
              <button
                onClick={signOut}
                className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
              >
                ログアウト
              </button>
            </div>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
