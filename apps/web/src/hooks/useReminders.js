import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';

const remindersKey = (eventId) => ['reminders', eventId];

export function useListReminders(eventId) {
  return useQuery({
    queryKey: remindersKey(eventId),
    queryFn: () =>
      api.get(`/events/${eventId}/reminders`).then(r => r.data.data.reminders),
    enabled: !!eventId,
  });
}

export function useGetReminder(eventId, reminderId) {
  return useQuery({
    queryKey: ['reminder', eventId, reminderId],
    queryFn: () =>
      api.get(`/events/${eventId}/reminders/${reminderId}`).then(r => r.data.data.reminder),
    enabled: !!eventId && !!reminderId,
  });
}

export function useCreateReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, ...data }) =>
      api.post(`/events/${eventId}/reminders`, data).then(r => r.data.data.reminder),
    onSuccess: (_, { eventId }) => {
      qc.invalidateQueries({ queryKey: remindersKey(eventId) });
    },
  });
}

export function useUpdateReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, reminderId, ...data }) =>
      api.patch(`/events/${eventId}/reminders/${reminderId}`, data).then(r => r.data.data.reminder),
    onSuccess: (_, { eventId }) => {
      qc.invalidateQueries({ queryKey: remindersKey(eventId) });
    },
  });
}

export function useDeleteReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, reminderId }) =>
      api.delete(`/events/${eventId}/reminders/${reminderId}`).then(r => r.data.data),
    onSuccess: (_, { eventId }) => {
      qc.invalidateQueries({ queryKey: remindersKey(eventId) });
    },
  });
}

export function usePreviewReminder() {
  return useMutation({
    mutationFn: ({ eventId, reminderId, ...data }) =>
      api.post(`/events/${eventId}/reminders/${reminderId}/preview`, data)
        .then(r => r.data.data),
  });
}
