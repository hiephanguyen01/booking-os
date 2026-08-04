export function assertHasOwnKeys(
  value: unknown,
  keys: readonly string[],
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Expected a non-null object");
  }

  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw new Error(`Expected object to have own key: ${key}`);
    }
  }
}
