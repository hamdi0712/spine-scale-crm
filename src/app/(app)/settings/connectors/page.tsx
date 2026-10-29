import ConfirmForm from "@/components/ConfirmForm";
import {
  revokeAllConnectorAccessAction,
  revokeConnectorClientAction,
} from "@/lib/actions/mcpConnectors";
import { listConnections } from "@/lib/mcpOAuth";
import { MCP_TOOL_NAMES } from "@/lib/mcpServer";
import { MCP_WRITE_TOOL_NAMES } from "@/lib/mcpWrites";
import { fmtDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

// Connectors — who can read this CRM from Claude, and the button that stops it.
//
// The connector is the MCP server at /api/mcp. Claude signs in to it once, with
// the app password, and keeps a token; this page lists every client holding
// one and revokes them. Revoking is immediate: the next call is refused.
export default async function ConnectorsPage() {
  const connections = await listConnections();

  return (
    <div>
      <div className="mb-4">
        <h2 className="display text-xl font-semibold">Connectors</h2>
        <p className="helper-text mt-1 text-sm text-muted">
          Claude&rsquo;s access to this CRM through the MCP connector
        </p>
      </div>

      <div className="helper-text card mb-6 px-6 py-4">
        <p className="text-sm font-medium">What a connected client can do</p>
        <p className="helper-text mt-1 text-xs leading-relaxed text-muted">
          It gets the same lookups the AI Copilot uses —{" "}
          {MCP_TOOL_NAMES.length} of them, with the same limits — and{" "}
          {MCP_WRITE_TOOL_NAMES.length} small changes to one lead at a time
          (email, contact name, note, task, stage, reply, un-flag). Claude asks
          you before each change; each one lands in Activity marked &ldquo;via
          Claude connector&rdquo; with an Undo. It cannot approve, mark sent or
          send an email, delete anything, or touch clients, reporting or
          settings. Scraped website text, reviews and
          prospect replies reach it labelled as untrusted, exactly as they reach
          the copilot. Access is granted by typing the app password when Claude
          asks; changing the password also cuts every connector off.
        </p>
      </div>

      <div className="card px-6 py-5">
        {connections.length === 0 ? (
          <p className="text-sm text-muted">No client is connected.</p>
        ) : (
          <ul className="divide-y divide-line">
            {connections.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-4 py-3 first:pt-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted">
                    Connected {fmtDateTime(c.connectedAt)} ·{" "}
                    {c.lastUsedAt ? `last used ${fmtDateTime(c.lastUsedAt)}` : "not used yet"}
                    {c.grants > 1 ? ` · ${c.grants} sign-ins` : ""}
                  </p>
                </div>
                <form action={revokeConnectorClientAction}>
                  <input type="hidden" name="clientId" value={c.id} />
                  <button type="submit" className="btn-ghost">
                    Revoke
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-5 border-t border-line pt-5">
          <ConfirmForm
            action={revokeAllConnectorAccessAction}
            message="Revoke all connector access? Every connected client is signed out at once, and reconnecting means clicking Connect in Claude and typing the app password again."
            proMessage="Revoke all connector access? Every client is signed out."
            className="btn-danger"
          >
            Revoke all connector access
          </ConfirmForm>
        </div>
      </div>
    </div>
  );
}
