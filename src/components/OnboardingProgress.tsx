// The client onboarding wizard's progress bar — the shared WizardProgress with
// this wizard's steps and its own note, since onboarding is the one wizard
// whose position is persisted on the record.

import { ONBOARDING_STEPS } from "@/lib/onboarding";
import WizardProgress from "@/components/WizardProgress";

export default function OnboardingProgress({ current }: { current: number }) {
  return (
    <WizardProgress
      steps={ONBOARDING_STEPS}
      current={current}
      note="Progress is saved as you go — you can leave and pick up here later."
    />
  );
}
