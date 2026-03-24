"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import styles from "./auth-action.module.css";

type TokenPreview = {
  email: string;
  purpose: string;
  status: string;
  expires_at: string;
};

export function AuthAction({
  token,
  mode,
}: {
  token: string;
  mode: "verify_email" | "reset_password";
}) {
  const [preview, setPreview] = useState<TokenPreview | null>(null);
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadToken() {
      try {
        const response = await fetch(`/api/backend/auth/action-tokens/${token}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error((await response.text()) || "Token was not found.");
        }
        const data = (await response.json()) as TokenPreview;
        if (!cancelled) {
          setPreview(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load token.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadToken();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    try {
      setIsSubmitting(true);
      setError(null);
      setMessage(null);

      if (mode === "verify_email") {
        const response = await fetch(`/api/backend/auth/verify-email/${token}`, {
          method: "POST",
        });
        if (!response.ok) {
          throw new Error((await response.text()) || "Verification failed.");
        }
        setMessage("Email verified successfully. You can now sign in to the dashboard.");
      } else {
        const response = await fetch(`/api/backend/auth/password-reset/${token}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ password }),
        });
        if (!response.ok) {
          throw new Error((await response.text()) || "Password reset failed.");
        }
        setMessage("Password updated successfully. Sign in again with your new password.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>{mode === "verify_email" ? "Verify Email" : "Reset Password"}</p>
        <h1 className={styles.title}>
          {mode === "verify_email"
            ? "Verify your account email."
            : "Set a new password for your account."}
        </h1>
        <p className={styles.copy}>
          {isLoading
            ? "Loading token..."
            : preview
              ? `${preview.email} • expires ${new Date(preview.expires_at).toLocaleString("en-US")}`
              : "Token is not available."}
        </p>

        {mode === "reset_password" ? (
          <form className={styles.form} onSubmit={handleSubmit}>
            <input
              className={styles.input}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
            />
            <button className={styles.button} type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Processing..." : "Save new password"}
            </button>
          </form>
        ) : (
          <div className={styles.actions}>
            <button className={styles.button} type="button" onClick={() => void handleSubmit()} disabled={isSubmitting}>
              {isSubmitting ? "Processing..." : "Verify email"}
            </button>
          </div>
        )}

        <div className={styles.actions}>
          <Link className={styles.ghostButton} href="/">
            Open dashboard
          </Link>
        </div>

        {message ? <p className={styles.success}>{message}</p> : null}
        {error ? <p className={styles.error}>{error}</p> : null}
      </section>
    </main>
  );
}
