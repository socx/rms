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

// ── Create user ───────────────────────────────────────────────────────────────

export function useAdminCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => api.post('/users', data).then(r => r.data.data.user),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
}

// ── Audit logs ────────────────────────────────────────────────────────────────

export function useAdminAuditLogs({ entityType, actorId, action, dateFrom, dateTo, limit = 100, offset = 0 } = {}) {
  return useQuery({
    queryKey: ['admin-audit-logs', entityType, actorId, action, dateFrom, dateTo, limit, offset],
    queryFn: () =>
      api.get('/admin/audit-logs', {
        params: {
          ...(entityType ? { entity_type: entityType } : {}),
          ...(actorId ? { actor_id: actorId } : {}),
          ...(action ? { action } : {}),
          ...(dateFrom ? { date_from: dateFrom } : {}),
          ...(dateTo ? { date_to: dateTo } : {}),
          limit,
          offset,
        },
      }).then(r => r.data),
  });
}

// ── Log viewer ────────────────────────────────────────────────────────────────

export function useAdminLogs({ tier, stream, lines = 200 } = {}) {
  return useQuery({
    queryKey: ['admin-logs', tier, stream, lines],
    queryFn: () =>
      api.get('/admin/logs', { params: { tier, stream, lines } }).then(r => r.data.data),
    enabled: !!tier && !!stream,
    refetchInterval: false,
  });
}

