import { createEffect, onCleanup } from "solid-js"
import { fxSettings } from "./settings"

const TRAIL_MAX = 44
const TRAIL_LIFE = 560
const RING_EASE = 0.22
const DOT_EASE = 0.62

const INTERACTIVE = "button, a, [role='button'], input, textarea, select, [contenteditable='true'], summary"

type TrailPoint = {
  x: number
  y: number
  life: number
  hue: number
  radius: number
}

/**
 * Custom cursor, motion trail, click sound and press feedback.
 *
 * One element tree, one animation frame loop, listeners on `document` only.
 * Returns a disposer that removes every node and listener it added.
 */
export function startCursorFx(options: { sound: () => boolean }): () => void {
  if (typeof document === "undefined" || typeof window === "undefined") return () => {}

  const root = document.documentElement
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches

  root.dataset.fxCursor = "on"

  const layer = document.createElement("div")
  layer.id = "fx-cursor-layer"
  layer.setAttribute("aria-hidden", "true")

  const canvas = document.createElement("canvas")
  canvas.id = "fx-trail"

  const ring = document.createElement("div")
  ring.id = "fx-cursor-ring"

  const dot = document.createElement("div")
  dot.id = "fx-cursor-dot"

  layer.append(canvas, ring, dot)
  document.body.append(layer)

  const context = canvas.getContext("2d")

  let dpr = 1
  let width = 0
  let height = 0

  const sizeCanvas = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    width = window.innerWidth
    height = window.innerHeight
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
  }

  sizeCanvas()

  let pointerX = width / 2
  let pointerY = height / 2
  let ringX = pointerX
  let ringY = pointerY
  let dotX = pointerX
  let dotY = pointerY
  let hue = 208
  let running = true
  let frame = 0
  let last = performance.now()

  const trail: TrailPoint[] = []

  const audio = { context: undefined as AudioContext | undefined }

  const ensureAudio = () => {
    if (!audio.context) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

      if (!Ctor) return undefined
      audio.context = new Ctor()
    }

    if (audio.context.state === "suspended") void audio.context.resume()

    return audio.context
  }

  // A short pitched body plus a filtered noise transient: a "tick", not a beep.
  const playClick = () => {
    if (!options.sound()) return

    const ctx = ensureAudio()

    if (!ctx) return

    const now = ctx.currentTime
    const body = ctx.createOscillator()
    const bodyGain = ctx.createGain()

    body.type = "triangle"
    body.frequency.setValueAtTime(460, now)
    body.frequency.exponentialRampToValueAtTime(128, now + 0.055)
    bodyGain.gain.setValueAtTime(0.0001, now)
    bodyGain.gain.exponentialRampToValueAtTime(0.13, now + 0.004)
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.085)
    body.connect(bodyGain).connect(ctx.destination)
    body.start(now)
    body.stop(now + 0.1)

    const length = Math.max(1, Math.floor(ctx.sampleRate * 0.018))
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)

    for (let i = 0; i < length; i += 1) {
      const decay = 1 - i / length
      data[i] = (Math.random() * 2 - 1) * decay * decay * decay
    }

    const noise = ctx.createBufferSource()
    const highpass = ctx.createBiquadFilter()
    const noiseGain = ctx.createGain()

    noise.buffer = buffer
    highpass.type = "highpass"
    highpass.frequency.value = 2100
    noiseGain.gain.value = 0.085
    noise.connect(highpass).connect(noiseGain).connect(ctx.destination)
    noise.start(now)
  }

  const spawnRipple = (x: number, y: number) => {
    const ripple = document.createElement("span")

    ripple.className = "fx-ripple"
    ripple.style.left = `${x}px`
    ripple.style.top = `${y}px`
    document.body.append(ripple)

    const remove = () => ripple.remove()

    ripple.addEventListener("animationend", remove, { once: true })
    window.setTimeout(remove, 900)
  }

  const onPointerMove = (event: PointerEvent) => {
    pointerX = event.clientX
    pointerY = event.clientY
    hue = (hue + 0.55) % 360

    layer.dataset.hidden = "false"

    if (reduceMotion) return

    trail.push({
      x: pointerX,
      y: pointerY,
      life: TRAIL_LIFE,
      hue,
      radius: 9 + Math.random() * 5,
    })

    if (trail.length > TRAIL_MAX) trail.shift()
  }

  const onPointerDown = (event: PointerEvent) => {
    ring.classList.add("is-down")
    spawnRipple(event.clientX, event.clientY)
    playClick()

    const target = event.target instanceof Element ? event.target : null
    const interactive = target?.closest<HTMLElement>(INTERACTIVE) ?? null

    if (!interactive || reduceMotion) return

    interactive.classList.remove("fx-press")
    // Forcing a reflow restarts the animation when the same button is hit twice in a row.
    void interactive.offsetWidth
    interactive.classList.add("fx-press")
  }

  const onPointerUp = () => ring.classList.remove("is-down")

  const onPointerOver = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target : null
    const hot = !!target?.closest(INTERACTIVE)

    if (hot === ring.classList.contains("is-hot")) return

    ring.classList.toggle("is-hot", hot)
  }

  const onPointerLeave = () => {
    layer.dataset.hidden = "true"
    ring.classList.remove("is-hot", "is-down")
  }

  const onPointerEnter = () => {
    layer.dataset.hidden = "false"
  }

  const onWindowBlur = () => {
    ring.classList.remove("is-down")
    layer.dataset.hidden = "true"
  }

  const drawTrail = () => {
    if (!context) return

    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, width, height)
    context.globalCompositeOperation = "lighter"

    for (const point of trail) {
      const strength = point.life / TRAIL_LIFE

      if (strength <= 0) continue

      const radius = point.radius + 14 * (1 - strength)
      const gradient = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius)

      gradient.addColorStop(0, `hsla(${point.hue} 100% 74% / ${0.42 * strength})`)
      gradient.addColorStop(0.55, `hsla(${point.hue} 100% 62% / ${0.16 * strength})`)
      gradient.addColorStop(1, `hsla(${point.hue} 100% 58% / 0)`)
      context.fillStyle = gradient
      context.beginPath()
      context.arc(point.x, point.y, radius, 0, Math.PI * 2)
      context.fill()
    }

    context.globalCompositeOperation = "source-over"
  }

  const tick = (now: number) => {
    if (!running) return

    const delta = Math.min(now - last, 64)

    last = now

    ringX += (pointerX - ringX) * RING_EASE
    ringY += (pointerY - ringY) * RING_EASE
    dotX += (pointerX - dotX) * DOT_EASE
    dotY += (pointerY - dotY) * DOT_EASE

    ring.style.transform = `translate3d(${ringX}px, ${ringY}px, 0) translate(-50%, -50%) scale(var(--fx-ring-scale))`
    dot.style.transform = `translate3d(${dotX}px, ${dotY}px, 0) translate(-50%, -50%)`

    for (let i = trail.length - 1; i >= 0; i -= 1) {
      trail[i].life -= delta

      if (trail[i].life <= 0) trail.splice(i, 1)
    }

    drawTrail()

    frame = window.requestAnimationFrame(tick)
  }

  document.addEventListener("pointermove", onPointerMove, { passive: true })
  document.addEventListener("pointerdown", onPointerDown, { passive: true })
  document.addEventListener("pointerup", onPointerUp, { passive: true })
  document.addEventListener("pointerover", onPointerOver, { passive: true })
  document.addEventListener("pointerleave", onPointerLeave, { passive: true })
  document.addEventListener("pointerenter", onPointerEnter, { passive: true })
  window.addEventListener("resize", sizeCanvas)
  window.addEventListener("blur", onWindowBlur)

  frame = window.requestAnimationFrame(tick)

  return () => {
    running = false
    window.cancelAnimationFrame(frame)

    document.removeEventListener("pointermove", onPointerMove)
    document.removeEventListener("pointerdown", onPointerDown)
    document.removeEventListener("pointerup", onPointerUp)
    document.removeEventListener("pointerover", onPointerOver)
    document.removeEventListener("pointerleave", onPointerLeave)
    document.removeEventListener("pointerenter", onPointerEnter)
    window.removeEventListener("resize", sizeCanvas)
    window.removeEventListener("blur", onWindowBlur)

    layer.remove()
    delete root.dataset.fxCursor

    void audio.context?.close().catch(() => undefined)
    audio.context = undefined
  }
}

/** Mounts the cursor effects while the setting is on, and tears them down the moment it goes off. */
export function CursorFx() {
  let stop: (() => void) | undefined

  createEffect(() => {
    const enabled = fxSettings().cursor

    if (enabled && !stop) {
      stop = startCursorFx({ sound: () => fxSettings().sound })

      return
    }

    if (!enabled && stop) {
      stop()
      stop = undefined
    }
  })

  onCleanup(() => {
    stop?.()
    stop = undefined
  })

  return null
}
