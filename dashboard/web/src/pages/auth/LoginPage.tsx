import { useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router";
import { useAuth } from "@/lib/auth";
import { Button, Field, Input } from "@/components/ui";

/** Everyone signs in with their own six-digit code; it goes as soon as the sixth digit is in. */
export default function LoginPage() {
  const { user, signIn } = useAuth();
  const [params] = useSearchParams();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={params.get("next") || "/map"} replace />;

  const send = async (value: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign in");
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (code.length === 6) void send(code);
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex items-center justify-center gap-3">
          <img src="/digilite-mark.png" alt="" className="size-10" />
          <span className="font-display text-2xl font-bold tracking-wide text-navy">DigiLite Hub</span>
        </div>
        <form onSubmit={submit} className="card flex flex-col gap-4 p-6 shadow-[var(--shadow-float)]">
          <h1 className="m-0 font-display text-2xl font-semibold">Sign in</h1>
          <Field label="Your code" hint="Six digits">
            <Input
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              pattern="[0-9]{6}"
              maxLength={6}
              autoFocus
              required
              value={code}
              className="num text-center font-mono text-2xl tracking-[0.5em]"
              onChange={(e) => {
                const next = e.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(next);
                if (next.length === 6) void send(next);
              }}
            />
          </Field>
          {error && (
            <p role="alert" className="m-0 rounded-lg bg-red-bg px-3 py-2 text-sm text-red-ink">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" size="lg" loading={busy} disabled={code.length !== 6}>
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
