const TZ = 'Asia/Kolkata'

export function fmtDate(v, opts = {}) {
  if (!v) return '—'
  try {
    const d = new Date(v)
    if (isNaN(d.getTime())) return '—'
    return d.toLocaleDateString('en-IN', { timeZone: TZ, ...opts })
  } catch { return '—' }
}

export function fmtDateTime(v) {
  if (!v) return '—'
  try {
    const d = new Date(v)
    if (isNaN(d.getTime())) return '—'
    return d.toLocaleString('en-IN', { timeZone: TZ })
  } catch { return '—' }
}

export function istHour() {
  const h = parseInt(
    new Date().toLocaleString('en-US', { timeZone: TZ, hour12: false, hour: '2-digit' }),
    10
  )
  return h === 24 ? 0 : h
}
