export type { RequestContext } from "@booking-os/contracts";

export interface RequestHeaders {
  readonly [name: string]: string | string[] | undefined;
}

export interface RequestWithHeaders {
  readonly headers: RequestHeaders;
  readonly requestId?: string;
}

export interface ResponseWithHeaders {
  setHeader(name: string, value: string): void;
}
