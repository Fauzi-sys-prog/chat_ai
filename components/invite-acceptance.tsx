"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./invite-acceptance.module.css";

type InvitePreview = {
  workspace_name: string;
  email: string;
  status: string;
  accept_url: string;
  created_at: string;
};

const tokenStorageKey = "chat-ai-auth-token";

export function InviteAcceptance({ token }: { token: string }) {
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);

  useEffect(() => {
    setAuthToken(window.localStorage.getItem(tokenStorageKey));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadInvite() {
      try {
        setIsLoading(true);
        setError(null);
        const response = await fetch(`/api/backend/workspace-invitations/${token}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error((await response.text()) || "Invite not found.");
        }
        const data = (await response.json()) as InvitePreview;
        if (!cancelled) {
          setInvite(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load invite.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadInvite();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleDecision(action: "accept" | "reject") {
    if (!authToken) {
      setError("Sign in through the main app first, then open this invite link again.");
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      setMessage(null);
      const response = await fetch(`/api/backend/workspace-invitations/${token}/${action}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      if (!response.ok) {
        throw new Error((await response.text()) || "Failed to process invite.");
      }
      const result = (await response.json()) as { workspace_name: string; status: string };
      setMessage(
        action === "accept"
          ? `Invite accepted. ${result.workspace_name} is now available from your dashboard.`
          : `Invite to ${result.workspace_name} was declined.`,
      );
      setInvite((current) => (current ? { ...current, status: result.status } : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process invite.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>Project Access</p>
        <h1 className={styles.title}>Join a project from an invitation link.</h1>
        <p className={styles.copy}>
          This page shows the invite details and lets you accept or decline access after you sign in.
        </p>

        {isLoading ? <p className={styles.copy}>Loading invite...</p> : null}

        {invite ? (
          <div className={styles.meta}>
            <div className={styles.metaItem}>
              <strong>Workspace</strong>
              <div>{invite.workspace_name}</div>
            </div>
            <div className={styles.metaItem}>
              <strong>Target email</strong>
              <div>{invite.email}</div>
            </div>
            <div className={styles.metaItem}>
              <strong>Status</strong>
              <div>{invite.status}</div>
            </div>
          </div>
        ) : null}

        <div className={styles.actions}>
          <button
            className={styles.button}
            type="button"
            onClick={() => handleDecision("accept")}
            disabled={!invite || invite.status !== "pending" || isSubmitting}
          >
            {isSubmitting ? "Processing..." : "Accept invite"}
          </button>
          <button
            className={styles.ghostButton}
            type="button"
            onClick={() => handleDecision("reject")}
            disabled={!invite || invite.status !== "pending" || isSubmitting}
          >
            Reject
          </button>
          <Link className={styles.ghostButton} href="/">
            Open dashboard
          </Link>
        </div>

        {!authToken ? (
          <p className={styles.copy}>
            There is no active session in this browser yet. Sign in on the dashboard first, then return to this invite page.
          </p>
        ) : null}

        {message ? <p className={styles.success}>{message}</p> : null}
        {error ? <p className={styles.error}>{error}</p> : null}
      </section>
    </main>
  );
}
