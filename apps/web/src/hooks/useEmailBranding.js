import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';

const queryKey = (userId) => ['email-branding', userId];

export function useGetEmailBranding(userId) {
  return useQuery({
    queryKey: queryKey(userId),
    queryFn: async () => {
      try {
        const r = await api.get(`/users/${userId}/email-wrapper`);
        return r.data.data.emailWrapper;
      } catch (err) {
        // 404 means no wrapper configured yet — return null (not an error)
        if (err.response?.status === 404) return null;
        throw err;
      }
    },
    enabled: !!userId,
  });
}

export function useUpsertEmailBranding(userId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ wrapperHtml, isActive }) =>
      api.put(`/users/${userId}/email-wrapper`, { wrapperHtml, isActive })
        .then(r => r.data.data.emailWrapper),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKey(userId) }),
  });
}

export function usePatchEmailBranding(userId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) =>
      api.patch(`/users/${userId}/email-wrapper`, data)
        .then(r => r.data.data.emailWrapper),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKey(userId) }),
  });
}

export function useDeleteEmailBranding(userId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.delete(`/users/${userId}/email-wrapper`)
        .then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKey(userId) }),
  });
}
