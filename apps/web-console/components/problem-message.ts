export async function readProblemMessage(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
      const candidate = payload as Record<string, unknown>;
      const code = typeof candidate.code === "string" ? candidate.code : `HTTP_${response.status}`;
      const message =
        typeof candidate.message === "string" ? candidate.message : "The request could not be completed.";
      return `${code}: ${message}`;
    }
  } catch {
    // Fall through to the stable status-based message.
  }

  return `HTTP_${response.status}: The request could not be completed.`;
}
