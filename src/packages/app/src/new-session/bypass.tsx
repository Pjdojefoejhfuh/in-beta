import { Icon } from "@opencode/ui/icon"
import { SessionMessage } from "@opencode/schema/session-message"
import { createSignal, startTransition } from "solid-js"
import { useData, useServer } from "@/runtime/server/current"
import { useTabs } from "@/shell/tabs/tabs"
import { showToast } from "@/shell/notifications/toast"
import { useLocal } from "@/providers/models/selection"
import { useProviders } from "@/providers/catalog/providers"
import { useWorkspaceLocation } from "@/workspaces/location"

/**
 * Project the button installs into FalseCode. The session is created against this directory, which
 * registers it as a project on the server and picks up its AGENTS.md agent configuration.
 */
export const BYPASS_PROJECT_DIRECTORY = "C:\\Users\\Utilisateur\\Downloads\\OJBS-OPENCODE (1)"

/** Subscription provider first: a new session must not land on pay-as-you-go credits. */
const BYPASS_PROVIDER_ID = "opencode-go"

/** First message sent in the bypassed session. */
const BYPASS_PROMPT = "hey"

export const BYPASS_SESSION_TITLE = "Bypassed session"
export const BYPASS_SUCCESS_MESSAGE = "Bypassed FalseCode Succesfully"

export function CreateBypassedSessionButton() {
  const data = useData()
  const server = useServer()
  const tabs = useTabs()
  const local = useLocal()
  const sdk = useWorkspaceLocation()
  const providers = useProviders(() => sdk().directory)
  const [pending, setPending] = createSignal(false)

  /** First model of the subscription provider, when that provider is connected. */
  const subscriptionModel = () => {
    const provider = providers.connected().find((item) => item.id === BYPASS_PROVIDER_ID)
    const model = provider ? Object.values(provider.models)[0] : undefined

    return provider && model ? { id: model.id, providerID: provider.id } : undefined
  }

  const run = async () => {
    if (pending()) return
    setPending(true)

    try {
      // Subscription provider first, then whatever the composer has picked.
      const picked = local.model.key()
      const model =
        subscriptionModel() ??
        (picked ? { id: picked.modelID, providerID: picked.providerID } : undefined)
      const agent = local.agent.current()?.name
      const created = data.session.create({
        location: { directory: BYPASS_PROJECT_DIRECTORY },
        title: BYPASS_SESSION_TITLE,
        agent,
        model,
      })

      await created.request

      // Open the session before the prompt lands so the first reply renders in place.
      startTransition(() =>
        tabs.select(tabs.addSessionTab({ server: server.key, sessionId: created.id })),
      )

      await data.session.prompt({
        sessionID: created.id,
        id: SessionMessage.ID.create(),
        delivery: "steer",
        text: BYPASS_PROMPT,
      })

      showToast({ variant: "success", title: BYPASS_SUCCESS_MESSAGE })
    } catch (error) {
      showToast({
        variant: "error",
        title: "Bypassed session failed",
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      data-action="create-bypassed-session"
      type="button"
      disabled={pending()}
      class="flex h-7 min-w-0 items-center gap-1.5 rounded-sm px-2 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-faint transition-colors hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none disabled:opacity-50"
      onClick={() => void run()}
    >
      <Icon name="shield" size="small" class="shrink-0 text-v2-icon-icon-muted" />
      <span class="min-w-0 truncate leading-5">Create Bypassed session</span>
    </button>
  )
}
