// App-shell state: which organization is active, its sidebar events, storage
// footer and notifications.
//
// Held in one store rather than loaded per-route so navigating between Photos,
// People and an event does not re-fetch and re-flash the sidebar. Routes that
// change this data (creating an event, picking a cover) call refresh().
import { api, type OrgNotification, type OrgShell, type QuotaStatus, type SidebarEvent } from '$lib/api';

class ShellStore {
  #orgId = $state<string | null>(null);
  #shell = $state<OrgShell | null>(null);
  #notifications = $state<OrgNotification[]>([]);
  #unread = $state(0);
  #quota = $state<QuotaStatus | null>(null);
  #loading = $state(false);

  get orgId() {
    return this.#orgId;
  }
  get events(): SidebarEvent[] {
    return this.#shell?.events ?? [];
  }
  // Null until loaded, and stays null if the request fails — the sidebar then
  // falls back to showing raw usage rather than an invented limit.
  get quota(): QuotaStatus | null {
    return this.#quota;
  }
  get storage() {
    return this.#shell?.storage ?? { bytes: 0, assets: 0 };
  }
  // Nav gating reads these. Both default to 0 while the shell is still
  // loading, which hides the conditional entries — better than showing a link
  // for a second and snatching it away as the real numbers arrive.
  get hasAssets() {
    return (this.#shell?.storage.assets ?? 0) > 0;
  }
  get namedPeople() {
    return this.#shell?.namedPeople ?? 0;
  }
  get notifications() {
    return this.#notifications;
  }
  get unread() {
    return this.#unread;
  }
  get loading() {
    return this.#loading;
  }

  // Called by the (app) layout once `me` is known. Re-entrant: switching org
  // clears first so the sidebar never shows the previous org's events.
  async load(orgId: string | null) {
    if (orgId === this.#orgId && this.#shell) {
      return;
    }
    this.#orgId = orgId;
    this.#shell = null;
    this.#notifications = [];
    this.#unread = 0;
    this.#quota = null;
    if (!orgId) {
      return;
    }
    await this.refresh();
  }

  async refresh() {
    const orgId = this.#orgId;
    if (!orgId) {
      return;
    }
    this.#loading = true;
    try {
      // Notifications are best-effort — a failure there must not blank the
      // sidebar, which is the actual navigation.
      const [shell, notifications, quota] = await Promise.all([
        api.orgs.shell(orgId),
        api.orgs.notifications(orgId).catch(() => ({ items: [], unread: 0 })),
        api.orgs.quota(orgId).catch(() => null),
      ]);
      this.#shell = shell;
      this.#notifications = notifications.items;
      this.#unread = notifications.unread;
      this.#quota = quota;
    } finally {
      this.#loading = false;
    }
  }
}

export const shellStore = new ShellStore();

export function formatBytes(bytes: number): string {
  if (!bytes) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
