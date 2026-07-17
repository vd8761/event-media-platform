// Ported helpers from immich:server/src/utils/misc.ts.
export class StartupError extends Error {}
export const isStartUpError = (error: unknown): error is StartupError => error instanceof StartupError;

export const getKeyByValue = (object: Record<string, unknown>, value: unknown) =>
  Object.keys(object).find((key) => object[key] === value);

export const getMethodNames = (instance: any) => {
  const ctx = Object.getPrototypeOf(instance);
  const methods: string[] = [];
  for (const property of Object.getOwnPropertyNames(ctx)) {
    const descriptor = Object.getOwnPropertyDescriptor(ctx, property);
    if (!descriptor || descriptor.get || descriptor.set) {
      continue;
    }
    if (property !== 'constructor' && typeof ctx[property] === 'function') {
      methods.push(property);
    }
  }
  return methods;
};
