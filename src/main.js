import './style.css'
import { supabase } from './supabase'

const app = document.querySelector('#app')
const $ = (id) => document.getElementById(id)
const toEmail = (sid) => `${sid.trim().toLowerCase()}@students.example.com`

function showAuth() {
  app.innerHTML = `
    <h1>Class To-Do</h1>
    <input id="name" placeholder="Full name (signup only)" />
    <input id="sid" placeholder="Student ID" />
    <input id="pw" type="password" placeholder="Password (6+ characters)" />
    <button id="login">Log in</button>
    <button id="signup">Sign up</button>
    <p id="msg"></p>`
  const msg = (t) => ($('msg').textContent = t)

  $('login').onclick = async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email: toEmail($('sid').value),
      password: $('pw').value,
    })
    if (error) msg(error.message)
  }

  $('signup').onclick = async () => {
    const name = $('name').value.trim()
    if (!name) return msg('Enter your name')
    const { data, error } = await supabase.auth.signUp({
      email: toEmail($('sid').value),
      password: $('pw').value,
    })
    if (error) return msg(error.message)
    const { error: pErr } = await supabase.from('profiles').insert({ display_name: name })
    if (pErr) return msg(pErr.message)
    render(data.session)
  }
}

async function showApp(user) {
  const { data: profile } = await supabase
    .from('profiles').select('display_name').eq('user_id', user.id).maybeSingle()
  app.innerHTML = `<h1 id="hi"></h1><button id="logout">Log out</button>`
  $('hi').textContent = `Hi, ${profile?.display_name ?? ''}`
  $('logout').onclick = () => supabase.auth.signOut()
}

async function render(session) {
  session ? await showApp(session.user) : showAuth()
}

supabase.auth.onAuthStateChange((_event, session) => {
  setTimeout(() => render(session), 0)
})
