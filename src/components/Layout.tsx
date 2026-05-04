import { NavLink, Outlet, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { CalendarIcon, FilmIcon, UsersIcon, LogOutIcon } from './icons'

export default function Layout() {
  const { user, profile, signOut } = useAuth()

  const navItems = [{ to: '/', label: 'カレンダー', icon: CalendarIcon, end: true }]
  if (user) {
    navItems.push({ to: '/apply', label: '申請', icon: FilmIcon, end: false })
  }
  if (profile?.is_admin) {
    navItems.push({ to: '/admin', label: '管理', icon: UsersIcon, end: false })
  }

  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="sticky top-0 z-20 bg-bg/90 backdrop-blur border-b border-line">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-base font-bold tracking-wide">
            <span className="text-accent">●</span>{' '}
            <span className="text-ink">映画鑑賞サークル</span>
          </h1>
          <div className="flex items-center gap-3">
            {user ? (
              <>
                <span className="text-sm text-ink-muted truncate max-w-[8rem]">
                  {profile?.display_name}
                </span>
                <button
                  onClick={signOut}
                  aria-label="ログアウト"
                  className="p-2 -mr-2 text-ink-muted hover:text-ink transition-colors"
                >
                  <LogOutIcon />
                </button>
              </>
            ) : (
              <Link
                to="/login"
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent text-bg hover:bg-accent-strong transition-colors"
              >
                ログイン
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 pt-5 pb-28">
        <Outlet />
      </main>

      <nav
        className="fixed bottom-0 left-0 right-0 z-20 bg-card/95 backdrop-blur border-t border-line"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="max-w-3xl mx-auto grid" style={{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }}>
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors ${
                  isActive ? 'text-accent' : 'text-ink-muted hover:text-ink'
                }`
              }
            >
              <Icon size={22} />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
