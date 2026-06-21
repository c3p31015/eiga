import { NavLink, Outlet, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { CalendarIcon, FilmIcon, UsersIcon, UserIcon, LogOutIcon } from './icons'

export default function Layout() {
  const { user, profile, signOut } = useAuth()

  const navItems = [{ to: '/', label: 'カレンダー', icon: CalendarIcon, end: true }]
  if (user) {
    navItems.push({ to: '/apply', label: '申請', icon: FilmIcon, end: false })
    navItems.push({ to: '/me', label: 'マイページ', icon: UserIcon, end: false })
  }
  if (profile?.is_admin) {
    navItems.push({ to: '/admin', label: '管理', icon: UsersIcon, end: false })
  }

  return (
    <div className="min-h-screen bg-bg text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:rounded-lg focus:bg-accent focus:text-bg focus:text-sm focus:font-semibold"
      >
        本文へスキップ
      </a>
      <header className="sticky top-0 z-20 bg-bg/90 backdrop-blur border-b border-line">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <h1 className="text-base font-bold tracking-wide font-display shrink-0">
            <span className="text-accent" aria-hidden="true">
              ●
            </span>{' '}
            <span className="text-ink">映画鑑賞サークル</span>
          </h1>

          {/* デスクトップ用ナビ */}
          <nav className="hidden md:flex items-center gap-1" aria-label="メインナビゲーション">
            {navItems.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                    isActive
                      ? 'text-accent bg-accent/10'
                      : 'text-ink-muted hover:text-ink hover:bg-card'
                  }`
                }
              >
                <Icon size={18} />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            {user ? (
              <>
                <NavLink
                  to="/me"
                  className="text-sm text-ink-muted truncate max-w-[8rem] hover:text-ink transition-colors"
                >
                  {profile?.display_name}
                </NavLink>
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

      <main id="main" className="max-w-3xl mx-auto px-4 pt-5 pb-28 md:pb-12">
        <Outlet />
      </main>

      {/* モバイル用ボトムナビ */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-20 bg-card/95 backdrop-blur border-t border-line"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="メインナビゲーション"
      >
        <div
          className="max-w-3xl mx-auto grid"
          style={{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }}
        >
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
