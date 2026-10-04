import { supabase } from './supabase'
import { openCourse } from './schedule'

const $ = (id) => document.getElementById(id)

// ctx = { me, isAdmin, isSuper, can(courseId) }
export async function mountCourses(user, ctx) {
  $('view').innerHTML = `
    <h2>Courses</h2>
    ${ctx.isSuper ? `
    <details class="add" id="cadd">
      <summary>+ New course</summary>
      <form id="add">
        <div class="row">
          <input id="ccode" placeholder="Code (e.g. WAVES)" required maxlength="20" />
          <input id="cname" placeholder="Course name" required maxlength="100" />
        </div>
        <p class="msg" id="cmsg"></p>
        <button id="cbtn">Add course</button>
      </form>
    </details>` : ''}
    <input id="q" placeholder="Search by code or name..." />
    <ul class="courses" id="clist"></ul>
    <p class="empty" id="cempty" hidden></p>`

  let courses = []
  let mine = new Set()

  async function load() {
    if (!$('clist')) return
    const [c, e] = await Promise.all([
      supabase.from('courses').select('id,code,name').order('code'),
      supabase.from('enrollments').select('course_id'),
    ])
    if (c.error || e.error) return console.error(c.error || e.error)
    courses = c.data
    mine = new Set(e.data.map((r) => r.course_id))
    render()
  }

  async function toggle(course) {
    const { error } = mine.has(course.id)
      ? await supabase.from('enrollments').delete()
          .eq('user_id', user.id).eq('course_id', course.id)
      : await supabase.from('enrollments').insert({ course_id: course.id })
    if (error) return console.error(error)
    load()
  }

  function render() {
    const q = $('q').value.trim().toLowerCase()
    const shown = courses
      .filter((c) => `${c.code} ${c.name}`.toLowerCase().includes(q))
      .sort((a, b) => mine.has(b.id) - mine.has(a.id)) // enrolled first

    $('clist').replaceChildren(...shown.map((c) => {
      const code = document.createElement('div')
      code.className = 'code'
      code.textContent = c.code
      const name = document.createElement('div')
      name.className = 'cname'
      name.textContent = c.name
      const info = document.createElement('div')
      info.className = 'info'
      info.style.cursor = 'pointer'
      info.title = 'Timetable and details'
      info.append(code, name)
      info.onclick = () => openCourse(ctx, c, load) // timetable + (super admin) rename/delete

      const btn = document.createElement('button')
      const on = mine.has(c.id)
      btn.className = on ? 'on' : ''
      btn.textContent = on ? 'Enrolled ✓' : 'Enroll'
      btn.onclick = () => toggle(c)

      const li = document.createElement('li')
      li.append(info, btn)
      return li
    }))

    $('cempty').hidden = shown.length > 0
    $('cempty').textContent = courses.length ? 'No course matches your search.' : 'No courses yet.'
  }

  if (ctx.isSuper) {
    $('add').onsubmit = async (e) => {
      e.preventDefault()
      $('cmsg').textContent = ''
      $('cbtn').disabled = true
      const { error } = await supabase.from('courses').insert({
        code: $('ccode').value.trim().toUpperCase(),
        name: $('cname').value.trim(),
      })
      $('cbtn').disabled = false
      if (error) {
        $('cmsg').textContent = error.code === '23505' ? 'That course code already exists.' : error.message
        return
      }
      e.target.reset()
      $('cadd').open = false
      load()
    }
  }

  $('q').oninput = render
  load()
}
