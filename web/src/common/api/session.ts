// Session hooks over /api/session/*. The server's answer is the only source of truth for who is
// signed in; after any auth change the session query is refetched.
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  SessionUser,
  SignInInput,
} from "@leave/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { ApiError, errorCode, unwrapAs as unwrap } from "./http";
import { queryKeys } from "./keys";

export { ApiError, errorCode };


export function useSessionUser() {
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: async (): Promise<SessionUser | null> => {
      const res = await api.api.session.me.$get();
      if (res.status === 401) return null;
      return unwrap<SessionUser>(res);
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useSignIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SignInInput) =>
      unwrap<{ role: "operator" | "employee"; mustChangePassword: boolean }>(
        await api.api.session["sign-in"].$post({ json: input }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.session }),
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap<{ ok: true }>(await api.api.session["sign-out"].$post()),
    onSettled: () => {
      qc.clear();
    },
  });
}

export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ChangePasswordInput) =>
      unwrap<{ ok: true }>(await api.api.session["change-password"].$post({ json: input })),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.session }),
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: async (input: ForgotPasswordInput) =>
      unwrap<{ ok: true }>(await api.api.session["forgot-password"].$post({ json: input })),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: async (input: ResetPasswordInput) =>
      unwrap<{ ok: true }>(await api.api.session["reset-password"].$post({ json: input })),
  });
}

