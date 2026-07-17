// R2 key scheme (docs/plan/04-storage-r2.md §2). org/event prefixing makes
// cascade deletion a single deletePrefix and keeps blast radius obvious.
export const StorageKeys = {
  original: (orgId: string, eventId: string, assetId: string, ext: string) =>
    `org/${orgId}/event/${eventId}/original/${assetId}${ext}`,
  preview: (orgId: string, eventId: string, assetId: string) =>
    `org/${orgId}/event/${eventId}/preview/${assetId}.jpeg`,
  thumb: (orgId: string, eventId: string, assetId: string) =>
    `org/${orgId}/event/${eventId}/thumb/${assetId}.webp`,
  video: (orgId: string, eventId: string, assetId: string) =>
    `org/${orgId}/event/${eventId}/video/${assetId}.mp4`,
  person: (orgId: string, eventId: string, personId: string) =>
    `org/${orgId}/event/${eventId}/person/${personId}.jpeg`,
  selfie: (orgId: string, eventId: string, participantId: string) =>
    `org/${orgId}/event/${eventId}/selfie/${participantId}.jpg`,
  eventPrefix: (orgId: string, eventId: string) => `org/${orgId}/event/${eventId}/`,
  orgPrefix: (orgId: string) => `org/${orgId}/`,
};
