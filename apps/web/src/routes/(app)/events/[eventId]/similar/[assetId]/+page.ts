import { api } from '$lib/api';

export async function load({ params }: { params: { eventId: string; assetId: string } }) {
  const event = await api.events.get(params.eventId);
  return { event, assetId: params.assetId };
}
