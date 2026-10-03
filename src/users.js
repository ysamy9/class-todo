import { supabase } from './supabase'

const $ = (id) => document.getElementById(id)
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// Users tab. Admins: see users, grant/revoke task-posting access.
// Super admin: also rename users, promote/demote admins, delete users.
export async function mountUsers(me, isSuper) {
  $('view').innerHTML = `
    <h2>Users</h2>
    <input id="uq" placeholder="Search by name or student ID..." />
    <ul class="courses" id="ulist"></ul>
    <p class="empty" id="uempty" hidden></p>
    <dialog id="udlg"></dialog>`

  let users = []
  let courses = []
  let grants = []
  const courseOf = new Map()
  const udlg = $('udlg')
  udlg.onclick = (e) => { if (e.target === udlg) udlg.close() }

  async function load() {
    if (!$('ulist')) return
    const [u, c, g] = await Promise.all([
      supabase.rpc('admin_list_users'),
      supabase.from('courses').select('id,code,name').order('code'),
      supabase.from('task_editors').select('user_id,course_id'),
    ])
    const err = u.error || c.error || g.error
    if (err) {
      $('uempty').hidden = false
      $('uempty').textContent = err.message
      return
    }
    users = u.data
    courses = c.data
    grants = g.data
    courseOf.clear()
    courses.forEach((x) => courseOf.set(x.id, x))
    render()
  }

  function roleText(u) {
    if (u.is_sup) return 'Super admin'
    if (u.is_adm) return 'Admin'
    const mine = grants.filter((g) => g.user_id === u.uid)
    if (!mine.length) return 'Student'
    if (mine.some((g) => g.course_id === null)) return 'Editor · All courses'
    const codes = mine.map((g) => courseOf.get(g.course_id)?.code ?? '?').sort()
    return `Editor · ${codes.join(', ')}`
  }

  function render() {
    const q = $('uq').value.trim().toLowerCase()
    const shown = users.filter((u) => `${u.name ?? ''} ${u.student_id}`.toLowerCase().includes(q))

    $('ulist').replaceChildren(...shown.map((u) => {
      const name = document.createElement('div')
      name.className = 'code'
      name.textContent = (u.name || '(no name)') + (u.uid === me.id ? ' (you)' : '')
      const sub = document.createElement('div')
      sub.className = 'cname'
      sub.textContent = `${u.student_id} · ${roleText(u)}`
      const info = document.createElement('div')
      info.className = 'info'
      info.append(name, sub)

      const btn = document.createElement('button')
      btn.textContent = 'Manage'
      btn.onclick = () => openUser(u.uid)

      const li = document.createElement('li')
      li.append(info, btn)
      return li
    }))
    $('uempty').hidden = shown.length > 0
    $('uempty').textContent = users.length ? 'No user matches your search.' : 'No users yet.'
  }

  const msg = (t) => { if ($('u-msg')) $('u-msg').textContent = t }

  async function refresh(uid) {
    await load()
    openUser(uid)
  }

  async function setGrant(uid, courseId, on) {
    let r
    if (on) {
      r = await supabase.from('task_editors').insert({ user_id: uid, course_id: courseId })
    } else {
      let q = supabase.from('task_editors').delete().eq('user_id', uid)
      q = courseId ? q.eq('course_id', courseId) : q.is('course_id', null)
      r = await q
    }
    if (r.error && r.error.code !== '23505') return msg(r.error.message)
    refresh(uid)
  }

  function openUser(uid) {
    const u = users.find((x) => x.uid === uid)
    if (!u) return udlg.close()
    const mine = grants.filter((g) => g.user_id === uid)
    const hasAll = mine.some((g) => g.course_id === null)
    const has = new Set(mine.map((g) => g.course_id).filter(Boolean))

    udlg.innerHTML = `
      <div class="dlg-body">
        <h3>${esc(u.name || '(no name)')}</h3>
        <p class="dlg-desc">Student ID: ${esc(u.student_id)} · ${esc(roleText(u))}<br>
          Joined ${new Date(u.joined_at).toLocaleDateString()}</p>

        ${u.is_adm ? '<p class="meta">Admins can already post tasks in every course.</p>' : `
        <h2>Can post tasks in</h2>
        <label class="check"><input type="checkbox" data-c="all"> All courses</label>
        ${courses.map((c) =>
          `<label class="check"><input type="checkbox" data-c="${c.id}"> ${esc(c.code)} — ${esc(c.name)}</label>`
        ).join('')}`}

        ${isSuper ? `
        <h2>Account</h2>
        <div class="row"><input id="u-name" maxlength="60" placeholder="Display name" /><button id="u-rename">Rename</button></div>
        ${u.is_sup ? '' : `
        <button id="u-admin">${u.is_adm ? 'Remove admin' : 'Make admin'}</button>
        <button id="u-del" class="danger">Delete user</button>`}` : ''}

        <p class="msg" id="u-msg"></p>
        <div class="dlg-actions"><button id="u-close" class="ghost">Close</button></div>
      </div>`

    $('u-close').onclick = () => udlg.close()

    udlg.querySelectorAll('input[data-c]').forEach((box) => {
      const isAll = box.dataset.c === 'all'
      box.checked = isAll ? hasAll : has.has(box.dataset.c)
      box.disabled = !isAll && hasAll // "All courses" already covers these
      box.onchange = () => setGrant(uid, isAll ? null : box.dataset.c, box.checked)
    })

    if (isSuper) {
      $('u-name').value = u.name ?? ''
      $('u-rename').onclick = async () => {
        const name = $('u-name').value.trim()
        if (!name) return msg('Name cannot be empty.')
        const { data, error } = await supabase.from('profiles')
          .update({ display_name: name }).eq('user_id', uid).select('user_id')
        if (error || !data?.length) return msg(error?.message ?? 'Could not rename (this user has no profile row).')
        refresh(uid)
      }
      if (!u.is_sup) {
        $('u-admin').onclick = async () => {
          const { error } = await supabase.rpc('set_admin', { target: uid, make_admin: !u.is_adm })
          if (error) return msg(error.message)
          refresh(uid)
        }
        $('u-del').onclick = async () => {
          if (!confirm(`Delete ${u.name || u.student_id}? This removes their account for good.`)) return
          const { error } = await supabase.rpc('delete_user', { target: uid })
          if (error) return msg(error.message)
          udlg.close()
          load()
        }
      }
    }

    if (!udlg.open) udlg.showModal()
  }

  $('uq').oninput = render
  load()
}
