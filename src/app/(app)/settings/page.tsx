import { redirect } from "next/navigation";

// /settings has no page of its own. The area is its sections, and the first of
// them is the one somebody arriving from the sidebar most likely wants, so this
// hands straight over rather than showing a landing page that only repeats the
// two links already in the sub-navigation above it.
export default function SettingsIndexPage() {
  redirect("/settings/api-keys");
}
