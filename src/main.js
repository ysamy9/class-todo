import './style.css'
import { supabase } from './supabase'
import { mountTasks } from './tasks'
import { mountCourses } from './courses'
import { mountUsers } from './users'
import { mountTimetable } from './timetable'
import { registerSW, pushState, enablePush, disablePush, syncPush, forgetDevice } from './push'

registerSW()

const app = document.querySelector('#app')
const $ = (id) => document.getElementById(id)
const toEmail = (sid) => `${sid.trim().toLowerCase()}@students.example.com`

function showAuth() {
  let mode = 'login'
  app.innerHTML = `
    <div class="auth">
      <div class="auth-logo">✓</div>
      <h1>Class To-Do</h1>
      <p class="sub">Every assignment, one shared list. testing</p>
      <div class="tabs">
        <button type="button" id="tab-login" class="tab active">Log in</button>
        <button type="button" id="tab-signup" class="tab">Sign up</button>
      </div>
      <form id="auth-form">
        <input id="name" placeholder="Full name" autocomplete="name" hidden />
        <input id="sid" placeholder="Student ID" autocomplete="username" required />
        <input id="pw" type="password" placeholder="Password (6+ characters)" autocomplete="current-password" required />
        <button id="submit">Log in</button>
        <p id="msg" class="msg"></p>
      </form>
    </div>`

  const setMode = (m) => {
    mode = m
    $('tab-login').classList.toggle('active', m === 'login')
    $('tab-signup').classList.toggle('active', m === 'signup')
    $('name').hidden = m === 'login'
    $('name').required = m === 'signup'
    $('pw').autocomplete = m === 'login' ? 'current-password' : 'new-password'
    $('submit').textContent = m === 'login' ? 'Log in' : 'Create account'
    $('msg').textContent = ''
  }
  $('tab-login').onclick = () => setMode('login')
  $('tab-signup').onclick = () => setMode('signup')

  $('auth-form').onsubmit = async (e) => {
    e.preventDefault()
    const msg = (t) => ($('msg').textContent = t)
    const creds = { email: toEmail($('sid').value), password: $('pw').value }
    $('submit').disabled = true
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword(creds)
        if (error) msg(error.message)
      } else {
        const { data, error } = await supabase.auth.signUp(creds)
        if (error) return msg(error.message)
        const { error: pErr } = await supabase
          .from('profiles').insert({ display_name: $('name').value.trim() })
        if (pErr) return msg(pErr.message)
        shownFor = null
        render(data.session)
      }
    } finally {
      if ($('submit')) $('submit').disabled = false
    }
  }
}

async function showApp(user) {
  const [{ data: profile }, { data: adminRow }, { data: grants }] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('user_id', user.id).maybeSingle(),
    supabase.from('admins').select('user_id,is_super').eq('user_id', user.id).maybeSingle(),
    // filter by user: admins can read everyone's grants
    supabase.from('task_editors').select('course_id').eq('user_id', user.id),
  ])
  const name = profile?.display_name ?? ''
  const isAdmin = !!adminRow
  const isSuper = !!adminRow?.is_super
  const perms = {
    all: isAdmin || (grants ?? []).some((g) => g.course_id === null),
    courses: new Set((grants ?? []).map((g) => g.course_id).filter(Boolean)),
  }
  const ctx = {
    me: user,
    isAdmin,
    isSuper,
    perms,
    can: (courseId) => perms.all || perms.courses.has(courseId),
  }

  app.innerHTML = `
    <header class="top">
      <div>
        <p class="hello" id="hello"></p>
        <h1 id="hi"></h1>
      </div>
      <div class="top-actions">
        <button id="bell" class="ghost" title="Notifications">🔕</button>
        <span class="avatar" id="avatar"></span>
        <button id="logout" class="ghost">Log out</button>
      </div>
    </header>
    <nav class="tabs nav">
      <button type="button" id="nav-tasks" class="tab">Tasks</button>
      <button type="button" id="nav-timetable" class="tab">Timetable</button>
      <button type="button" id="nav-courses" class="tab active">Courses</button>
      ${isAdmin ? '<button type="button" id="nav-users" class="tab">Users</button>' : ''}
    </nav>
    <div id="view"></div>`
  $('hello').textContent = isSuper ? 'Welcome back · Super admin' : isAdmin ? 'Welcome back · Admin' : 'Welcome back'
  $('hi').textContent = name
  $('avatar').textContent = (name[0] ?? '?').toUpperCase()
  $('logout').onclick = async () => {
    await forgetDevice().catch(() => {})
    supabase.auth.signOut()
  }

  async function refreshBell() {
    const s = await pushState()
    $('bell').textContent = s === 'on' ? '🔔' : '🔕'
    $('bell').title = s === 'on' ? 'Notifications on (tap to turn off)' : 'Turn on notifications'
  }
  $('bell').onclick = async () => {
    try {
      const s = await pushState()
      if (s === 'unsupported') {
        alert('To get notifications on iPhone: open this site in Safari, tap Share → Add to Home Screen, then open the app from its icon and tap the bell again.')
      } else if (s === 'blocked') {
        alert('Notifications are blocked for this site. Allow them in your browser or phone settings, then tap the bell again.')
      } else if (s === 'on') {
        await disablePush()
      } else {
        await enablePush()
      }
    } catch (e) {
      alert(e.message)
    }
    refreshBell()
  }
  refreshBell()
  syncPush()

  const go = (view) => {
    $('nav-tasks').classList.toggle('active', view === 'tasks')
    $('nav-timetable').classList.toggle('active', view === 'timetable')
    $('nav-courses').classList.toggle('active', view === 'courses')
    $('nav-users')?.classList.toggle('active', view === 'users')
    if (view === 'tasks') {
      $('view').innerHTML = '<div id="tasks"></div>'
      mountTasks(user, perms)
    } else if (view === 'timetable') {
      mountTimetable(ctx)
    } else if (view === 'users') {
      mountUsers(user, isSuper)
    } else {
      mountCourses(user, ctx)
    }
  }
  $('nav-tasks').onclick = () => go('tasks')
  $('nav-timetable').onclick = () => go('timetable')
  $('nav-courses').onclick = () => go('courses')
  if (isAdmin) $('nav-users').onclick = () => go('users')
  go('tasks')
}

let shownFor = null
async function render(session) {
  const id = session?.user.id ?? null
  if (id && id === shownFor) return
  shownFor = id
  session ? await showApp(session.user) : showAuth()
}

supabase.auth.onAuthStateChange((_event, session) => {
  setTimeout(() => render(session), 0)
})
}
