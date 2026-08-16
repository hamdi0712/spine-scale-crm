import ApiKeysForm from "@/components/ApiKeysForm";
import { saveAppSecret } from "@/lib/actions/appSecrets";
import { loadSecretStatuses } from "@/lib/appSecretsStore";

export const dynamic = "force-dynamic";

// API Keys — the two credentials this app calls out with.
//
// They lived in .env until this page existed, which made changing one a file
// edit and a server restart. They live in the AppSecrets row now and are read
// on every call, so a key pasted here is in force on the next request.
//
// What the page is served is not the keys. loadSecretStatuses returns whether
// each is set, which of the two sources is in force, and the last four
// characters — enough to tell one key from another, and not enough to be one.
export default async function ApiKeysPage() {
  const statuses = await loadSecretStatuses();

  return (
    <div>
      <div className="mb-4">
        <h2 className="display text-xl font-semibold">API Keys</h2>
        <p className="mt-1 text-sm text-muted">
          The credentials for the two services this app calls out to
        </p>
      </div>

      {/* Said before a key is typed rather than found out afterwards: what the
          page will and will not show back. */}
      <div className="card mb-6 px-6 py-4">
        <p className="text-sm font-medium">What is stored, and what is shown</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          A saved key is written to the database and read from there on every
          call, with the matching <code className="rounded bg-wash/70 px-1 py-0.5 font-mono text-[11px]">.env</code>{" "}
          variable as the fallback when nothing is stored. Once saved, a key is
          never sent back to this page in full — only its last four characters —
          so replacing one means pasting a new value rather than editing the old
          one.
        </p>
      </div>

      <ApiKeysForm statuses={statuses} save={saveAppSecret} />
    </div>
  );
}
