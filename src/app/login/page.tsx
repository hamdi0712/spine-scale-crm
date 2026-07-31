"use client";

import { useFormState, useFormStatus } from "react-dom";
import { login, LoginState } from "@/lib/actions/auth";
import { LogoWordmarkChip } from "@/components/Logo";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full justify-center" disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

export default function LoginPage() {
  const [state, formAction] = useFormState<LoginState, FormData>(login, {});
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm p-8">
        <div className="mb-8">
          <LogoWordmarkChip />
          <div className="mt-3 text-sm text-muted">Internal Ops CRM</div>
        </div>
        <form action={formAction} className="space-y-4">
          <div>
            <label htmlFor="password" className="field-label">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoFocus
              required
              className="field"
            />
          </div>
          {state.error && (
            <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
              {state.error}
            </p>
          )}
          <SubmitButton />
        </form>
      </div>
    </main>
  );
}
