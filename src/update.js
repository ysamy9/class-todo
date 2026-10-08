// Tells users a newer build is live, checked when the app returns to the foreground
const assetOf = (html) => html.match(/assets\/index-[^"']+\.js/)?.[0]

export function watchForUpdates() {
  const loaded = assetOf([...document.scripts].map((s) => s.src).join(' '))
  if (!loaded) return // dev server has no hashed bundle
  let shown = false

  async function check() {
    if (shown) return
    try {
      const res = await fetch('/', { cache: 'no-store' })
      if (assetOf(await res.text()) === loaded) return
    } catch {
      return
    }
    shown = true
    const bar = document.createElement('div')
    bar.className = 'update-bar'
    bar.append('New version available. ')
    const btn = document.createElement('button')
    btn.textContent = 'Refresh'
    btn.onclick = () => location.reload()
    bar.append(btn)
    document.body.append(bar)
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden) check() })
  setInterval(check, 5 * 60 * 1000)
}
