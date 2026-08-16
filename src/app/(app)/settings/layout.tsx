// The Settings area — one page title, one sub-navigation, and whichever
// section is open below it.
//
// Everything under here changes how the app runs rather than what is in it:
// the credentials it calls out with, and the chain it runs when it does. Those
// were two unrelated places until this layout existed — one in .env, one under
// /pipeline/settings — and the sidebar carried the second as if it were a
// destination like Clients or Reporting. It is not; it is a setting, and this
// is where settings live.

import SettingsNav from "@/components/SettingsNav";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="display text-[32px] font-semibold">Settings</h1>
        <p className="mt-1.5 text-sm text-muted">
          The keys this app calls out with, and the chain it runs when it does
        </p>
      </div>
      <div className="mb-8">
        <SettingsNav />
      </div>
      {children}
    </div>
  );
}
