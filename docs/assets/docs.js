/* ───────────────────────────────────────────────────────────────────────────
   Jomma documentation — theme, navigation, copy buttons, highlighting.

   Deliberately dependency-free. The site is plain files served by GitHub Pages,
   so it works offline and cannot break because someone else's CDN went down.
   ─────────────────────────────────────────────────────────────────────────── */

/* ── Theme ────────────────────────────────────────────────────────────────
   Three states, cycled: auto → light → dark. `auto` defers to the OS. The
   choice is stored, so a reader who picks one keeps it across pages. */
;(() => {
  const root = document.documentElement
  const btn = document.getElementById('theme-btn')
  if (!btn) return

  const LABEL = { auto: 'Theme: follows your system', light: 'Theme: light', dark: 'Theme: dark' }

  const paint = () => {
    const theme = root.getAttribute('data-theme') || 'auto'
    btn.title = LABEL[theme]
    btn.setAttribute('aria-label', LABEL[theme])
    for (const icon of btn.querySelectorAll('[data-theme-icon]')) {
      icon.style.display = icon.dataset.themeIcon === theme ? '' : 'none'
    }
  }
  paint()

  btn.addEventListener('click', () => {
    const order = ['auto', 'light', 'dark']
    const next =
      order[(order.indexOf(root.getAttribute('data-theme') || 'auto') + 1) % order.length]
    root.setAttribute('data-theme', next)
    try {
      localStorage.setItem('jomma-theme', next)
    } catch {
      /* private mode; the choice just will not persist */
    }
    paint()
  })
})()

/* ── Mobile navigation ────────────────────────────────────────────────── */
;(() => {
  const toggle = document.getElementById('menu-toggle')
  const sidebar = document.getElementById('sidebar')
  if (!toggle || !sidebar) return

  toggle.addEventListener('click', () => {
    const open = sidebar.classList.toggle('open')
    toggle.setAttribute('aria-expanded', String(open))
  })
  sidebar.addEventListener('click', (event) => {
    if (event.target.tagName === 'A') {
      sidebar.classList.remove('open')
      toggle.setAttribute('aria-expanded', 'false')
    }
  })
})()

/* ── Syntax highlighting ──────────────────────────────────────────────────
   Small on purpose. Comments and strings are matched first and stashed behind
   a placeholder, so a keyword inside a string is not re-coloured.

   The placeholder is `@@zNz@@` rather than anything shorter because the number
   pass that runs later would otherwise match the bare index inside it, wrap it
   in a span, and leave the raw placeholder visible on the page. Padding the
   digits with a letter removes the word boundary that made that possible. */
const jommaHighlight = (() => {
  const KEYWORDS =
    /\b(import|from|export|const|let|var|async|await|function|return|if|else|new|throw|switch|case|break|default|true|false|null|undefined|curl|pnpm|node|npx)\b/g

  const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  return (text, lang) => {
    const slots = []
    const stash = (html) => {
      slots.push(html)
      return `@@z${slots.length - 1}z@@`
    }

    let out = text

    out = out.replace(
      /(^|[^:])\/\/[^\n]*/g,
      (m, pre) => pre + stash(`<span class="t-com">${escapeHtml(m.slice(pre.length))}</span>`),
    )
    if (lang === 'bash') {
      out = out.replace(/#[^\n]*/g, (m) => stash(`<span class="t-com">${escapeHtml(m)}</span>`))
    }
    out = out.replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, (m) =>
      stash(`<span class="t-str">${escapeHtml(m)}</span>`),
    )

    out = escapeHtml(out)

    if (lang === 'json') {
      // A stashed string followed by a colon is a key, not a value.
      out = out.replace(/@@z(\d+)z@@(\s*:)/g, (_, i, colon) => {
        slots[i] = slots[i].replace('t-str', 't-key')
        return `@@z${i}z@@${colon}`
      })
    }

    out = out.replace(/\b(\d[\d_.]*)\b/g, '<span class="t-num">$1</span>')
    if (lang !== 'json' && lang !== 'text' && lang !== 'http') {
      out = out.replace(KEYWORDS, '<span class="t-kw">$1</span>')
    }
    if (lang === 'typescript' || lang === 'javascript') {
      out = out.replace(/(?<![@\w])([a-zA-Z_$][\w$]*)(?=\()/g, '<span class="t-fn">$1</span>')
    }

    return out.replace(/@@z(\d+)z@@/g, (_, i) => slots[i])
  }
})()

/* ── Copy buttons ─────────────────────────────────────────────────────────
   `navigator.clipboard.writeText` rejects without document focus, and on any
   page served over plain http. Both are ordinary — a reader alt-tabbing away,
   or someone opening the file locally — and an unhandled rejection meant the
   button did nothing at all with no explanation. So: try the modern API, fall
   back to a selection copy, and say so either way. */
;(() => {
  const ICON_COPY =
    '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>'
  const ICON_DONE =
    '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12 5 5L20 6"/></svg>'

  const legacyCopy = (text) => {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
    document.body.appendChild(area)
    area.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    document.body.removeChild(area)
    return ok
  }

  const copyText = async (text) => {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch {
        /* no focus, or permission refused — fall through */
      }
    }
    return legacyCopy(text)
  }

  for (const block of document.querySelectorAll('.code')) {
    const lang = block.dataset.lang || 'text'
    const pre = block.querySelector('pre')
    const source = pre.textContent

    if (!block.classList.contains('bare')) {
      const head = document.createElement('div')
      head.className = 'code-head'
      head.innerHTML = `<span class="lang">${lang}</span>`

      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'copy'
      button.innerHTML = `${ICON_COPY}<span>Copy</span>`

      button.addEventListener('click', async () => {
        const ok = await copyText(source)
        const label = button.querySelector('span')
        button.classList.add(ok ? 'done' : 'fail')
        button.innerHTML = ok
          ? `${ICON_DONE}<span>Copied</span>`
          : `${ICON_COPY}<span>Press Ctrl+C</span>`
        if (!ok) {
          // Leave it selected so the keystroke actually has something to take.
          const range = document.createRange()
          range.selectNodeContents(pre)
          const selection = window.getSelection()
          selection.removeAllRanges()
          selection.addRange(range)
        }
        setTimeout(() => {
          button.classList.remove('done', 'fail')
          button.innerHTML = `${ICON_COPY}<span>Copy</span>`
          if (label) label.textContent = 'Copy'
        }, 2000)
      })

      head.appendChild(button)
      block.insertBefore(head, pre)
    }

    pre.innerHTML = jommaHighlight(source, lang)
  }
})()

/* ── Scrollspy ────────────────────────────────────────────────────────────
   rootMargin pins the trigger near the top of the viewport, so the highlighted
   entry is the section being read rather than whichever is largest on screen.
   Only in-page links participate; cross-page ones keep aria-current instead. */
;(() => {
  const links = new Map()
  for (const a of document.querySelectorAll('aside a[href^="#"]')) {
    links.set(a.getAttribute('href').slice(1), a)
  }
  if (links.size === 0) return

  const visible = new Set()
  const order = [...links.keys()]

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id)
        else visible.delete(entry.target.id)
      }
      const active = order.find((id) => visible.has(id))
      for (const id of order) links.get(id).classList.toggle('active', id === active)
    },
    { rootMargin: '-76px 0px -68% 0px', threshold: 0 },
  )

  for (const section of document.querySelectorAll('main section[id]')) observer.observe(section)
})()
