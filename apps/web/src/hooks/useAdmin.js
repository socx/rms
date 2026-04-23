import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';

// ── Users ─────────────────────────────────────────────────────────────────────

export function useAdminUsers({ q = '', limit = 100, offset = 0 } = {}) {
  return useQuery({
    queryKey: ['admin-users', q, limit, offset],
    queryFn: () =>
      api.get('/admin/users', { params: { q, limit, offset } }).then(r => r.data.data.users),
  });
}

export function useAdminUser(id) {
  return useQuery({
    queryKey: ['admin-user', id],
    queryFn: () => api.get(`/admin/users/${id}`).then(r => r.data.data.user),
    enabled: !!id,
  });
}

export function useAdminUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) =>
      api.patch(`/admin/users/${id}`, data).then(r => r.data.data.user),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
}

export function useAdminDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/users/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
}

// ── Settings ──────────────────────────────────────────────────────────────────

export function useAdminSettings() {
  return useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => api.get('/admin/settings').then(r => r.data.data.settings),
  });
}

export function useAdminUpdateSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }) =>
      api.patch(`/admin/settings/${key}`, { value }).then(r => r.data.data.setting),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-settings'] }),
  });
}

// ── Events ────────────────────────────────────────────────────────────────────

export function useAdminEvents({ page = 1, perPage = 20, q = '' } = {}) {
  return useQuery({
    queryKey: ['admin-events', page, perPage, q],
    queryFn: () =>
      api.get('/admin/events', { params: { page, per_page: perPage, q } }).then(r => r.data),
  });
}
