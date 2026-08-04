export type ApiErrorDetails = Readonly<Record<string, unknown>>;

export interface ApiErrorBody {
  readonly code: string;
  readonly message: string;
  readonly requestId: string;
  readonly details?: ApiErrorDetails;
}

export interface ApiErrorEnvelope {
  readonly error: ApiErrorBody;
}
