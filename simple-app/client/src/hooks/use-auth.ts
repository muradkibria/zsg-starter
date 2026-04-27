import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../lib/auth";
import { api } from "../lib/api";
import { disconnectSocket } from "../lib/socket";

interface LoginResponse {
  token: string;
  user: { id: string; email: string; name: string; role: string };
}

export function useAuth() {
  const { token, user, setAuth, clearAuth } = useAuthStore();
  const navigate = useNavigate();

  const loginMutation = useMutation({
    mutationFn: (creds: { email: string; password: string }) =>
      api.post<LoginResponse>("/auth/login", creds),
    onSuccess: (data) => {
      setAuth(data.token, data.user);
      navigate("/");
    },
  });

  const logout = () => {
    clearAuth();
    disconnectSocket();
    navigate("/login");
  };

  return {
    token,
    user,
    isAuthenticated: !!token,
    login: loginMutation.mutate,
    loginPending: loginMutation.isPending,
    loginError: loginMutation.error,
    logout,
  };
}
