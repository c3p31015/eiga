import { useState, useEffect } from 'react'
import { getStoredViewMonth, storeViewMonth } from '../lib/activity'
import PreferenceListPanel from '../components/PreferenceListPanel'

// 閲覧者・管理者向けの申請一覧ページ（読み取り専用は権限で制御）。
export default function ApplicationListPage() {
  const initial = getStoredViewMonth(new Date())
  const [viewYear, setViewYear] = useState(initial.year)
  const [viewMonth, setViewMonth] = useState(initial.month)

  useEffect(() => {
    storeViewMonth(viewYear, viewMonth)
  }, [viewYear, viewMonth])

  const goPrevMonth = () => {
    const d = new Date(viewYear, viewMonth - 1, 1)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
  }
  const goNextMonth = () => {
    const d = new Date(viewYear, viewMonth + 1, 1)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
  }
  const goThisMonth = () => {
    const now = new Date()
    setViewYear(now.getFullYear())
    setViewMonth(now.getMonth())
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-ink font-display">申請一覧</h2>
      <PreferenceListPanel
        year={viewYear}
        month={viewMonth + 1}
        onPrevMonth={goPrevMonth}
        onNextMonth={goNextMonth}
        onThisMonth={goThisMonth}
      />
    </div>
  )
}
