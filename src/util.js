// Shared helpers for the timetable / course screens

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// Same text always gives the same color
export const hue = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)

// First day of the week in the timetable: 0 = Sunday, 6 = Saturday
export const WEEK_START = 0

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const WEEK_ORDER = [...Array(7)].map((_, i) => (WEEK_START + i) % 7)
export const KINDS = { lecture: 'Lecture', lab: 'Lab', tutorial: 'Tutorial' }

const pad = (n) => String(n).padStart(2, '0')
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const parseYmd = (s) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
export const addDays = (d, n) => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
export const startOfWeek = (d) => {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  return addDays(day, -((day.getDay() - WEEK_START + 7) % 7))
}

export const fmtTime = (t) => (t ? String(t).slice(0, 5) : '')
export const fmtDate = (d) =>
  (typeof d === 'string' ? parseYmd(d) : d).toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
  })

// The next n dates (as YYYY-MM-DD, starting today) that fall on the given weekday
export function upcomingDates(weekday, n = 12) {
  let d = new Date()
  d = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  while (d.getDay() !== weekday) d = addDays(d, 1)
  return [...Array(n)].map((_, i) => ymd(addDays(d, i * 7)))
}

// Plain-text summary of a one-time change (callers must esc() it)
export function describeChange(c) {
  if (c.status === 'cancelled') return 'Cancelled'
  const p = []
  if (c.online) p.push('Online')
  if (c.new_date && c.new_date !== c.on_date) p.push(`Moved to ${fmtDate(c.new_date)}`)
  if (c.new_start && c.new_end) p.push(`${fmtTime(c.new_start)}–${fmtTime(c.new_end)}`)
  if (c.new_room) p.push(`Room ${c.new_room}`)
  return p.join(' · ') || 'Changed'
}
