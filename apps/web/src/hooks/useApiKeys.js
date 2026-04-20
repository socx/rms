import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';

const queryKey = (userId) => ['api-keys', userId];

// ── Queries ───────────────────────────────────────────────────────────────────

export function useListApiKeys(userId) {
  return useQuery({
    queryKey: queryKey(userId),
    queryFn: () => api.get(`/users/${userId}/api-keys`).then(r => r.data.data.api_keys),
    enabled: !!userId,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useCreateApiKey(userId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, scopes, expires_at }) =>
      api.post(`/users/${userId}/api-keys`, { name, scopes, expires_at })
        .then(r => r.data.data.api_key),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKey(userId) }),
  });
}

export function useUpdateApiKey(userId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ keyId, name, expires_at }) =>
      api.patch(`/users/${userId}/api-keys/${keyId}`, { name, expires_at })
        .then(r => r.data.data.api_key),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKey(userId) }),
  });
}

export function useSetApiKeyScopes(userId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ keyId, scopes }) =>
      api.put(`/users/${userId}/api-keys/${keyId}/scopes`, { scopes })
        .then(r => r.data.data.scopes),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKey(userId) }),
  });
}

export function useRevokeApiKey(userId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (keyId) =>
      api.post(`/users/${userId}/api-keys/${keyId}/revoke`)
        .then(r => r.data.data.api_key),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKey(userId) }),
  });
}
