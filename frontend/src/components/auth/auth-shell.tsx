"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import { CredonMark } from "@/components/logo";

type Mode = "login" | "register";

const HIGHLIGHTS: Record<Mode, string[]> = {
  login: [
    "Your sessions, memory and uploads — waiting for you",
    "Agent mode with sandboxed code execution",
    "Grounded answers with live web sources",
  ],
  register: [
    "Free forever tier — no credit card",
    "Unlimited chats on fast free models",
    "Personal memory that adapts to how you work",
  ],
};

export function AuthShell({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const isRegister = mode === "register";

  function friendlyError(code: string): string {
    const map: Record<string, string> = {
      "auth/invalid-credential": "Incorrect email or password.",
      "auth/wrong-password": "Incorrect email or password.",
      "auth/user-not-found": "No account found with this email.",
      "auth/email-already-in-use": "An account already exists — try signing in.",
      "auth/weak-password": "Password should be at least 6 characters.",
      "auth/invalid-email": "That email address doesn't look right.",
      "auth/too-many-requests": "Too many attempts. Try again in a minute.",
      "auth/popup-closed-by-user": "Google sign-in was cancelled.",
      "auth/network-request-failed": "Network error — check your connection.",
    };
    return map[code] || "Something went wrong. Please try again.";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firebaseAuth) {
      setError("Authentication isn't configured. You can continue as a guest instead.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      if (isRegister) {
        const cred = await createUserWithEmailAndPassword(firebaseAuth, email.trim(), password);
        if (name.trim()) await updateProfile(cred.user, { displayName: name.trim() });
      } else {
        await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
      }
      router.push("/app");
    } catch (err) {
      const code = err instanceof Error && "code" in err ? String((err as { code: string }).code) : "";
      setError(friendlyError(code));
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    if (!firebaseAuth) return;
    setError("");
    setBusy(true);
    try {
      await signInWithPopup(firebaseAuth, new GoogleAuthProvider());
      router.push("/app");
    } catch (err) {
      const code = err instanceof Error && "code" in err ? String((err as { code: string }).code) : "";
      setError(friendlyError(code));
    } finally {
      setBusy(false);
    }
  }

  async function handleForgot() {
    if (!email.trim()) {
      setError("Enter your email first, then tap reset.");
      return;
    }
    try {
      await sendPasswordResetEmail(firebaseAuth!, email.trim());
      setError("");
      setNotice("Password reset link sent — check your inbox.");
    } catch (err) {
      const code = err instanceof Error && "code" in err ? String((err as { code: string }).code) : "";
      setError(friendlyError(code));
    }
  }

  async function handleGuest() {
    localStorage.setItem("credon-guest", "1");
    router.push("/app");
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_460px] xl:grid-cols-[1fr_520px]">
      {/* ── brand panel ── */}
      <aside className="relative hidden overflow-hidden bg-[#0d0d10] lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute left-[-160px] top-[-160px] h-[480px] w-[480px] rounded-full"
          style={{ background: "radial-gradient(closest-side, rgba(224,129,88,0.16), transparent)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-[-200px] right-[-120px] h-[520px] w-[520px] rounded-full"
          style={{ background: "radial-gradient(closest-side, rgba(224,129,88,0.08), transparent)" }}
        />

        <Link href="/" className="relative z-10 flex items-center gap-2.5 p-8 transition-opacity hover:opacity-80">
          <CredonMark size={26} />
          <span className="text-[16px] font-semibold tracking-tight text-white">
            Credon<span className="font-normal text-white/40"> AI</span>
          </span>
        </Link>

        <div className="relative z-10 max-w-md px-12 pb-10">
          <h2 className="font-display text-[40px] leading-[1.1] tracking-tight text-[#FAF9F6]">
            Where questions become <em className="italic text-[#f0956c]">finished work.</em>
          </h2>
          <ul className="mt-9 space-y-4">
            {HIGHLIGHTS[mode].map((item, i) => (
              <li key={item} className={`flex items-start gap-3 anim-fade-up d-${i + 1} text-[14.5px] text-white/65`}>
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#e08158]/15 text-[10px] text-[#f0956c]">
                  ✓
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 px-12 pb-8 text-xs text-white/30">
          © {new Date().getFullYear()} Credon AI · Research · Reason · Build
        </p>
      </aside>

      {/* ── form panel ── */}
      <main className="flex flex-col bg-[#FAF9F6]">
        <div className="flex items-center justify-between p-6 lg:hidden">
          <Link href="/" className="flex items-center gap-2">
            <CredonMark size={24} />
            <span className="text-[15px] font-semibold tracking-tight text-stone-900">
              Credon<span className="font-normal text-stone-400"> AI</span>
            </span>
          </Link>
          <Link href={isRegister ? "/login" : "/register"} className="text-sm font-medium text-[#b4552e]">
            {isRegister ? "Sign in" : "Create account"}
          </Link>
        </div>

        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center px-7 pb-10">
          <h1 className="anim-fade-up font-display text-[34px] tracking-tight text-stone-900">
            {isRegister ? "Create your account" : "Welcome back"}
          </h1>
          <p className="anim-fade-up d-1 mt-2 text-[14.5px] text-stone-500">
            {isRegister
              ? "Free forever. Start asking in under a minute."
              : "Sign in to pick up where you left off."}
          </p>

          <button
            onClick={handleGoogle}
            disabled={busy}
            className="anim-fade-up d-2 mt-7 flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-stone-900/10 bg-white text-[14.5px] font-medium text-stone-800 shadow-sm transition-all hover:-translate-y-px hover:border-stone-900/20 hover:shadow disabled:opacity-60"
          >
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62z"/>
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26a5.4 5.4 0 0 1-8.09-2.85H.96v2.33A9 9 0 0 0 9 18z"/>
              <path fill="#FBBC05" d="M3.95 10.71a5.4 5.4 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33z"/>
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A9 9 0 0 0 .96 4.96l3 2.33A5.36 5.36 0 0 1 9 3.58z"/>
            </svg>
            Continue with Google
          </button>

          <div className="anim-fade-up d-2 my-6 flex items-center gap-4">
            <span className="h-px flex-1 bg-stone-900/[0.08]" />
            <span className="text-[12px] uppercase tracking-wider text-stone-400">or</span>
            <span className="h-px flex-1 bg-stone-900/[0.08]" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegister && (
              <Field
                id="name"
                label="Name"
                type="text"
                autoComplete="name"
                placeholder="Ada Lovelace"
                value={name}
                onChange={setName}
              />
            )}
            <Field
              id="email"
              label="Email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={setEmail}
              required
            />
            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <label htmlFor="password" className="text-[13px] font-medium text-stone-700">
                  Password
                </label>
                {!isRegister && (
                  <button type="button" onClick={handleForgot} className="text-[12.5px] text-[#b4552e] hover:underline">
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  id="password"
                  type={showPw ? "text" : "password"}
                  required
                  minLength={6}
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 w-full rounded-xl border border-stone-900/10 bg-white px-3.5 pr-11 text-[14.5px] text-stone-900 shadow-sm outline-none transition-all placeholder:text-stone-400 focus:border-[#c9653c]/50 focus:ring-4 focus:ring-[#c9653c]/10"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 transition-colors hover:text-stone-600"
                >
                  {showPw ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>

            {error && (
              <p className="anim-scale-in rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700">
                {error}
              </p>
            )}
            {notice && (
              <p className="anim-scale-in rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-700">
                {notice}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="!mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-stone-900 text-[14.5px] font-medium text-white shadow-md transition-all hover:-translate-y-px hover:bg-stone-800 hover:shadow-lg disabled:opacity-60"
            >
              {busy && <Spinner />}
              {isRegister ? (busy ? "Creating account…" : "Create free account") : busy ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="mt-7 hidden text-center text-[14px] text-stone-500 lg:block">
            {isRegister ? "Already have an account? " : "New to Credon? "}
            <Link href={isRegister ? "/login" : "/register"} className="font-medium text-[#b4552e] hover:underline">
              {isRegister ? "Sign in" : "Create one free"}
            </Link>
          </p>

          <button
            onClick={handleGuest}
            className="mt-5 text-center text-[13.5px] text-stone-400 transition-colors hover:text-stone-600"
          >
            or continue as guest →
          </button>
        </div>
      </main>
    </div>
  );
}

function Field({
  id, label, type, value, onChange, placeholder, autoComplete, required,
}: {
  id: string; label: string; type: string; value: string; onChange: (v: string) => void;
  placeholder?: string; autoComplete?: string; required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-stone-700">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-xl border border-stone-900/10 bg-white px-3.5 text-[14.5px] text-stone-900 shadow-sm outline-none transition-all placeholder:text-stone-400 focus:border-[#c9653c]/50 focus:ring-4 focus:ring-[#c9653c]/10"
      />
    </div>
  );
}

function Spinner() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" className="animate-spin">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" opacity="0.25" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <path d="m1 1 22 22" />
    </svg>
  );
}
