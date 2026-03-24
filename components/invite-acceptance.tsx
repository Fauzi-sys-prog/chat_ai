"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./invite-acceptance.module.css";

type InvitePreview = {
  workspace_name: string;
  email: string;
  role: string;
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
          throw new Error((await response.text()) || "Invite tidak ditemukan.");
        }
        const data = (await response.json()) as InvitePreview;
        if (!cancelled) {
          setInvite(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Gagal memuat invite.");
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
      setError("Login dulu di app utama, lalu buka lagi link invite ini.");
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
        throw new Error((await response.text()) || "Gagal memproses invite.");
      }
      const result = (await response.json()) as { workspace_name: string; status: string };
      setMessage(
        action === "accept"
          ? `Invite diterima. Workspace ${result.workspace_name} sekarang bisa kamu buka dari dashboard.`
          : `Invite untuk ${result.workspace_name} ditolak.`,
      );
      setInvite((current) => (current ? { ...current, status: result.status } : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memproses invite.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>PT BW Water</p>
        <h1 className={styles.title}>Masuk ke BW Water Knowledge Assistant lewat link undangan.</h1>
        <p className={styles.copy}>
          Link ini menampilkan detail undangan knowledge space PT BW Water dan bisa langsung
          dipakai untuk accept atau reject setelah kamu login.
        </p>

        {isLoading ? <p className={styles.copy}>Memuat invite...</p> : null}

        {invite ? (
          <div className={styles.meta}>
            <div className={styles.metaItem}>
              <strong>Workspace</strong>
              <div>{invite.workspace_name}</div>
            </div>
            <div className={styles.metaItem}>
              <strong>Email target</strong>
              <div>{invite.email}</div>
            </div>
            <div className={styles.metaItem}>
              <strong>Role</strong>
              <div>{invite.role}</div>
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
            {isSubmitting ? "Memproses..." : "Accept Invite"}
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
            Buka dashboard
          </Link>
        </div>

        {!authToken ? (
          <p className={styles.copy}>
            Belum ada session login di browser ini. Login di dashboard dulu, lalu balik ke halaman
            invite ini.
          </p>
        ) : null}

        {message ? <p className={styles.success}>{message}</p> : null}
        {error ? <p className={styles.error}>{error}</p> : null}
      </section>
    </main>
  );
}
