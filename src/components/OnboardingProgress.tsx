// Wizard progress: one segment per step in the same visual language as the
// delivery capsule bar — filled for done, half-lit for the step in hand.

import { ONBOARDING_STEPS, ONBOARDING_TOTAL_STEPS } from "@/lib/onboarding";

export default function OnboardingProgress({ current }: { current: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <p className="num text-xs font-medium tracking-[0.02em] text-muted">
          Step {current} of {ONBOARDING_TOTAL_STEPS}
        </p>
        <p className="truncate text-xs text-muted">
          Progress is saved as you go — you can leave and pick up here later.
        </p>
      </div>
      <ol className="mt-2.5 flex gap-2">
        {ONBOARDING_STEPS.map((step) => {
          const done = step.n < current;
          const active = step.n === current;
          return (
            <li key={step.n} className="min-w-0 flex-1">
              <div
                className={`h-2 rounded-full transition-colors duration-300 ${
                  done ? "bg-accent" : active ? "bg-accent/30" : "bg-line"
                }`}
                aria-hidden
              />
              <p
                className={`mt-2 truncate text-xs ${
                  active ? "font-medium text-ink" : "text-muted"
                }`}
              >
                <span className="num">{step.n}.</span> {step.title}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
