import './style.css'
import { supabase } from './supabase'
import { mountTasks } from './tasks'

const app = document.querySelector('#app')
const $ = (id) => document.getElementById(id)
const toEmail = (sid) => `${sid.trim().toLowerCase()}@students.example.com`

function showAuth() {
  let mode = 'login'
  app.innerHTML = `
    <div class="auth">
      <div class="auth-logo">✓</div>
      <h1>Class To-Do</h1>
      <p class="sub">Every assignment, one shared list.</p>
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
        shownFor = null // force a redraw now that the profile exists
        render(data.session)
      }
    } finally {
      if ($('submit')) $('submit').disabled = false
    }
  }
}

async function showApp(user) {
  const { data: profile } = await supabase
    .from('profiles').select('display_name').eq('user_id', user.id).maybeSingle()
  const name = profile?.display_name ?? ''
  app.innerHTML = `
    <header class="top">
      <div>
        <p class="hello">Welcome back</p>
        <h1 id="hi"></h1>
      </div>
      <div class="top-actions">
        <span class="avatar" id="avatar"></span>
        <button id="logout" class="ghost">Log out</button>
      </div>
    </header>
    <div id="tasks"></div>`
  $('hi').textContent = name
  $('avatar').textContent = (name[0] ?? '?').toUpperCase()
  $('logout').onclick = () => supabase.auth.signOut()
  mountTasks(user)
}

let shownFor = null
async function render(session) {
  const id = session?.user.id ?? null
  if (id && id === shownFor) return // already showing this user: don't wipe the screen
  shownFor = id
  session ? await showApp(session.user) : showAuth()
}

supabase.auth.onAuthStateChange((_event, session) => {
  setTimeout(() => render(session), 0)
})
