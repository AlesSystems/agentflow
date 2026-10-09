"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function SignOut() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <>
      <button
        disabled={busy}
        onClick={async () => {
          if (busy) return;
          setError("");
          setBusy(true);
          try {
            const response = await fetch("/api/v1/session", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            });
            if (!response.ok) {
              setError("Could not disconnect. Try again.");
              return;
            }
            router.push("/pair");
            router.refresh();
          } catch {
            setError("Cannot reach AgentFlow. Try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Disconnecting…" : "Disconnect browser"}
      </button>
      <p role="alert" className="error">
        {error}
      </p>
    </>
  );
}
