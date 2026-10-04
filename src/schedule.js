import { supabase } from './supabase'
import {
  esc, hue, DAYS, WEEK_ORDER, KINDS, fmtTime, fmtDate, ymd, upcomingDates, describeChange,
} from './util'

const $ = (id) => document.getElementById(id)

// One shared dialog for every timetable / course screen
export function dialog() {
  let d = document.getElementById('sdlg')
  if (!d) {
    d = document.createElement('dialog')
    d.id = 'sdlg'
    d.onclick = (e) => { if (e.target === d) d.close() }
    document.body.append(d)
  }
  return d
}

const slotLabel = (s) =>
  `${DAYS[s.weekday]} ${fmtTime(s.start_time)}–${fmtTime(s.end_time)} · ${KINDS[s.kind]}`

// ---------------------------------------------------------------
// Course dialog: weekly times, upcoming one-time changes, and
// (super admin) rename / delete the course.
// ctx = { me, isSuper, can(courseId) }
// ---------------------------------------------------------------
export async function openCourse(ctx, course, onDone = () => {}) {
  const d = dialog()
  const canEdit = ctx.can(course.id)

  async function render() {
    const sRes = await supabase
      .from('sessions')
      .select('id,course_id,kind,weekday,start_time,end_time,room')
      .eq('course_id', course.id)
    if (sRes.error) {
      d.innerHTML = `<div class="dlg-body"><p class="msg">${esc(sRes.error.message)}</p>
        <div class="dlg-actions"><button id="x-close" class="ghost">Close</button></div></div>`
      $('x-close').onclick = () => d.close()
      if (!d.open) d.showModal()
      return
    }
    const sessions = sRes.data.sort((a, b) =>
      WEEK_ORDER.indexOf(a.weekday) - WEEK_ORDER.indexOf(b.weekday) ||
      a.start_time.localeCompare(b.start_time))
    const byId = new Map(sessions.map((s) => [s.id, s]))

    let changes = []
    if (sessions.length) {
      const cRes = await supabase
        .from('session_changes')
        .select('*')
        .in('session_id', sessions.map((s) => s.id))
        .gte('on_date', ymd(new Date()))
        .order('on_date')
      changes = cRes.data ?? []
    }

    const slots = sessions.map((s) => `
      <li>
        <div class="info">
          <div class="code">${esc(DAYS[s.weekday])} · ${fmtTime(s.start_time)}–${fmtTime(s.end_time)}</div>
          <div class="cname">${esc(KINDS[s.kind])}${s.room ? ' · ' + esc(s.room) : ''}</div>
        </div>
        ${canEdit ? `<button class="ghost" data-edit="${s.id}">Edit</button>` : ''}
      </li>`).join('')

    const chg = changes.map((c) => `
      <li>
        <div class="info">
          <div class="code">${esc(fmtDate(c.on_date))} · ${esc(KINDS[byId.get(c.session_id)?.kind] ?? '')}</div>
          <div class="cname">${esc(describeChange(c))}${c.note ? ' — ' + esc(c.note) : ''}</div>
        </div>
        ${canEdit ? `<button class="ghost" data-edit-change="${c.id}">Edit</button>
                     <button class="ghost" data-rm="${c.id}">Remove</button>` : ''}
      </li>`).join('')

    d.innerHTML = `
      <div class="dlg-body">
        <span class="subject" style="--h:${hue(course.code)}">${esc(course.code)}</span>
        <h3>${esc(course.name)}</h3>

        <h2>Weekly times</h2>
        ${sessions.length ? `<ul class="courses">${slots}</ul>` : '<p class="meta">No times yet.</p>'}
        ${canEdit ? '<button id="add-slot">+ Add lecture / lab time</button>' : ''}

        <h2>Upcoming changes</h2>
        ${changes.length ? `<ul class="courses">${chg}</ul>` : '<p class="meta">No one-time changes.</p>'}
        ${canEdit && sessions.length ? '<button id="add-change">+ One-time change</button>' : ''}

        ${ctx.isSuper ? `
        <h2>Course settings</h2>
        <div class="row">
          <input id="c-code" maxlength="20" placeholder="Code" />
          <input id="c-name" maxlength="100" placeholder="Course name" />
        </div>
        <div class="dlg-actions">
          <button id="c-save">Save course</button>
          <button id="c-del" class="danger">Delete course</button>
        </div>` : ''}

        <p class="msg" id="x-msg"></p>
        <div class="dlg-actions"><button id="x-close" class="ghost">Close</button></div>
      </div>`

    const msg = (t) => { $('x-msg').textContent = t }
    const saved = () => { onDone(); render() }
    $('x-close').onclick = () => d.close()

    d.querySelectorAll('[data-edit]').forEach((b) => {
      b.onclick = () => openSessionForm(ctx, course, byId.get(b.dataset.edit), saved, render)
    })
    if ($('add-slot')) $('add-slot').onclick = () => openSessionForm(ctx, course, null, saved, render)
    if ($('add-change')) $('add-change').onclick = () => openChangeForm(ctx, course, sessions, {}, saved, render)

    d.querySelectorAll('[data-edit-change]').forEach((b) => {
      const c = changes.find((x) => x.id === b.dataset.editChange)
      b.onclick = () => openChangeForm(
        ctx, course, sessions, { session: byId.get(c.session_id), date: c.on_date, existing: c }, saved, render)
    })
    d.querySelectorAll('[data-rm]').forEach((b) => {
      b.onclick = async () => {
        const { data, error } = await supabase.from('session_changes').delete().eq('id', b.dataset.rm).select('id')
        if (error || !data?.length) return msg(error?.message ?? 'Not allowed.')
        saved()
      }
    })

    if (ctx.isSuper) {
      $('c-code').value = course.code
      $('c-name').value = course.name
      $('c-save').onclick = async () => {
        const code = $('c-code').value.trim().toUpperCase()
        const name = $('c-name').value.trim()
        if (!code || !name) return msg('Code and name are required.')
        const { data, error } = await supabase.from('courses').update({ code, name }).eq('id', course.id).select('id')
        if (error) return msg(error.code === '23505' ? 'That course code already exists.' : error.message)
        if (!data?.length) return msg('Not allowed.')
        course.code = code
        course.name = name
        saved()
      }
      $('c-del').onclick = async () => {
        if (!confirm(`Delete ${course.code}? This also deletes its tasks, timetable and enrollments.`)) return
        const { data, error } = await supabase.from('courses').delete().eq('id', course.id).select('id')
        if (error || !data?.length) return msg(error?.message ?? 'Not allowed.')
        d.close()
        onDone()
      }
    }
  }

  await render()
  if (!d.open) d.showModal()
}

// ---------------------------------------------------------------
// Add / edit / delete a weekly lecture or lab time
// ---------------------------------------------------------------
export function openSessionForm(ctx, course, session, onSaved, onCancel) {
  const d = dialog()
  d.innerHTML = `
    <form class="dlg-body" id="sf">
      <h3>${session ? 'Edit time' : 'Add time'} · ${esc(course.code)}</h3>
      <label class="fld">Type
        <select id="sf-kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      </label>
      <label class="fld">Day
        <select id="sf-day">${WEEK_ORDER.map((i) => `<option value="${i}">${DAYS[i]}</option>`).join('')}</select>
      </label>
      <div class="row">
        <label class="fld">Start <input id="sf-start" type="time" required /></label>
        <label class="fld">End <input id="sf-end" type="time" required /></label>
      </div>
      <input id="sf-room" maxlength="40" placeholder="Room / hall (optional)" />
      <p class="msg" id="sf-msg"></p>
      <div class="dlg-actions">
        ${session ? '<button type="button" id="sf-del" class="danger">Delete</button>' : ''}
        <button id="sf-save">Save</button>
        <button type="button" id="sf-cancel" class="ghost">Cancel</button>
      </div>
    </form>`

  if (session) {
    $('sf-kind').value = session.kind
    $('sf-day').value = String(session.weekday)
    $('sf-start').value = fmtTime(session.start_time)
    $('sf-end').value = fmtTime(session.end_time)
    $('sf-room').value = session.room ?? ''
  }
  const msg = (t) => { $('sf-msg').textContent = t }
  $('sf-cancel').onclick = onCancel

  $('sf').onsubmit = async (e) => {
    e.preventDefault()
    const start = $('sf-start').value
    const end = $('sf-end').value
    if (end <= start) return msg('End time must be after start time.')
    const row = {
      course_id: course.id,
      kind: $('sf-kind').value,
      weekday: Number($('sf-day').value),
      start_time: start,
      end_time: end,
      room: $('sf-room').value.trim() || null,
    }
    $('sf-save').disabled = true
    const q = session
      ? supabase.from('sessions').update(row).eq('id', session.id)
      : supabase.from('sessions').insert(row)
    const { data, error } = await q.select('id')
    if (error || !data?.length) {
      $('sf-save').disabled = false
      return msg(error?.message ?? 'Not allowed for this course.')
    }
    onSaved()
  }

  if (session) {
    $('sf-del').onclick = async () => {
      if (!confirm('Delete this weekly time and its one-time changes?')) return
      const { data, error } = await supabase.from('sessions').delete().eq('id', session.id).select('id')
      if (error || !data?.length) return msg(error?.message ?? 'Not allowed for this course.')
      onSaved()
    }
  }
  if (!d.open) d.showModal()
}

// ---------------------------------------------------------------
// One-time change: cancel, move, change time/room, or make online
// opts = { session, date, existing }
// ---------------------------------------------------------------
export function openChangeForm(ctx, course, sessions, opts, onSaved, onCancel) {
  const { session, date, existing } = opts ?? {}
  const d = dialog()
  const first = session ?? sessions[0]

  d.innerHTML = `
    <form class="dlg-body" id="cf">
      <h3>One-time change · ${esc(course.code)}</h3>
      <label class="fld">Which class
        <select id="cf-session">${sessions.map((s) => `<option value="${s.id}">${esc(slotLabel(s))}</option>`).join('')}</select>
      </label>
      <label class="fld">Which date <select id="cf-date"></select></label>
      <label class="fld">What happens
        <select id="cf-status">
          <option value="cancelled">Cancelled (no class)</option>
          <option value="changed">Changed (time, room or online)</option>
        </select>
      </label>
      <div id="cf-changed" class="stack" hidden>
        <label class="fld">Move to another date (optional) <input id="cf-newdate" type="date" /></label>
        <div class="row">
          <label class="fld">New start <input id="cf-ns" type="time" /></label>
          <label class="fld">New end <input id="cf-ne" type="time" /></label>
        </div>
        <input id="cf-room" maxlength="40" placeholder="New room (optional)" />
        <label class="check"><input id="cf-online" type="checkbox" /> Online</label>
      </div>
      <input id="cf-note" maxlength="200" placeholder="Note for students (optional)" />
      <p class="msg" id="cf-msg"></p>
      <div class="dlg-actions">
        ${existing ? '<button type="button" id="cf-del" class="danger">Remove change</button>' : ''}
        <button id="cf-save">Save</button>
        <button type="button" id="cf-cancel" class="ghost">Cancel</button>
      </div>
    </form>`

  const sessionById = (id) => sessions.find((s) => s.id === id)
  const fillDates = (s, selected) => {
    const list = upcomingDates(s.weekday, 12)
    if (selected && !list.includes(selected)) list.unshift(selected)
    $('cf-date').innerHTML = list.map((x) => `<option value="${x}">${esc(fmtDate(x))}</option>`).join('')
    if (selected) $('cf-date').value = selected
  }
  const toggle = () => { $('cf-changed').hidden = $('cf-status').value !== 'changed' }

  $('cf-session').value = first.id
  fillDates(first, date)
  $('cf-session').onchange = () => fillDates(sessionById($('cf-session').value), null)
  $('cf-status').onchange = toggle

  if (existing) {
    $('cf-status').value = existing.status
    $('cf-newdate').value = existing.new_date ?? ''
    $('cf-ns').value = fmtTime(existing.new_start)
    $('cf-ne').value = fmtTime(existing.new_end)
    $('cf-room').value = existing.new_room ?? ''
    $('cf-online').checked = !!existing.online
    $('cf-note').value = existing.note ?? ''
  }
  toggle()

  const msg = (t) => { $('cf-msg').textContent = t }
  $('cf-cancel').onclick = onCancel

  $('cf').onsubmit = async (e) => {
    e.preventDefault()
    const sess = sessionById($('cf-session').value)
    const onDate = $('cf-date').value
    const status = $('cf-status').value
    const row = {
      session_id: sess.id,
      on_date: onDate,
      status,
      new_date: null,
      new_start: null,
      new_end: null,
      new_room: null,
      online: false,
      note: $('cf-note').value.trim() || null,
    }
    if (status === 'changed') {
      const nd = $('cf-newdate').value
      const ns = $('cf-ns').value
      const ne = $('cf-ne').value
      const room = $('cf-room').value.trim()
      const isOnline = $('cf-online').checked
      if ((ns && !ne) || (!ns && ne)) return msg('Enter both a new start and end time, or neither.')
      if (ns && ne && ne <= ns) return msg('End time must be after start time.')
      row.new_date = nd && nd !== onDate ? nd : null
      row.new_start = ns || null
      row.new_end = ne || null
      row.new_room = room || null
      row.online = isOnline
      if (!row.new_date && !ns && !room && !isOnline) return msg('Change something, or choose "Cancelled".')
    }
    $('cf-save').disabled = true
    const { data, error } = await supabase
      .from('session_changes')
      .upsert(row, { onConflict: 'session_id,on_date' })
      .select('id')
    if (error || !data?.length) {
      $('cf-save').disabled = false
      return msg(error?.message ?? 'Not allowed for this course.')
    }
    onSaved()
  }

  if (existing) {
    $('cf-del').onclick = async () => {
      const { data, error } = await supabase.from('session_changes').delete().eq('id', existing.id).select('id')
      if (error || !data?.length) return msg(error?.message ?? 'Not allowed for this course.')
      onSaved()
    }
  }
  if (!d.open) d.showModal()
}
