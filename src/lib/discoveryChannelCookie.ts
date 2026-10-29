// Opens Discovery on the channel an import just wrote to, so the page shows
// what was added: the LinkedIn imports (CSV, Apify, add by name) write
// LinkedIn candidates, and Clinic-first search writes email ones. The same
// cookie the toggle beside the Discovery title writes.
//
// Server-only, and called from server actions. Outside a request — a verify
// script calling the action directly — there is no cookie to set, and the
// import has already happened, so that is not an error.

import { cookies } from "next/headers";
import { DISCOVERY_CHANNEL_COOKIE, PipelineChannel } from "@/lib/emailChannel";

export function showDiscoveryChannel(channel: PipelineChannel): void {
  try {
    cookies().set(DISCOVERY_CHANNEL_COOKIE, channel, { path: "/", maxAge: 31_536_000, sameSite: "lax" });
  } catch {
    // No request to answer.
  }
}
