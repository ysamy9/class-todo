import { supabase } from './supabase'

const $ = (id) => document.getElementById(id)
let channel

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// Same course code always gives the same color
const hue = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)

// Whole days from today until a due date (negative = overdue)
function daysUntil(due) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((new Date(due + 'T00:00:00') - today) / 86400000)
}

function dueInfo(due) {
  const diff = daysUntil(due)
  if (diff < 0) return { text: `Overdue by ${-diff}d`, cls: 'overdue' }
  if (diff === 0) return { text: 'Due today', cls: 'soon' }
  if (diff === 1) return { text: 'Due tomorrow', cls: 'soon' }
  return { text: `Due ${due}`, cls: diff <= 3 ? 'soon' : '' }
}

export async function mountTasks(user, perms) {
  // perms = { all: bool, courses: Set of course ids this user may post in }
  const can = (courseId) => perms.all || perms.courses.has(courseId)
  const canAdd = perms.all || perms.courses.size > 0
  $('tasks').innerHTML = `
    <section class="summary">
      <div class="summary-row"><strong id="count"></strong><span id="pct"></span></div>
      <div class="bar"><i id="fill"></i></div>
    </section>
    ${canAdd ? `
    <details class="add" id="addbox">
      <summary>+ New task</summary>
      <form id="add">
        <input id="title" placeholder="Task name" required maxlength="100" />
        <textarea id="description" placeholder="Details (optional, shown when you open the task)" rows="3" maxlength="1000"></textarea>
        <div class="row">
          <select id="course" required></select>
          <input id="due" type="date" />
        </div>
        <button id="addbtn">Add task</button>
      </form>
    </details>` : ''}
    <h2>Tasks</h2>
    <div class="chips" id="chips"></div>
    <ul id="list"></ul>
    <p class="empty" id="empty" hidden></p>
    <dialog id="dlg"></dialog>`

  let rows = []
  let courses = [] // only loaded for admins (task form + edit form)
  const selected = new Set() // course codes ticked; empty means "all"
  let weekOnly = false
  const dlg = $('dlg')

  dlg.onclick = (e) => { if (e.target === dlg) dlg.close() } // click backdrop to close

  async function loadCourses() {
    const { data, error } = await supabase.from('courses').select('id,code,name').order('code')
    if (error) return console.error(error)
    courses = data.filter((c) => can(c.id))
    $('course').innerHTML = courses
      .map((c) => `<option value="${c.id}">${esc(c.code)} — ${esc(c.name)}</option>`)
      .join('')
  }

  async function load() {
    if (!$('count')) return // user switched tabs; this view is gone
    const [t, s] = await Promise.all([
      supabase.from('tasks')
        .select('id,course_id,title,description,due,created_at,courses(code,name),profiles(display_name)'),
      supabase.from('task_status').select('task_id,done,done_at,hidden'),
    ])
    if (t.error || s.error) return console.error(t.error || s.error)

    const status = new Map(s.data.map((r) => [r.task_id, r]))
    rows = t.data
      .map((task) => ({ task, st: status.get(task.id) }))
      .filter((r) => !r.st?.hidden)

    rows.sort((a, b) => {
      const ad = !!a.st?.done
      const bd = !!b.st?.done
      if (ad !== bd) return ad ? 1 : -1
      if (ad) return new Date(b.st.done_at ?? 0) - new Date(a.st.done_at ?? 0)
      return new Date(b.task.created_at) - new Date(a.task.created_at)
    })
    render()
  }

  // ---------- details / edit / delete ----------
  function showDetails({ task }) {
    const code = task.courses?.code ?? '?'
    const info = task.due ? dueInfo(task.due) : null
    dlg.innerHTML = `
      <div class="dlg-body">
        <span class="subject" style="--h:${hue(code)}">${esc(code)}</span>
        <h3>${esc(task.title)}</h3>
        <p class="meta">${esc(task.courses?.name ?? 'Unknown course')}</p>
        ${task.description ? `<p class="dlg-desc">${esc(task.description)}</p>` : '<p class="meta">No extra details.</p>'}
        <dl class="dlg-meta">
          <dt>Due</dt><dd>${info ? `${esc(task.due)} · ${esc(info.text)}` : 'No due date'}</dd>
          <dt>Posted by</dt><dd>${esc(task.profiles?.display_name ?? '?')}</dd>
          <dt>Posted</dt><dd>${new Date(task.created_at).toLocaleDateString()}</dd>
        </dl>
        <div class="dlg-actions">
          ${can(task.course_id) ? '<button id="d-edit">Edit</button><button id="d-del" class="danger">Delete</button>' : ''}
          <button id="d-close" class="ghost">Close</button>
        </div>
      </div>`
    $('d-close').onclick = () => dlg.close()
    if (can(task.course_id)) {
      $('d-edit').onclick = () => showEdit(task)
      $('d-del').onclick = () => removeTask(task)
    }
    if (!dlg.open) dlg.showModal()
  }

  function showEdit(task) {
    dlg.innerHTML = `
      <form class="dlg-body" id="edit">
        <h3>Edit task</h3>
        <input id="e-title" required maxlength="100" placeholder="Task name" />
        <textarea id="e-desc" rows="4" maxlength="1000" placeholder="Details (optional)"></textarea>
        <div class="row">
          <select id="e-course">${courses.map((c) =>
            `<option value="${c.id}">${esc(c.code)} — ${esc(c.name)}</option>`).join('')}</select>
          <input id="e-due" type="date" />
        </div>
        <p class="msg" id="e-msg"></p>
        <div class="dlg-actions">
          <button id="e-save">Save</button>
          <button type="button" id="e-cancel" class="ghost">Cancel</button>
        </div>
      </form>`
    $('e-title').value = task.title
    $('e-desc').value = task.description ?? ''
    $('e-course').value = task.course_id
    $('e-due').value = task.due ?? ''
    $('e-cancel').onclick = () => showDetails({ task })
    $('edit').onsubmit = async (e) => {
      e.preventDefault()
      $('e-save').disabled = true
      // .select() so we can tell when RLS silently blocked the update (0 rows)
      const { data, error } = await supabase.from('tasks')
        .update({
          title: $('e-title').value.trim(),
          description: $('e-desc').value.trim() || null,
          course_id: $('e-course').value,
          due: $('e-due').value || null,
        })
        .eq('id', task.id)
        .select('id')
      if (error || !data?.length) {
        $('e-msg').textContent = error?.message ?? 'You don\'t have permission for this course'
        $('e-save').disabled = false
        return
      }
      dlg.close()
      load()
    }
  }

  async function removeTask(task) {
    if (!confirm('Delete this task for everyone?')) return
    const { data, error } = await supabase.from('tasks').delete().eq('id', task.id).select('id')
    if (error || !data?.length) return alert(error?.message ?? 'You don\'t have permission for this course')
    dlg.close()
    load()
  }

  // ---------- list ----------
  function card(row) {
    const { task, st } = row
    const code = task.courses?.code ?? '?'

    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = !!st?.done
    box.onchange = async () => {
      const { error } = await supabase.from('task_status').upsert({
        user_id: user.id,
        task_id: task.id,
        done: box.checked,
        done_at: box.checked ? new Date().toISOString() : null,
      })
      if (error) return console.error(error)
      load()
    }

    const label = document.createElement('strong')
    label.className = 'subject'
    label.style.setProperty('--h', hue(code))
    label.textContent = code

    const desc = document.createElement('div')
    desc.className = 'desc'
    desc.textContent = task.title

    const parts = []
    if (task.due) {
      const info = dueInfo(task.due)
      const span = document.createElement('span')
      span.className = 'due' + (st?.done ? '' : ` ${info.cls}`)
      span.textContent = info.text
      parts.push(span)
    }
    parts.push(`by ${task.profiles?.display_name ?? '?'}`)

    const meta = document.createElement('div')
    meta.className = 'meta'
    parts.forEach((p, i) => meta.append(i ? ' · ' : '', p))

    const body = document.createElement('div')
    body.className = 'body'
    body.append(label, desc, meta)
    body.onclick = () => showDetails(row)

    const li = document.createElement('li')
    if (st?.done) li.className = 'done'
    li.append(box, body)
    return li
  }

  // A filter chip that is a real checkbox inside a label
  function chip(text, checked, onChange) {
    const label = document.createElement('label')
    label.className = 'chip' + (checked ? ' active' : '')
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = checked
    box.onchange = () => { onChange(box.checked); render() }
    label.append(box, text)
    return label
  }

  function render() {
    const total = rows.length
    const done = rows.filter((r) => r.st?.done).length
    const pct = total ? Math.round((done / total) * 100) : 0
    $('count').textContent = `${done}/${total}`
    $('pct').textContent = total ? `${pct}% done` : 'Nothing yet'
    $('fill').style.width = `${pct}%`

    const codes = [...new Set(rows.map((r) => r.task.courses?.code ?? '?'))].sort()
    for (const s of [...selected]) if (!codes.includes(s)) selected.delete(s)

    $('chips').replaceChildren(
      chip('Due this week', weekOnly, (v) => (weekOnly = v)),
      ...codes.map((s) =>
        chip(s, selected.has(s), (v) => (v ? selected.add(s) : selected.delete(s)))
      )
    )

    const shown = rows.filter(({ task }) => {
      if (selected.size && !selected.has(task.courses?.code ?? '?')) return false
      if (weekOnly) {
        if (!task.due) return false
        const d = daysUntil(task.due)
        if (d < 0 || d > 6) return false
      }
      return true
    })

    $('list').replaceChildren(...shown.map(card))
    $('empty').hidden = shown.length > 0
    $('empty').textContent = total
      ? 'Nothing matches these filters.'
      : canAdd
        ? 'No tasks yet. Add the first one above.'
        : 'No tasks yet. Enroll in your courses from the Courses tab.'
  }

  if (canAdd) {
    await loadCourses()
    $('add').onsubmit = async (e) => {
      e.preventDefault()
      $('addbtn').disabled = true
      const { error } = await supabase.from('tasks').insert({
        course_id: $('course').value,
        title: $('title').value.trim(),
        description: $('description').value.trim() || null,
        due: $('due').value || null,
      })
      $('addbtn').disabled = false
      if (error) return alert(error.message)
      e.target.reset()
      $('addbox').open = false
      load()
    }
  }

  if (channel) supabase.removeChannel(channel)
  channel = supabase
    .channel('tasks-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => load())
    .subscribe()

  load()
}
