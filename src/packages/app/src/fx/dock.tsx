import { For, createSignal } from "solid-js"
import { COMMAND_SEARCH_ID, useCommand } from "@/shell/commands/command"
import { useSettingsSurface } from "@/settings/surface"
import { fxSettings, setFxSetting } from "./settings"

const DOCK_KEY = "focuscode.fx.dock"

function readOpen() {
  if (typeof localStorage === "undefined") return true

  try {
    return localStorage.getItem(DOCK_KEY) !== "closed"
  } catch {
    return true
  }
}

/**
 * The bottom bar. A pill at the bottom edge; the arrow pulls it open and pushes
 * it away, and every control in it is a switch or a shortcut that already exists
 * elsewhere in the app.
 */
export function BottomDock() {
  const command = useCommand()
  const settings = useSettingsSurface()
  const [open, setOpen] = createSignal(readOpen())

  const toggle = () => {
    const next = !open()

    setOpen(next)

    try {
      localStorage.setItem(DOCK_KEY, next ? "open" : "closed")
    } catch {
      // Session-only is fine.
    }
  }

  const toggles = [
    { key: "gradient" as const, label: "Gradient", on: () => fxSettings().gradient },
    { key: "cursor" as const, label: "Curseur", on: () => fxSettings().cursor },
    { key: "sound" as const, label: "Son", on: () => fxSettings().sound },
  ]

  const actions = [
    { label: "Commandes", run: () => command.trigger(COMMAND_SEARCH_ID, "palette") },
    { label: "Réglages", run: () => settings.open() },
    { label: "Barre latérale", run: () => command.trigger("sidebar.toggle", "palette") },
  ]

  return (
    <div data-component="fx-dock" class="fx-dock" data-open={open() ? "true" : "false"}>
      <div class="fx-dock-panel">
        <For each={toggles}>
          {(item) => (
            <button
              type="button"
              data-no-fx
              class="fx-dock-item"
              data-on={item.on() ? "true" : "false"}
              aria-pressed={item.on()}
              onClick={() => setFxSetting(item.key, !item.on())}
            >
              <span class="fx-dock-led" />
              {item.label}
            </button>
          )}
        </For>
        <span class="fx-dock-sep" />
        <For each={actions}>
          {(item) => (
            <button type="button" data-no-fx class="fx-dock-item" onClick={item.run}>
              {item.label}
            </button>
          )}
        </For>
      </div>
      <button
        type="button"
        data-no-fx
        class="fx-dock-handle"
        aria-expanded={open()}
        aria-label={open() ? "Replier la barre" : "Déplier la barre"}
        onClick={toggle}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>
  )
}
