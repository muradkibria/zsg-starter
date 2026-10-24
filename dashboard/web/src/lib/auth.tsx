import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { can, type ClientSession, type Permission, type SessionUser } from "@digilite/shared";
import { api, ApiError, setUnauthorizedHandler } from "./api";

/** Someone on the team, or a client signed in to the portal. */
type Session = SessionUser | ClientSession;
const isClient = (s: Session | null): s is ClientSession => !!s && "kind" in s && s.kind === "client";

interface AuthState {
  /** Someone on the team (null for a client) */
  user: SessionUser | null;
  /** A client signed in to the portal (null for the team) */
  client: ClientSession | null;
  loading: boolean;
  signIn: (code: string) => Promise<Session>;
  signOut: () => Promise<void>;
  can: (p: Permission) => boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUnauthorizedHandler(() => setSession(null));
    api
      .get<Session>("/auth/me")
      .then(setSession)
      .catch((e) => {
        if (!(e instanceof ApiError) || e.status !== 401) console.warn(e);
      })
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthState>(() => {
    const user = session && !isClient(session) ? session : null;
    return {
      user,
      client: isClient(session) ? session : null,
      loading,
      signIn: async (code) => {
        const s = await api.post<Session>("/auth/login", { code });
        setSession(s);
        return s;
      },
      signOut: async () => {
        await api.post("/auth/logout").catch(() => {});
        setSession(null);
      },
      can: (p) => can(user?.role, p),
    };
  }, [session, loading]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}

/** The hub: the team only. A client is sent to their portal. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, client, loading } = useAuth();
  const loc = useLocation();
  if (loading) return null;
  if (client) return <Navigate to="/portal" replace />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

/** The client portal: clients only. Someone on the team is sent to the hub. */
export function RequireClient({ children }: { children: ReactNode }) {
  const { user, client, loading } = useAuth();
  const loc = useLocation();
  if (loading) return null;
  if (user) return <Navigate to="/clients" replace />;
  if (!client) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}
