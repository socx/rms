import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';

const grantsKey = (eventId) => ['grants', eventId];

export function useListGrants(eventId) {
  return useQuery({
    queryKey: grantsKey(eventId),
    queryFn: () =>
      api.get(`/events/${eventId}/access`).then(r => r.data.data.grants),
    enabled: !!eventId,
  });
}

export function useCreateGrant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, userId, role }) =>
      api.post(`/events/${eventId}/access`, { userId, role }).then(r => r.data.data.grant),
    onSuccess: (_, { eventId }) => {
      qc.invalidateQueries({ queryKey: grantsKey(eventId) });
    },
  });
}

export function useUpdateGrant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, userId, role }) =>
      api.patch(`/events/${eventId}/access/${userId}`, { role }).then(r => r.data.data.grant),
    onSuccess: (_, { eventId }) => {
      qc.invalidateQueries({ queryKey: grantsKey(eventId) });
    },
  });
}

export function useDeleteGrant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, userId }) =>
      api.delete(`/events/${eventId}/access/${userId}`).then(r => r.data),
    onSuccess: (_, { eventId }) => {
      qc.invalidateQueries({ queryKey: grantsKey(eventId) });
    },
  });
}

export function useTransferOwnership() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, newOwnerId }) =>
      api.patch(`/events/${eventId}/owner`, { newOwnerId }).then(r => r.data.data.event),
    onSuccess: (_, { eventId }) => {
      qc.invalidateQueries({ queryKey: grantsKey(eventId) });
      qc.invalidateQueries({ queryKey: ['event', eventId] });
    },
  });
}
