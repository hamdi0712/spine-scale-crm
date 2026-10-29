import { loadEmailSettings } from "@/lib/emailSettingsStore";
import { startersRemaining } from "@/lib/emailWorkflow";
import EmailSettingsForm from "@/components/EmailSettingsForm";

export const dynamic = "force-dynamic";

// Email — the templates cold email is built from, how long to wait before
// each follow-up, and how many to send a day. Emails go out by hand from
// Gmail; nothing here sends anything.
export default async function EmailSettingsPage() {
  const settings = await loadEmailSettings();
  return <EmailSettingsForm initial={settings} starters={startersRemaining(settings)} />;
}
