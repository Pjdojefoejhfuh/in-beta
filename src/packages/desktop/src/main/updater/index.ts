import { BrowserWindow, app, net, screen } from "electron"
import { existsSync } from "node:fs"
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js"

/**
 * GitHub updater for FalseCode.
 *
 * Every 30 seconds, and once at startup, the latest commit of the repository is compared with the
 * commit the app last installed. A newer commit raises a popup; the install downloads that commit's
 * archive, synchronises the app payload (added, modified and deleted files), then relaunches.
 */
const OWNER = "Pjdojefoejhfuh"
const REPO = "in-beta"
const BRANCH = "main"
const POLL_MS = 30_000
/** A popup left alone long enough installs by itself. */
const AUTO_INSTALL_MS = 30_000
/** Install directory: the folder holding FalseCode.exe in a packaged app. */
const INSTALL_ROOT = app.isPackaged ? join(process.resourcesPath, "..") : process.cwd()

type State = {
  /** Commit the installed app was built from; absent until the first successful check. */
  installedSha?: string
  installedVersion?: string
  checkedAt?: number
  /** Set once a commit is installed so the popup does not return before relaunch. */
  pendingSha?: string
}

type Remote = {
  sha: string
  message: string
  date: string
}

let state: State = {}
let timer: NodeJS.Timeout | undefined
let installing = false
let popup: BrowserWindow | undefined
let overlay: BrowserWindow | undefined
let autoInstall: NodeJS.Timeout | undefined
const dismissed = new Set<string>()

const stateFile = () => join(app.getPath("userData"), "falsecode-updater.json")

function log(message: string, detail?: unknown) {
  if (detail === undefined) console.log(`[updater] ${message}`)
  else console.log(`[updater] ${message}`, detail)
}

function loadHtml(win: BrowserWindow, html: string) {
  const file = join(app.getPath("temp"), `falsecode-ui-${Date.now()}-${Math.random().toString(36).slice(2)}.html`)
  void writeFile(file, html, "utf8").then(() => win.loadFile(file)).catch((error) => log("loadHtml failed", error))
}

async function loadState() {
  try {
    state = JSON.parse(await readFile(stateFile(), "utf8")) as State
  } catch {
    state = {}
  }
  // A previous session may have left a pending commit uninstalled; re-evaluate it on this launch.
  state.pendingSha = undefined
}

async function saveState(next: Partial<State>) {
  state = { ...state, ...next }
  await mkdir(app.getPath("userData"), { recursive: true }).catch(() => undefined)
  await writeFile(stateFile(), JSON.stringify(state, null, 2), "utf8").catch(() => undefined)
}

function currentVersion() {
  return state.installedVersion ?? app.getVersion()
}

function short(sha: string) {
  return sha.slice(0, 7)
}

async function latestCommit(): Promise<Remote | undefined> {
  const response = await net.fetch(`https://api.github.com/repos/${OWNER}/${REPO}/commits/${BRANCH}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "FalseCode-Updater" },
    cache: "no-store",
  })

  // 409 is an empty repository; 404 means the branch does not exist yet. Neither is an update.
  if (response.status === 409 || response.status === 404) return undefined
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`)

  const body = (await response.json()) as {
    sha?: string
    commit?: { message?: string; committer?: { date?: string } }
  }
  if (!body.sha) return undefined

  return {
    sha: body.sha,
    message: body.commit?.message?.split("\n")[0] ?? "",
    date: body.commit?.committer?.date ?? new Date().toISOString(),
  }
}

function popupHtml(subtitle: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#1a1c20;font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden}
  .backdrop{position:fixed;inset:0;background:rgba(0,0,0,.0);display:flex;align-items:center;justify-content:center}
  .card{width:min(420px,88vw);background:#23252a;color:#e9eaec;border:1px solid #3a3d42;
    border-radius:14px;padding:20px 20px 16px;box-shadow:0 24px 60px rgba(0,0,0,.6);
    display:flex;flex-direction:column;gap:8px}
  .head{display:flex;align-items:center;justify-content:space-between}
  .brand{font-size:11px;letter-spacing:2.4px;color:#7a8088;text-transform:uppercase}
  .close{width:26px;height:26px;border:0;border-radius:7px;background:#2a2d32;color:#b7bcc2;
    font-size:15px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center}
  .close:hover{background:#34373d;color:#fff}
  h1{font-size:16px;font-weight:600;margin:6px 0 2px}
  .sub{font-size:12px;color:#9aa0a6;margin-bottom:6px}
  .row{display:flex;gap:10px;margin-top:10px}
  button{flex:1;height:36px;border:1px solid #3a3d42;border-radius:9px;font-size:13px;
    font-weight:600;cursor:pointer}
  .exit{background:#2a2d32;color:#cfd3d8}
  .exit:hover{background:#34373d}
  .update{background:#3a3d42;color:#f2f3f5}
  .update:hover{background:#4a4d52}
  </style></head><body>
  <div class="backdrop">
    <div class="card">
      <div class="head">
        <span class="brand">FalseCode Updater</span>
        <button class="close" id="x" aria-label="Close">×</button>
      </div>
      <h1>Updater Detected Version</h1>
      <div class="sub">${subtitle}</div>
      <div class="row">
        <button class="exit" id="exit">Exit</button>
        <button class="update" id="update">Update</button>
      </div>
    </div>
  </div>
  <script>
    window.__choice = null
    const set = (v) => { window.__choice = v; window.location.hash = v }
    document.getElementById('x').addEventListener('click', () => set('exit'))
    document.getElementById('exit').addEventListener('click', () => set('exit'))
    document.getElementById('update').addEventListener('click', () => set('update'))
  </script>
  </body></html>`
}

function overlayHtml(from: string, to: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#0b0c0d;color:#e9eaec;
    font-family:'Segoe UI',system-ui,sans-serif;display:flex;align-items:center;justify-content:center}
  .box{width:min(520px,84vw)}
  .brand{font-size:11px;letter-spacing:2.4px;color:#6f767d;text-transform:uppercase;margin-bottom:10px}
  h1{font-size:19px;font-weight:600;margin:0 0 6px}
  .stage{font-size:12.5px;color:#9aa0a6;margin-bottom:18px;min-height:18px}
  .track{height:6px;border-radius:99px;background:#1b1d1f;overflow:hidden}
  .fill{height:100%;width:0%;border-radius:99px;
    background:linear-gradient(90deg,#ffffff,#cfe6d5,#5fbb75,#2e7d46);transition:width .28s ease}
  .row{display:flex;justify-content:space-between;margin-top:9px;font-size:11.5px;color:#8d949a}
  .pct{color:#cfd4d8;font-variant-numeric:tabular-nums}
  </style></head><body>
  <div class="box">
    <div class="brand">FalseCode</div>
    <h1>Updating FalseCode Version ${from} to ${to}</h1>
    <div class="stage" id="stage">Preparing…</div>
    <div class="track"><div class="fill" id="fill"></div></div>
    <div class="row"><span id="note">Do not close the app</span><span class="pct" id="pct">0%</span></div>
  </div>
  <script>
  window.__update = (p) => {
    if (typeof p.percent === 'number') {
      document.getElementById('fill').style.width = Math.max(0, Math.min(100, p.percent)) + '%'
      document.getElementById('pct').textContent = Math.round(p.percent) + '%'
    }
    if (p.stage) document.getElementById('stage').textContent = p.stage
    if (p.note) document.getElementById('note').textContent = p.note
  }
  </script>
  </body></html>`
}

function showPopup(remote: Remote) {
  if (popup && !popup.isDestroyed()) return
  if (dismissed.has(remote.sha)) return

  popup = new BrowserWindow({
    width: 440,
    height: 230,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#1a1c20",
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })

  popup.setAlwaysOnTop(true, "screen-saver")
  loadHtml(popup, popupHtml(`Version ${currentVersion()} → ${short(remote.sha)}`))

  popup.once("ready-to-show", () => {
    const { workArea } = screen.getPrimaryDisplay()
    popup?.setBounds(workArea)
    popup?.show()
    popup?.focus()
  })

  popup.webContents.on("did-finish-load", () => {
    const poll = setInterval(async () => {
      if (!popup || popup.isDestroyed()) {
        clearInterval(poll)
        return
      }
      const choice = await popup.webContents.executeJavaScript("window.__choice").catch(() => null)
      if (choice === "update") {
        clearInterval(poll)
        popup?.close()
        void install(remote)
      } else if (choice === "exit") {
        clearInterval(poll)
        dismissed.add(remote.sha)
        popup?.close()
      }
    }, 100)
  })

  popup.on("closed", () => {
    popup = undefined
    if (autoInstall) clearTimeout(autoInstall)
  })

  autoInstall = setTimeout(() => {
    if (installing || !popup || popup.isDestroyed()) return
    popup.close()
    void install(remote)
  }, AUTO_INSTALL_MS)
}

function showOverlay(from: string, to: string) {
  overlay = new BrowserWindow({
    width: 560,
    height: 250,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#0b0c0d",
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })

  overlay.setAlwaysOnTop(true, "screen-saver")
  loadHtml(overlay, overlayHtml(from, to))
  overlay.once("ready-to-show", () => overlay?.show())
}

function progress(percent: number, stage: string, note?: string) {
  if (!overlay || overlay.isDestroyed()) return
  void overlay.webContents
    .executeJavaScript(`window.__update && window.__update(${JSON.stringify({ percent, stage, note })})`)
    .catch(() => undefined)
}

async function download(url: string): Promise<Uint8Array> {
  const response = await net.fetch(url, { headers: { "User-Agent": "FalseCode-Updater" } })
  if (!response.ok) throw new Error(`Download failed: ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

async function extract(archive: Uint8Array, destination: string) {
  const reader = new ZipReader(new Uint8ArrayReader(archive))
  const entries = await reader.getEntries()
  const files = entries.filter((entry) => !entry.directory)

  let done = 0
  for (const entry of files) {
    const target = join(destination, entry.filename)
    await mkdir(join(target, ".."), { recursive: true })
    const content = await entry.getData!(new Uint8ArrayWriter())
    await writeFile(target, content)
    done += 1
    progress(10 + (done / Math.max(files.length, 1)) * 55, `Extracting files ${done}/${files.length}`)
  }
  await reader.close()
}

async function archiveVersion(root: string, sha: string) {
  for (const candidate of [join(root, "package.json"), join(root, "resources", "app", "package.json")]) {
    try {
      const parsed = JSON.parse(await readFile(candidate, "utf8")) as { version?: string }
      if (parsed.version) return parsed.version
    } catch {
      continue
    }
  }
  return short(sha)
}

/** Locate the app payload inside the extracted archive: app.asar, a resources tree, a build tree or a full app. */
async function findPayload(root: string): Promise<string | undefined> {
  const direct = [
    join(root, "resources", "app.asar"),
    join(root, "app.asar"),
    join(root, "build", "resources", "app.asar"),
  ]
  for (const candidate of direct) if (existsSync(candidate)) return candidate

  for (const child of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!child.isDirectory()) continue
    const nested = await findPayload(join(root, child.name))
    if (nested) return nested
  }
  return undefined
}

/** Mirrors a directory onto the target, removing files the archive no longer ships. Returns true when something changed. */
async function copyTree(source: string, destination: string): Promise<boolean> {
  await mkdir(destination, { recursive: true })
  const entries = await readdir(source, { withFileTypes: true })
  const keep = new Set(entries.map((entry) => entry.name))
  const preserved = new Set(["opencode-cli.exe", "opencode-cli.version", "app-update.yml", "falsecode-updater.json"])

  let changed = false

  for (const existing of await readdir(destination, { withFileTypes: true }).catch(() => [])) {
    if (keep.has(existing.name) || preserved.has(existing.name)) continue
    await rm(join(destination, existing.name), { recursive: true, force: true }).catch(() => undefined)
    changed = true
  }

  for (const entry of entries) {
    const from = join(source, entry.name)
    const to = join(destination, entry.name)
    if (entry.isDirectory()) {
      if (await copyTree(from, to)) changed = true
    } else {
      // Incremental: skip files that are already byte-identical (size + mtime).
      let skip = false
      try {
        const [a, b] = await Promise.all([stat(from), stat(to).catch(() => null)])
        if (b && a.size === b.size && a.mtimeMs === b.mtimeMs) skip = true
      } catch {
        skip = false
      }
      if (skip) continue
      await cp(from, to, { force: true })
      changed = true
    }
  }

  return changed
}

/** Stages the new bundle, then swaps it in. Returns true when the bundle actually changed. */
async function applyBundle(asar: string): Promise<boolean> {
  const resources = process.resourcesPath
  const target = join(resources, "app.asar")
  const staged = join(resources, "app.asar.new")

  await cp(asar, staged, { force: true })

  // Incremental: if the bundle is byte-identical, there is nothing to do.
  try {
    const [a, b] = await Promise.all([readFile(staged), readFile(target).catch(() => null)])
    if (b && createHash("sha256").update(a).digest("hex") === createHash("sha256").update(b).digest("hex")) {
      await rm(staged, { force: true }).catch(() => undefined)
      return false
    }
  } catch {
    // Fall through to the swap.
  }

  try {
    await rm(target, { force: true })
    await rename(staged, target)
  } catch (error) {
    log("bundle locked, handing over to helper", error)
    swapAfterExit(staged, target)
    throw new Error("RESTARTING")
  }

  for (const entry of await readdir(join(asar, ".."), { withFileTypes: true }).catch(() => [])) {
    if (entry.name === "app.asar" || entry.name.startsWith("app.asar.")) continue
    await cp(join(asar, "..", entry.name), join(resources, entry.name), { recursive: true, force: true })
  }

  return true
}

function swapAfterExit(staged: string, target: string) {
  const exe = join(INSTALL_ROOT, "FalseCode.exe")
  const script = [
    "@echo off",
    "ping 127.0.0.1 -n 3 >nul",
    `del /f /q "${target}"`,
    `move /y "${staged}" "${target}"`,
    `start "" "${exe}"`,
    "del /f /q \"%~f0\"",
  ].join("\r\n")
  const file = join(app.getPath("temp"), `falsecode-swap-${Date.now()}.cmd`)
  void writeFile(file, script, "utf8")
    .then(() => spawn("cmd.exe", ["/c", file], { detached: true, stdio: "ignore", windowsHide: true }).unref())
    .then(() => app.exit(0))
    .catch((error) => log("swap helper failed", error))
}

async function applyPayload(root: string) {
  const asar = await findPayload(root)

  if (asar) {
    progress(72, "Replacing application bundle")
    await applyBundle(asar)
    return
  }

  const resources = join(root, "resources")
  if (existsSync(resources)) {
    progress(72, "Synchronising resources")
    return await copyTree(resources, process.resourcesPath)
  }

  const build = join(root, "build")
  if (existsSync(build)) {
    progress(72, "Synchronising application files")
    return await copyTree(build, INSTALL_ROOT)
  }

  if (existsSync(join(root, "FalseCode.exe")) || existsSync(join(root, "FocusCode.exe"))) {
    progress(72, "Synchronising application files")
    return await copyTree(root, INSTALL_ROOT)
  }

  throw new Error("No app payload found in the update archive")
}

async function install(remote: Remote) {
  if (installing) return
  installing = true
  if (autoInstall) clearTimeout(autoInstall)

  const from = currentVersion()
  const to = short(remote.sha)
  showOverlay(from, to)

  const work = join(app.getPath("temp"), `falsecode-update-${remote.sha.slice(0, 7)}`)

  try {
    progress(4, "Contacting github.com")
    const archive = await download(`https://codeload.github.com/${OWNER}/${REPO}/zip/${remote.sha}`)

    progress(9, "Preparing archive")
    await rm(work, { recursive: true, force: true }).catch(() => undefined)
    await mkdir(work, { recursive: true })
    await extract(archive, work)

    progress(68, "Reading new version")
    const root = (await readdir(work, { withFileTypes: true })).find((entry) => entry.isDirectory())
    const payloadRoot = root ? join(work, root.name) : work
    const version = await archiveVersion(payloadRoot, remote.sha)

    progress(70, `Installing ${version}`)
    const changed = await applyPayload(payloadRoot)

    progress(94, "Saving update state")
    await saveState({ installedSha: remote.sha, installedVersion: version, checkedAt: Date.now(), pendingSha: undefined })

    if (!changed) {
      progress(100, "Already up to date", "No files changed")
      await new Promise((resolve) => setTimeout(resolve, 1200))
      overlay?.close()
      overlay = undefined
      installing = false
      return
    }

    progress(100, "Restarting FalseCode", "The app restarts in a moment")
    await new Promise((resolve) => setTimeout(resolve, 200))

    app.relaunch()
    app.exit(0)
  } catch (error) {
    if (error instanceof Error && error.message === "RESTARTING") return
    log("install failed", error)
    progress(100, "Update failed", error instanceof Error ? error.message : String(error))
    installing = false
    await new Promise((resolve) => setTimeout(resolve, 4000))
    overlay?.close()
    overlay = undefined
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function check() {
  if (installing) return
  try {
    const remote = await latestCommit()
    await saveState({ checkedAt: Date.now() })
    if (!remote) return

  // First sight of a commit means "not yet installed": offer it instead of baselining.
  if (!state.installedSha) {
    if (!remote) return
    if (state.pendingSha === remote.sha) return
    await saveState({ pendingSha: remote.sha })
    log("update available (first install)", { to: short(remote.sha) })
    showPopup(remote)
    return
  }

    if (remote.sha === state.installedSha || remote.sha === state.pendingSha) return

    log("update detected", { from: short(state.installedSha), to: short(remote.sha) })
    showPopup(remote)
  } catch (error) {
    log("check failed", error)
  }
}

export function startGithubUpdater() {
  void app.whenReady().then(async () => {
    await loadState()
    await check()
    timer = setInterval(() => void check(), POLL_MS)
    app.once("will-quit", () => timer && clearInterval(timer))
  })
}

export function stopGithubUpdater() {
  if (timer) clearInterval(timer)
  timer = undefined
}
