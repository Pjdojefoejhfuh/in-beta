import { createEffect } from "solid-js"
import { CursorFx } from "./cursor"
import { BottomDock } from "./dock"
import { fxSettings } from "./settings"

/**
 * One mount point for the visual layer. Kept last in the shell so the cursor
 * surface and the dock sit above every panel without reordering any of them.
 */
export function FxLayer() {
  createEffect(() => {
    document.documentElement.dataset.fxGradient = fxSettings().gradient ? "on" : "off"
  })

  return (
    <>
      <CursorFx />
      <BottomDock />
    </>
  )
}
