export function postIdentityCommand(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
}
