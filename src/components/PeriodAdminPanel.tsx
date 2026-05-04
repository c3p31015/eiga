import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import {
  type ActivityPeriod,
  deadlineToInputValue,
  inputValueToDeadline,
  formatDeadline,
  isPeriodOpen,
  isPeriodPendingLock,
} from '../lib/activity'
import { ChevronLeftIcon, ChevronRightIcon } from './icons'

export default function PeriodAdminPanel() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [period, setPeriod] = useState<ActivityPeriod | null>(null)
  const [deadlineInput, setDeadlineInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [locking, setLocking] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const flash = (msg: string, isError = false) => {
    if (isError) {
      setError(msg)
      setSuccess('')
    } else {
      setSuccess(msg)
      setError('')
    }
    setTimeout(() => {
      setError('')
      setSuccess('')
    }, 2500)
  }

  const fetchPeriod = useCallback(async () => {
    setLoading(true)
    const { data: idData, error: rpcError } = await supabase.rpc('ensure_period', {
      p_year: year,
      p_month: month,
    })
    if (rpcError || !idData) {
      flash(`期間の取得に失敗しました: ${rpcError?.message ?? '不明なエラー'}`, true)
      setLoading(false)
      return
    }
    const { data, error: selectError } = await supabase
      .from('activity_periods')
      .select('*')
      .eq('id', idData as string)
      .single()
    if (selectError) {
      flash(`期間の読み込みに失敗しました: ${selectError.message}`, true)
      setLoading(false)
      return
    }
    setPeriod(data as ActivityPeriod)
    setDeadlineInput(deadlineToInputValue((data as ActivityPeriod).deadline_at))
    setLoading(false)
  }, [year, month])

  useEffect(() => {
    fetchPeriod()
  }, [fetchPeriod])

  const saveDeadline = async () => {
    if (!period) return
    setSaving(true)
    const newDeadline = inputValueToDeadline(deadlineInput)
    const { error: updateError } = await supabase
      .from('activity_periods')
      .update({ deadline_at: newDeadline })
      .eq('id', period.id)
    setSaving(false)
    if (updateError) {
      flash(`更新に失敗しました: ${updateError.message}`, true)
      return
    }
    flash('締切日を更新しました')
    fetchPeriod()
  }

  const runUnlock = async () => {
    if (!period) return
    if (
      !confirm(
        'ロックを解除します。確定済みの主催者割り当てがすべて削除され、希望提出を再受付状態に戻します。続行しますか？'
      )
    ) {
      return
    }
    setUnlocking(true)
    const { error: rpcError } = await supabase.rpc('unlock_activity_period', {
      p_period_id: period.id,
    })
    setUnlocking(false)
    if (rpcError) {
      flash(`ロック解除に失敗しました: ${rpcError.message}`, true)
      return
    }
    flash('ロックを解除しました')
    fetchPeriod()
  }

  const runLock = async () => {
    if (!period) return
    if (!confirm('集計を実行します。一度実行すると以後の希望提出はできなくなり、結果の取り消しもできません。続行しますか？')) {
      return
    }
    setLocking(true)
    const { error: rpcError } = await supabase.rpc('lock_activity_period', {
      p_period_id: period.id,
    })
    setLocking(false)
    if (rpcError) {
      flash(`集計に失敗しました: ${rpcError.message}`, true)
      return
    }
    flash('集計を実行しました')
    fetchPeriod()
  }

  const goPrev = () => {
    let y = year
    let m = month - 1
    if (m < 1) {
      m = 12
      y -= 1
    }
    setYear(y)
    setMonth(m)
  }
  const goNext = () => {
    let y = year
    let m = month + 1
    if (m > 12) {
      m = 1
      y += 1
    }
    setYear(y)
    setMonth(m)
  }
  const goThisMonth = () => {
    const now = new Date()
    setYear(now.getFullYear())
    setMonth(now.getMonth() + 1)
  }

  const status = period
    ? period.locked_at
      ? '集計済み'
      : isPeriodOpen(period)
        ? '受付中'
        : isPeriodPendingLock(period)
          ? '締切後・未集計'
          : '不明'
    : '-'

  const statusClass = period?.locked_at
    ? 'bg-ink-dim/15 text-ink-muted border-line'
    : isPeriodOpen(period)
      ? 'bg-success-bg/40 text-success border-success/30'
      : 'bg-danger-bg/40 text-danger border-danger/30'

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-ink">月別期間設定</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={goPrev}
            aria-label="前月"
            className="p-2 rounded-lg text-ink-muted hover:text-ink hover:bg-card transition-colors"
          >
            <ChevronLeftIcon />
          </button>
          <button
            onClick={goThisMonth}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-line text-ink-muted hover:text-ink hover:border-accent/40 transition-colors"
          >
            今月
          </button>
          <button
            onClick={goNext}
            aria-label="翌月"
            className="p-2 rounded-lg text-ink-muted hover:text-ink hover:bg-card transition-colors"
          >
            <ChevronRightIcon />
          </button>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-line p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-ink">
            {year}年{month}月
          </p>
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${statusClass}`}>
            {status}
          </span>
        </div>

        {loading ? (
          <p className="text-sm text-ink-muted">読み込み中...</p>
        ) : period ? (
          <>
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1.5">
                希望提出の締切（JST）
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="datetime-local"
                  value={deadlineInput}
                  onChange={(e) => setDeadlineInput(e.target.value)}
                  className="flex-1 px-3 py-2.5 bg-bg border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
                />
                <button
                  onClick={saveDeadline}
                  disabled={saving}
                  className="px-4 py-2.5 bg-accent text-bg text-sm font-semibold rounded-lg hover:bg-accent-strong disabled:opacity-50 transition-colors"
                >
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-ink-dim">
                現在の締切: {formatDeadline(period.deadline_at)}
              </p>
              {period.locked_at && (
                <p className="mt-1 text-[11px] text-accent">
                  ※ 集計済みのため、締切を変更しても新規希望は受け付けられません。再受付するには下のロック解除を実行してください。
                </p>
              )}
            </div>

            {period.locked_at ? (
              <div className="space-y-2">
                <p className="text-xs text-ink-muted">
                  集計済み: {formatDeadline(period.locked_at)}
                </p>
                <button
                  onClick={runUnlock}
                  disabled={unlocking}
                  className="w-full px-4 py-2.5 bg-danger/15 text-danger text-sm font-semibold rounded-lg hover:bg-danger/25 disabled:opacity-40 disabled:cursor-not-allowed border border-danger/30 transition-colors"
                >
                  {unlocking ? 'ロック解除中...' : 'ロック解除（主催者割り当てをクリア）'}
                </button>
              </div>
            ) : (
              <button
                onClick={runLock}
                disabled={locking || isPeriodOpen(period)}
                className="w-full px-4 py-2.5 bg-danger/15 text-danger text-sm font-semibold rounded-lg hover:bg-danger/25 disabled:opacity-40 disabled:cursor-not-allowed border border-danger/30 transition-colors"
              >
                {locking
                  ? '集計中...'
                  : isPeriodOpen(period)
                    ? '締切前のため集計不可'
                    : '今すぐ集計を実行'}
              </button>
            )}
          </>
        ) : (
          <p className="text-sm text-danger">期間レコードを取得できませんでした</p>
        )}

        {error && (
          <p className="text-sm text-danger bg-danger-bg/60 border border-danger/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        {success && (
          <p className="text-sm text-success bg-success-bg/60 border border-success/30 rounded-lg px-3 py-2">
            {success}
          </p>
        )}
      </div>
    </section>
  )
}
