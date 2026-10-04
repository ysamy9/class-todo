import { supabase } from './supabase'
import {
  esc, hue, ymd, addDays, startOfWeek, fmtTime, fmtDate, DAYS, KINDS, describeChange,
} from './util'
import { dialog, openChangeForm, openSessionForm } from './schedule'

const $ = (id) => document.getElementById(id)

// Weekly timetable for the courses you're enrolled in.
// ctx = { me, isSuper, can(courseId) }
export async function mountTimetable(ctx) {
  $('view').innerHTML = `
    <div class="weeknav">
      <button class="ghost" id="wk-prev" aria-label="Previous week">‹</button>
      <div class="weeklabel" id="wk-label"></div>
      <button class="ghost" id="wk-next" aria-label="Next week">›</button>
    </div>
    <div class="chips">
      <button class="chip" id="wk-today">This week</button>
      <label class="chip" id="all-chip"><input type="checkbox" id="all-box" /> All courses</label>
    </div>
    <div id="days"></div>
    <p class="empty" id="tt-empty" hidden></p>`

  let weekStart = startOfWeek(new Date())
  let showAll = false
  let sessions = []
  let enrolled = new Set()
  let changes = []
  let flat = []

  async function loadBase() {
    const [s, e] = await Promise.all([
      supabase.from('sessions')
        .select('id,course_id,kind,weekday,start_time,end_time,room,courses(id,code,name)'),
      supabase.from('enrollments').select('course_id'),
    ])
    if (s.error || e.error) return console.error(s.error || e.error)
    sessions = s.data
    enrolled = new Set(e.data.map((r) => r.course_id))
  }

  async function loadChanges() {
    const a = ymd(weekStart)
    const b = ymd(addDays(weekStart, 6))
    const { data, error } = await supabase
      .from('session_changes')
      .select('*')
      .or(`and(on_date.gte.${a},on_date.lte.${b}),and(new_date.gte.${a},new_date.lte.${b})`)
    if (error) return console.error(error)
    changes = data
  }

  async function reload() {
    await Promise.all([loadBase(), loadChanges()])
    render()
  }

  async function goToWeek(date) {
    weekStart = date
    await loadChanges()
    render()
  }

  // apply a one-time change to an occurrence
  function apply(it, ch) {
    if (ch.new_start && ch.new_end) { it.start = ch.new_start; it.end = ch.new_end }
    if (ch.new_room) it.room = ch.new_room
    if (ch.online) it.badges.push(['Online', ''])
    if (ch.new_start || ch.new_room) it.badges.push(['Changed', 'warn'])
  }

  function render() {
    if (!$('days')) return
    const todayKey = ymd(new Date())
    const visible = (s) => showAll || enrolled.has(s.course_id)
    const byId = new Map(sessions.map((s) => [s.id, s]))
    const chg = new Map(changes.map((c) => [`${c.session_id}|${c.on_date}`, c]))

    $('wk-label').textContent = `${fmtDate(weekStart)} – ${fmtDate(addDays(weekStart, 6))}`
    $('all-chip').classList.toggle('active', showAll)

    flat = []
    let html = ''
    for (let i = 0; i < 7; i++) {
      const day = addDays(weekStart, i)
      const key = ymd(day)
      const items = []

      for (const s of sessions) {
        if (!visible(s) || s.weekday !== day.getDay()) continue
        const ch = chg.get(`${s.id}|${key}`)
        const it = { s, ch, origDate: key, start: s.start_time, end: s.end_time, room: s.room, badges: [], off: false }
        if (ch?.status === 'cancelled') {
          it.off = true
          it.badges.push(['Cancelled', 'bad'])
        } else if (ch && ch.new_date && ch.new_date !== key) {
          it.off = true
          it.badges.push([`Moved to ${fmtDate(ch.new_date)}`, 'warn'])
        } else if (ch) {
          apply(it, ch)
        }
        items.push(it)
      }

      // classes moved onto this day from another date
      for (const ch of changes) {
        if (ch.status !== 'changed' || ch.new_date !== key || ch.on_date === key) continue
        const s = byId.get(ch.session_id)
        if (!s || !visible(s)) continue
        const it = {
          s, ch, origDate: ch.on_date, start: s.start_time, end: s.end_time, room: s.room,
          badges: [[`Moved from ${fmtDate(ch.on_date)}`, 'warn']], off: false,
        }
        apply(it, ch)
        items.push(it)
      }

      if (!items.length) continue
      items.sort((a, b) => a.start.localeCompare(b.start))

      html += `<section class="day ${key === todayKey ? 'today' : ''}">
        <h2>${esc(DAYS[day.getDay()])} · ${esc(fmtDate(day))}</h2>
        <ul class="tt">${items.map((it) => {
          const idx = flat.push(it) - 1
          const c = it.s.courses
          return `<li data-i="${idx}" class="${it.off ? 'off' : ''}">
            <div class="time">${fmtTime(it.start)}<span>${fmtTime(it.end)}</span></div>
            <div class="what">
              <span class="subject" style="--h:${hue(c?.code ?? '?')}">${esc(c?.code ?? '?')}</span>
              <strong class="title">${esc(KINDS[it.s.kind])}</strong>
              ${it.room ? `<div class="where">${esc(it.room)}</div>` : ''}
              <div>${it.badges.map(([t, cls]) => `<span class="badge ${cls}">${esc(t)}</span>`).join('')}</div>
              ${it.ch?.note ? `<div class="where">${esc(it.ch.note)}</div>` : ''}
            </div>
          </li>`
        }).join('')}</ul>
      </section>`
    }

    $('days').innerHTML = html
    $('tt-empty').hidden = flat.length > 0
    $('tt-empty').textContent = !showAll && !enrolled.size
      ? 'Enroll in courses on the Courses tab to build your timetable.'
      : 'Nothing scheduled this week.'
  }

  function showOccurrence(it) {
    const d = dialog()
    const c = it.s.courses
    const editable = ctx.can(it.s.course_id)
    const status = it.ch ? describeChange(it.ch) : 'As scheduled'
    d.innerHTML = `
      <div class="dlg-body">
        <span class="subject" style="--h:${hue(c.code)}">${esc(c.code)}</span>
        <h3>${esc(c.name)}</h3>
        <p class="meta">${esc(KINDS[it.s.kind])} · ${esc(fmtDate(it.origDate))}</p>
        <dl class="dlg-meta">
          <dt>Time</dt><dd>${fmtTime(it.start)}–${fmtTime(it.end)}</dd>
          <dt>Room</dt><dd>${it.room ? esc(it.room) : '—'}</dd>
          <dt>Status</dt><dd>${esc(status)}</dd>
          ${it.ch?.note ? `<dt>Note</dt><dd>${esc(it.ch.note)}</dd>` : ''}
        </dl>
        <div class="dlg-actions">
          ${editable ? '<button id="o-change">Change this one</button><button id="o-edit" class="ghost">Edit weekly time</button>' : ''}
          <button id="o-close" class="ghost">Close</button>
        </div>
      </div>`
    $('o-close').onclick = () => d.close()
    if (editable) {
      const courseSessions = sessions.filter((s) => s.course_id === it.s.course_id)
      const saved = () => { d.close(); reload() }
      const back = () => showOccurrence(it)
      $('o-change').onclick = () =>
        openChangeForm(ctx, c, courseSessions, { session: it.s, date: it.origDate, existing: it.ch }, saved, back)
      $('o-edit').onclick = () => openSessionForm(ctx, c, it.s, saved, back)
    }
    if (!d.open) d.showModal()
  }

  $('wk-prev').onclick = () => goToWeek(addDays(weekStart, -7))
  $('wk-next').onclick = () => goToWeek(addDays(weekStart, 7))
  $('wk-today').onclick = () => goToWeek(startOfWeek(new Date()))
  $('all-box').onchange = (e) => { showAll = e.target.checked; render() }
  $('days').onclick = (e) => {
    const li = e.target.closest('li[data-i]')
    if (li) showOccurrence(flat[Number(li.dataset.i)])
  }

  await reload()
}
