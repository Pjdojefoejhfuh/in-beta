import { createSignal } from "solid-js"

/** Every switch the FX layer exposes. Persisted per machine, not per project. */
export type FxSettings = {
  gradient: boolean
  cursor: boolean
  sound: boolean
}

const STORAGE_KEY = "focuscode.fx.v1"

const DEFAULTS: FxSettings = { gradient: true, cursor: true, sound: true }

function read(): FxSettings {
  if (typeof localStorage === "undefined") return { ...DEFAULTS }

  try {
    const raw = localStorage.getItem(STORAGE_KEY)

    if (!raw) return { ...DEFAULTS }

    const parsed = JSON.parse(raw) as Partial<FxSettings>

    return {
      gradient: typeof parsed.gradient === "boolean" ? parsed.gradient : DEFAULTS.gradient,
      cursor: typeof parsed.cursor === "boolean" ? parsed.cursor : DEFAULTS.cursor,
      sound: typeof parsed.sound === "boolean" ? parsed.sound : DEFAULTS.sound,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

const [state, setState] = createSignal<FxSettings>(read())

export const fxSettings = state

export function setFxSetting<K extends keyof FxSettings>(key: K, value: FxSettings[K]) {
  const next = { ...state(), [key]: value }

  setState(next)

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // A locked-down profile still gets the effect for this session; it just forgets it next launch.
  }
}

export function toggleFxSetting(key: keyof FxSettings) {
  setFxSetting(key, !state()[key])
}
