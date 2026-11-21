import { For } from "solid-js"

/**
 * ANSI Shadow letterforms, six rows each. Letters are laid out as separate
 * blocks instead of one joined string so a glyph that is a column narrower
 * cannot drag the rest of the row out of alignment.
 */
const GLYPHS: Record<string, readonly string[]> = {
  A: [
    " █████╗ ",
    "██╔══██╗",
    "███████║",
    "██╔══██║",
    "██║  ██║",
    "╚═╝  ╚═╝",
  ],
  C: [
    " ██████╗",
    "██╔════╝",
    "██║     ",
    "██║     ",
    "╚██████╗",
    " ╚═════╝",
  ],
  D: [
    "██████╗ ",
    "██╔══██╗",
    "██║  ██║",
    "██║  ██║",
    "██████╔╝",
    "╚═════╝ ",
  ],
  E: [
    "███████╗",
    "██╔════╝",
    "█████╗  ",
    "██╔══╝  ",
    "███████╗",
    "╚══════╝",
  ],
  F: [
    "███████╗",
    "██╔════╝",
    "█████╗  ",
    "██╔══╝  ",
    "██║     ",
    "╚═╝     ",
  ],
  O: [
    " ██████╗ ",
    "██╔═══██╗",
    "██║   ██║",
    "██║   ██║",
    "╚██████╔╝",
    " ╚═════╝ ",
  ],
  S: [
    "███████╗",
    "██╔════╝",
    "███████╗",
    "╚════██║",
    "███████║",
    "╚══════╝",
  ],
  U: [
    "██╗   ██╗",
    "██║   ██║",
    "██║   ██║",
    "██║   ██║",
    "╚██████╔╝",
    " ╚═════╝ ",
  ],
  " ": ["  ", "  ", "  ", "  ", "  ", "  "],
}

const BLANK = ["     ", "     ", "     ", "     ", "     ", "     "] as const

function rowsFor(character: string) {
  return GLYPHS[character.toUpperCase()] ?? BLANK
}

/** The big wordmark on the new-session screen, drawn as ASCII rather than an SVG path set. */
export function AsciiTitle(props: {
  text?: string
  class?: string
  ref?: (element: HTMLDivElement) => void
}) {
  const text = () => props.text ?? "FOCUSCODE"

  return (
    <div
      ref={(element) => props.ref?.(element)}
      data-component="fx-ascii-title"
      role="img"
      aria-label={text()}
      class={props.class}
    >
      <For each={[...text()]}>{(character) => <pre>{rowsFor(character).join("\n")}</pre>}</For>
    </div>
  )
}
