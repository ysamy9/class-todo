// Sends web-push notifications.
//   { mode: 'new_task', task_id }  -> tell students enrolled in the task's course
//   { mode: 'due' }                -> remind enrolled students about tasks due today / tomorrow
//   { mode: 'schedule_change', change_id } -> tell enrolled students about a one-time timetable change
// Called only by the database (trigger + cron) with the x-webhook-secret header.
// Deploy with:  supabase functions deploy notify --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

// "Today" and "tomorrow" for deadline reminders are computed in this timezone.
// Change it if your classmates are somewhere else (any IANA name, e.g. 'Europe/London').
const APP_TIMEZONE = 'Africa/Cairo'

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT')!,
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
)

type Sub = { user_id: string; endpoint: string; p256dh: string; auth: string }

async function subsFor(userIds: string[]): Promise<Sub[]> {
  if (!userIds.length) return []
  const { data, error } = await sb
    .from('push_subscriptions')
    .select('user_id,endpoint,p256dh,auth')
    .in('user_id', userIds)
  if (error) throw error
  return data ?? []
}

async function send(subs: Sub[], payload: Record<string, unknown>) {
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
      )
    } catch (e: any) {
      // 404/410 = the device unsubscribed or the app was removed: forget it
      if (e.statusCode === 404 || e.statusCode === 410) {
        await sb.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
      } else {
        console.error('push failed', e.statusCode, e.body)
      }
    }
  }))
}

async function enrolledUserIds(courseId: string): Promise<string[]> {
  const { data, error } = await sb.from('enrollments').select('user_id').eq('course_id', courseId)
  if (error) throw error
  return (data ?? []).map((r) => r.user_id)
}

async function notifyNewTask(taskId: string | number) {
  const { data: task, error } = await sb
    .from('tasks')
    .select('*, courses(code,name)')
    .eq('id', taskId)
    .single()
  if (error) throw error

  // Don't notify the person who posted it (works if the author column is user_id or created_by)
  const author = task.created_by ?? task.user_id ?? null
  const ids = (await enrolledUserIds(task.course_id)).filter((id) => id !== author)
  const subs = await subsFor(ids)

  await send(subs, {
    title: `${task.courses?.code ?? 'Course'}: new task`,
    body: task.due ? `${task.title} (due ${task.due})` : task.title,
    url: '/',
  })
}

const KIND: Record<string, string> = { lecture: 'Lecture', lab: 'Lab', tutorial: 'Tutorial' }

function dateLabel(s: string) {
  return new Date(`${s}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  })
}

// A one-time timetable change was saved: tell students enrolled in that course
async function notifyScheduleChange(changeId: string) {
  const { data: ch, error } = await sb
    .from('session_changes')
    .select('*, sessions(kind, course_id, courses(code))')
    .eq('id', changeId)
    .single()
  if (error) throw error

  const kind = KIND[ch.sessions.kind] ?? 'Class'
  const code = ch.sessions.courses?.code ?? 'Course'
  let what: string
  if (ch.status === 'cancelled') {
    what = `${kind} on ${dateLabel(ch.on_date)} is cancelled`
  } else {
    const parts: string[] = []
    if (ch.online) parts.push('online')
    if (ch.new_date && ch.new_date !== ch.on_date) parts.push(`moved to ${dateLabel(ch.new_date)}`)
    if (ch.new_start && ch.new_end) parts.push(`${ch.new_start.slice(0, 5)}-${ch.new_end.slice(0, 5)}`)
    if (ch.new_room) parts.push(`room ${ch.new_room}`)
    what = `${kind} on ${dateLabel(ch.on_date)}: ${parts.join(', ') || 'changed'}`
  }

  const subs = await subsFor(await enrolledUserIds(ch.sessions.course_id))
  await send(subs, {
    title: `${code}: schedule change`,
    body: ch.note ? `${what}. ${ch.note}` : what,
    url: '/',
  })
}

function todayAndTomorrow() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIMEZONE }).format(new Date()) // YYYY-MM-DD
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return { today, tomorrow: d.toISOString().slice(0, 10) }
}

async function notifyDue() {
  const { today, tomorrow } = todayAndTomorrow()
  const { data: tasks, error } = await sb
    .from('tasks')
    .select('id,title,due,course_id,courses(code)')
    .in('due', [today, tomorrow])
  if (error) throw error

  for (const task of tasks ?? []) {
    const kind = task.due === today ? 'today' : 'tomorrow'
    const taskId = String(task.id)

    const enrolled = await enrolledUserIds(task.course_id)
    if (!enrolled.length) continue

    // skip people who already finished or hid the task
    const { data: status } = await sb
      .from('task_status')
      .select('user_id,done,hidden')
      .eq('task_id', task.id)
      .in('user_id', enrolled)
    const skip = new Set((status ?? []).filter((r) => r.done || r.hidden).map((r) => r.user_id))

    // skip people who already got this reminder
    const { data: logged } = await sb
      .from('reminder_log')
      .select('user_id')
      .eq('task_id', taskId)
      .eq('kind', kind)
    const already = new Set((logged ?? []).map((r) => r.user_id))

    const recipients = enrolled.filter((id) => !skip.has(id) && !already.has(id))
    const subs = await subsFor(recipients)
    if (!subs.length) continue

    await send(subs, {
      title: `${task.courses?.code ?? 'Course'}: due ${kind}`,
      body: task.title,
      tag: `due-${taskId}`,
      url: '/',
    })

    const notified = [...new Set(subs.map((s) => s.user_id))]
    await sb.from('reminder_log').insert(
      notified.map((user_id) => ({ user_id, task_id: taskId, kind })),
    )
  }
}

Deno.serve(async (req) => {
  if (req.headers.get('x-webhook-secret') !== Deno.env.get('WEBHOOK_SECRET')) {
    return new Response('forbidden', { status: 403 })
  }
  try {
    const body = await req.json()
    if (body.mode === 'new_task') await notifyNewTask(body.task_id)
    else if (body.mode === 'due') await notifyDue()
    else if (body.mode === 'schedule_change') await notifyScheduleChange(body.change_id)
    else return new Response('unknown mode', { status: 400 })
    return new Response('ok')
  } catch (e: any) {
    console.error(e)
    return new Response(String(e?.message ?? e), { status: 500 })
  }
})
