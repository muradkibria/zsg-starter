import { useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router";
import { useAuth } from "@/lib/auth";
import { Button, Field, Input } from "@/components/ui";

export default function LoginPage() {
  const { user, signIn } = useAuth();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={params.get("next") || "/map"} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign in");
    } finally {
      setBusy(false);
    }
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
          <Field label="Email">
            <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && (
            <p role="alert" className="m-0 rounded-lg bg-red-bg px-3 py-2 text-sm text-red-ink">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" size="lg" loading={busy}>
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
