import { api } from '$lib/api';

export async function load() {
  const events = await api.events.listMine();
  return { events };
}
