import { redirect } from "next/navigation";

// The page moved to /settings/pipeline, where the rest of the settings are.
//
// The route stays as a redirect rather than being deleted: this was a nav item
// for as long as it existed, so it is in browser histories and bookmarks, and a
// 404 on a path that worked yesterday is a worse answer than the page itself.
export default function LegacyPipelineSettingsPage() {
  redirect("/settings/pipeline");
}
