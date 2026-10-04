import { supabase } from './supabase'

const VAPID_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

export const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

export function registerSW() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(console.error)
}

function keyBytes(b64url) {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4)
  const raw = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

async function current() {
  const reg = await navigator.serviceWorker.ready
  return { reg, sub: await reg.pushManager.getSubscription() }
}

async function save(sub) {
  const j = sub.toJSON()
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: j.endpoint,
    p_p256dh: j.keys.p256dh,
    p_auth: j.keys.auth,
  })
  if (error) throw error
}

// 'unsupported' | 'blocked' | 'off' | 'on'
export async function pushState() {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  if (Notification.permission !== 'granted') return 'off'
  const { sub } = await current()
  return sub ? 'on' : 'off'
}

export async function enablePush() {
  if (!VAPID_KEY) throw new Error('VITE_VAPID_PUBLIC_KEY was missing when the app was built.')
  if ((await Notification.requestPermission()) !== 'granted') {
    throw new Error('Notifications were not allowed.')
  }
  const { reg, sub } = await current()
  await save(sub ?? (await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(VAPID_KEY),
  })))
}

export async function disablePush() {
  const { sub } = await current()
  if (!sub) return
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe()
}

// After login: attach this device to whoever is logged in now
export async function syncPush() {
  if ((await pushState()) !== 'on') return
  const { sub } = await current()
  await save(sub).catch(console.error)
}

// On logout: this device stops receiving the previous user's notifications
export async function forgetDevice() {
  if (!pushSupported() || Notification.permission !== 'granted') return
  const { sub } = await current()
  if (sub) await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
}
