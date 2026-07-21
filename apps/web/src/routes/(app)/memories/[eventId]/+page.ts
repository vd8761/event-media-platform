import { api } from '$lib/api';

export async function load({ params }: { params: { eventId: string } }) {
  const event = await api.events.get(params.eventId);
  return { event };
}
