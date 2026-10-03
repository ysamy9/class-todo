import { supabase } from './supabase'

// Edit this list to match your real courses
const SUBJECTS = ['Other', 'Logic II', 'Network', 'Electronics II', 'Waves','Comm Theory','Power1']
let channel

export async function mountTasks(user) {
  const root = document.getElementById('tasks')
  root.innerHTML = `
    <h2>Add task</h2>
    <form id="add">
      <select id="subject">
        ${SUBJECTS.map((s) => `<option>${s}</option>`).join('')}
      </select>
      <input id="description" placeholder="What needs to be done?" required maxlength="200" />
      <input id="due" type="date" />
      <label><input id="global" type="checkbox" /> Post to everyone</label>
      <button>Add</button>
    </form>
    <ul id="list"></ul>`

  async function load() {
    const [t, s] = await Promise.all([
      supabase.from('tasks')
        .select('id,subject,description,due,is_global,created_at,profiles(display_name)'),
      supabase.from('task_status').select('task_id,done,done_at,hidden'),
    ])
    if (t.error || s.error) return console.error(t.error || s.error)

    const status = new Map(s.data.map((r) => [r.task_id, r]))
    const rows = t.data
      .map((task) => ({ task, st: status.get(task.id) }))
      .filter((r) => !r.st?.hidden)

    rows.sort((a, b) => {
      const ad = !!a.st?.done
      const bd = !!b.st?.done
      if (ad !== bd) return ad ? 1 : -1 // undone first, done last
      if (ad) return new Date(b.st.done_at ?? 0) - new Date(a.st.done_at ?? 0) // newest done on top
      return new Date(b.task.created_at) - new Date(a.task.created_at) // newest task on top
    })

    const list = document.getElementById('list')
    list.replaceChildren()

    for (const { task, st } of rows) {
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
        load() // re-sort so the task jumps to its new position
      }

      const label = document.createElement('strong')
      label.className = 'subject'
      label.textContent = task.subject

      const text = document.createElement('span')
      const due = task.due ? ` (due ${task.due})` : ''
      const scope = task.is_global ? 'GLOBAL, ' : ''
      text.textContent = ` ${task.description}${due} - ${scope}by ${task.profiles?.display_name ?? '?'}`

      const li = document.createElement('li')
      if (st?.done) li.className = 'done'
      li.append(box, label, text)
      list.append(li)
    }
  }

  document.getElementById('add').onsubmit = async (e) => {
    e.preventDefault()
    const { error } = await supabase.from('tasks').insert({
      subject: document.getElementById('subject').value,
      description: document.getElementById('description').value.trim(),
      due: document.getElementById('due').value || null,
      is_global: document.getElementById('global').checked,
    })
    if (error) return alert(error.message)
    e.target.reset()
    load()
  }

  load()
	  if (channel) supabase.removeChannel(channel)
  channel = supabase
    .channel('tasks-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => load())
    .subscribe()
}
