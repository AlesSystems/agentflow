"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function SignOut() {
  const [error, setError] = useState("");
  const router = useRouter();
  return (
    <>
      <button
        onClick={async () => {
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
          }
        }}
      >
        Disconnect browser
      </button>
      <p role="alert" className="error">
        {error}
      </p>
    </>
  );
}
