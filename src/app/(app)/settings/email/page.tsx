import { loadEmailSettings } from "@/lib/emailSettingsStore";
import { startersRemaining } from "@/lib/emailWorkflow";
import EmailSettingsForm from "@/components/EmailSettingsForm";
import { loadInboxes } from "@/lib/emailInboxes";
import { creditsUsedThisMonth } from "@/lib/emailCheckRun";

export const dynamic = "force-dynamic";

// Email — the templates cold email is built from, how long to wait before
// each follow-up, and how many to send a day. Emails go out by hand from
// Gmail; nothing here sends anything.
export default async function EmailSettingsPage() {
  const [settings, inboxes, creditsUsed] = await Promise.all([loadEmailSettings(), loadInboxes(), creditsUsedThisMonth()]);
  return <EmailSettingsForm initial={settings} inboxes={inboxes} starters={startersRemaining(settings)} creditsUsed={creditsUsed} />;
}
