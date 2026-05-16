import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function Login() {
  const { login, loginPending, loginError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login({ email, password });
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "linear-gradient(135deg, #062461 0%, #000000 100%)" }}
    >
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img
            src="/digilite-logo.png"
            alt="DigiLite Advertising"
            className="mx-auto h-16 w-auto mb-4 bg-white rounded-md p-3 shadow-lg"
          />
          <h1 className="text-2xl font-semibold text-white">The DigiLite Hub</h1>
          <p className="text-white/70 text-sm mt-1">Admin Portal</p>
        </div>
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Sign in</CardTitle>
            <CardDescription>Enter your admin credentials to continue.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1">
                <label htmlFor="email" className="text-sm font-medium">Email</label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="password" className="text-sm font-medium">Password</label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {loginError && (
                <p className="text-sm text-destructive">{loginError.message}</p>
              )}
              <Button type="submit" className="w-full" disabled={loginPending}>
                {loginPending ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
