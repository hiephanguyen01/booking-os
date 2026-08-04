import type { IncomingMessage } from "node:http";

export interface RequestWithContext extends IncomingMessage {
  requestId: string;
}
