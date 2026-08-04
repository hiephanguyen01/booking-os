export interface RequestContext {
  readonly requestId: string;
  readonly traceId: string;
  readonly actorId?: string;
  readonly tenantId?: string;
}
