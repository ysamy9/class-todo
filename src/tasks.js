import { supabase } from './supabase'

// Edit this list to match your real courses
const SUBJECTS = ['Waves', 'Comm theory II', 'Logic II', 'Electronics II', 'Power I','Network',]

const $ = (id) => document.getElementById(id)
let channel

// Same subject name always gives the same color
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

export async function mountTasks(user) {
  $('tasks').innerHTML = `
    <section class="summary">
      <div class="summary-row"><strong id="count"></strong><span id="pct"></span></div>
      <div class="bar"><i id="fill"></i></div>
    </section>
    <details class="add" id="addbox">
      <summary>+ New task</summary>
      <form id="add">
        <input id="description" placeholder="What needs to be done?" required maxlength="200" />
        <div class="row">
          <select id="subject">${SUBJECTS.map((s) => `<option>${s}</option>`).join('')}</select>
          <input id="due" type="date" />
        </div>
        <label class="check"><input id="global" type="checkbox" /> Post to everyone</label>
        <button id="addbtn">Add task</button>
      </form>
    </details>
    <h2>Tasks</h2>
    <div class="chips" id="chips"></div>
    <ul id="list"></ul>
    <p class="empty" id="empty" hidden></p>`

  let rows = []
  const selected = new Set() // subjects ticked; empty means "all subjects"
  let weekOnly = false

  async function load() {
    const [t, s] = await Promise.all([
      supabase.from('tasks')
        .select('id,subject,description,due,is_global,created_at,profiles(display_name)'),
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

  function card({ task, st }) {
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
    label.style.setProperty('--h', hue(task.subject))
    label.textContent = task.subject

    const desc = document.createElement('div')
    desc.className = 'desc'
    desc.textContent = task.description

    const parts = []
    if (task.due) {
      const info = dueInfo(task.due)
      const span = document.createElement('span')
      span.className = 'due' + (st?.done ? '' : ` ${info.cls}`)
      span.textContent = info.text
      parts.push(span)
    }
    if (task.is_global) parts.push('For everyone')
    parts.push(`by ${task.profiles?.display_name ?? '?'}`)

    const meta = document.createElement('div')
    meta.className = 'meta'
    parts.forEach((p, i) => meta.append(i ? ' · ' : '', p))

    const body = document.createElement('div')
    body.className = 'body'
    body.append(label, desc, meta)

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

    const subjects = [...new Set(rows.map((r) => r.task.subject))]
    for (const s of [...selected]) if (!subjects.includes(s)) selected.delete(s)

    $('chips').replaceChildren(
      chip('Due this week', weekOnly, (v) => (weekOnly = v)),
      ...subjects.map((s) =>
        chip(s, selected.has(s), (v) => (v ? selected.add(s) : selected.delete(s)))
      )
    )

    const shown = rows.filter(({ task }) => {
      if (selected.size && !selected.has(task.subject)) return false
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
      : 'No tasks yet. Add the first one above.'
  }

  $('add').onsubmit = async (e) => {
    e.preventDefault()
    $('addbtn').disabled = true
    const { error } = await supabase.from('tasks').insert({
      subject: $('subject').value,
      description: $('description').value.trim(),
      due: $('due').value || null,
      is_global: $('global').checked,
    })
    $('addbtn').disabled = false
    if (error) return alert(error.message)
    e.target.reset()
    $('addbox').open = false
    load()
  }

  if (channel) supabase.removeChannel(channel)
  channel = supabase
    .channel('tasks-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => load())
    .subscribe()

  load()
}
