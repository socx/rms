import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';

const subscribersKey = (eventId) => ['subscribers', eventId];

export function useListSubscribers(eventId, { status, page, perPage } = {}) {
  return useQuery({
    queryKey: [...subscribersKey(eventId), { status, page, perPage }],
    queryFn: () =>
      api.get(`/events/${eventId}/subscribers`, {
        params: {
          ...(status  !== undefined ? { status }            : {}),
          ...(page    !== undefined ? { page }              : {}),
          ...(perPage !== undefined ? { per_page: perPage } : {}),
        },
      }).then(r => r.data.data.subscribers),
    enabled: !!eventId,
  });
}

export function useCreateSubscriber() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, ...data }) =>
      api.post(`/events/${eventId}/subscribers`, data).then(r => r.data.data.subscriber),
    onSuccess: (_, { eventId }) => {
      qc.invalidateQueries({ queryKey: subscribersKey(eventId) });
    },
  });
}

export function useUpdateSubscriber() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, subscriberId, ...data }) =>
      api.patch(`/events/${eventId}/subscribers/${subscriberId}`, data)
        .then(r => r.data.data.subscriber),
    onSuccess: (_, { eventId }) => {
      qc.invalidateQueries({ queryKey: subscribersKey(eventId) });
    },
  });
}

export function useDeleteSubscriber() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, subscriberId }) =>
      api.delete(`/events/${eventId}/subscribers/${subscriberId}`).then(r => r.data.data),
    onSuccess: (_, { eventId }) => {
      qc.invalidateQueries({ queryKey: subscribersKey(eventId) });
    },
  });
}

export function useUnsubscribe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, subscriberId }) =>
      api.post(`/events/${eventId}/subscribers/${subscriberId}/unsubscribe`)
        .then(r => r.data.data.subscriber),
    onSuccess: (_, { eventId }) => {
      qc.invalidateQueries({ queryKey: subscribersKey(eventId) });
    },
  });
}

export function useAddContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, subscriberId, ...data }) =>
      api.post(`/events/${eventId}/subscribers/${subscriberId}/contacts`, data)
        .then(r => r.data.data.contact),
    onSuccess: (_, { eventId }) => {
      qc.invalidateQueries({ queryKey: subscribersKey(eventId) });
    },
  });
}

export function useUpdateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, subscriberId, contactId, ...data }) =>
      api.patch(`/events/${eventId}/subscribers/${subscriberId}/contacts/${contactId}`, data)
        .then(r => r.data.data.contact),
    onSuccess: (_, { eventId }) => {
      qc.invalidateQueries({ queryKey: subscribersKey(eventId) });
    },
  });
}

export function useDeleteContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, subscriberId, contactId }) =>
      api.delete(`/events/${eventId}/subscribers/${subscriberId}/contacts/${contactId}`)
        .then(r => r.data.data),
    onSuccess: (_, { eventId }) => {
      qc.invalidateQueries({ queryKey: subscribersKey(eventId) });
    },
  });
}
