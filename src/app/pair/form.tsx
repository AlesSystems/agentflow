"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function PairForm({ onPaired }: { onPaired?: () => void } = {}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        setBusy(true);
        const form = event.currentTarget;
        const data = new FormData(form);
        try {
          const response = await fetch("/api/v1/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: data.get("token") }),
          });
          if (!response.ok) {
            setError(
              response.status === 401
                ? "That pairing token was not accepted. Check the token and try again."
                : "Pairing could not finish. Check that AgentFlow is running and try again.",
            );
            return;
          }
          if (onPaired) { form.reset(); onPaired(); return; }
          router.push("/");
          router.refresh();
        } catch {
          setError(
            "Cannot reach AgentFlow. Start the local service and try again.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor="token">Pairing token</label>
      <input
        id="token"
        name="token"
        type="password"
        autoComplete="off"
        required
        maxLength={128}
        aria-describedby="token-help pairing-error"
        aria-invalid={!!error}
      />
      <p id="token-help">
        Use the pairing token from the local setup command. Your reporter token
        cannot pair a browser.
      </p>
      <p id="pairing-error" role="alert" className="error">
        {error}
      </p>
      <button disabled={busy}>{busy ? "Pairing…" : "Pair this browser"}</button>
    </form>
  );
}
