import { once } from "node:events";
import { createConnection, type Socket } from "node:net";
import { connect as connectTls, type TLSSocket } from "node:tls";

import type { SmtpConfig } from "../config/worker-config.js";
import type { IdentityEmailMessage, IdentityEmailSender } from "./identity-email-dispatcher.js";
import { IdentityEmailDeliveryError } from "./identity-email-error.js";

const SMTP_TIMEOUT_MS = 10_000;
const HEADER_VALUE_PATTERN = /^[^\r\n]+$/;

export interface SmtpSubmission {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface SmtpMailTransport {
  sendMail(input: SmtpSubmission): Promise<unknown>;
}

interface SmtpResponse {
  readonly code: number;
}

class SmtpProtocolError extends Error {
  readonly responseCode: number;

  constructor(responseCode: number) {
    super("SMTP command failed.");
    this.name = "SmtpProtocolError";
    this.responseCode = responseCode;
  }
}

class SmtpResponseReader {
  private buffer = "";
  private readonly responses: SmtpResponse[] = [];
  private readonly waiters: Array<{
    readonly resolve: (response: SmtpResponse) => void;
    readonly reject: (error: Error) => void;
  }> = [];
  private responseCode: number | undefined;
  private terminalError: Error | undefined;

  constructor(private readonly socket: Socket | TLSSocket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.consume(chunk));
    socket.on("error", (error: Error) => this.fail(error));
    socket.on("end", () => this.fail(new Error("SMTP connection ended.")));
  }

  async next(): Promise<SmtpResponse> {
    const queued = this.responses.shift();
    if (queued) {
      return queued;
    }
    if (this.terminalError) {
      throw this.terminalError;
    }

    return new Promise<SmtpResponse>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  private consume(chunk: string): void {
    this.buffer += chunk;

    while (true) {
      const lineEnd = this.buffer.indexOf("\r\n");
      if (lineEnd < 0) {
        return;
      }

      const line = this.buffer.slice(0, lineEnd);
      this.buffer = this.buffer.slice(lineEnd + 2);
      const match = /^(\d{3})([ -])/.exec(line);
      if (!match) {
        this.fail(new Error("Malformed SMTP response."));
        return;
      }

      const code = Number(match[1]);
      const separator = match[2];
      if (this.responseCode !== undefined && this.responseCode !== code) {
        this.fail(new Error("Inconsistent SMTP response."));
        return;
      }
      this.responseCode = code;

      if (separator === " ") {
        this.push({ code });
        this.responseCode = undefined;
      }
    }
  }

  private push(response: SmtpResponse): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve(response);
    } else {
      this.responses.push(response);
    }
  }

  private fail(error: Error): void {
    if (this.terminalError) {
      return;
    }
    this.terminalError = error;
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(error);
    }
  }
}

function assertHeaderValue(value: string): string {
  if (!HEADER_VALUE_PATTERN.test(value)) {
    throw new IdentityEmailDeliveryError("identity_email.smtp_permanent", false);
  }
  return value;
}

function normalizeMessageBody(text: string): string {
  return text
    .replace(/\r\n|\r|\n/g, "\n")
    .split("\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

async function write(socket: Socket | TLSSocket, value: string): Promise<void> {
  if (!socket.write(value, "utf8")) {
    await once(socket, "drain");
  }
}

async function expectResponse(reader: SmtpResponseReader, accepted: readonly number[]): Promise<void> {
  const response = await reader.next();
  if (!accepted.includes(response.code)) {
    throw new SmtpProtocolError(response.code);
  }
}

async function command(
  socket: Socket | TLSSocket,
  reader: SmtpResponseReader,
  value: string,
  accepted: readonly number[],
): Promise<void> {
  await write(socket, `${value}\r\n`);
  await expectResponse(reader, accepted);
}

async function openSocket(config: SmtpConfig): Promise<Socket | TLSSocket> {
  const socket = config.secure
    ? connectTls({ host: config.host, port: config.port, servername: config.host })
    : createConnection({ host: config.host, port: config.port });
  socket.setTimeout(SMTP_TIMEOUT_MS, () => socket.destroy(new Error("SMTP timeout.")));
  await once(socket, config.secure ? "secureConnect" : "connect");
  return socket;
}

export class NodeSmtpTransport implements SmtpMailTransport {
  constructor(private readonly config: SmtpConfig) {}

  async sendMail(input: SmtpSubmission): Promise<void> {
    const from = assertHeaderValue(input.from);
    const to = assertHeaderValue(input.to);
    const subject = assertHeaderValue(input.subject);
    const socket = await openSocket(this.config);
    const reader = new SmtpResponseReader(socket);

    try {
      await expectResponse(reader, [220]);
      await command(socket, reader, "EHLO booking-os", [250]);
      await command(socket, reader, `MAIL FROM:<${from}>`, [250]);
      await command(socket, reader, `RCPT TO:<${to}>`, [250, 251]);
      await command(socket, reader, "DATA", [354]);
      const body = normalizeMessageBody(input.text);
      await write(
        socket,
        [
          `From: ${from}`,
          `To: ${to}`,
          `Subject: ${subject}`,
          "MIME-Version: 1.0",
          "Content-Type: text/plain; charset=UTF-8",
          "Content-Transfer-Encoding: 8bit",
          "",
          body,
          ".",
          "",
        ].join("\r\n"),
      );
      await expectResponse(reader, [250]);
      await command(socket, reader, "QUIT", [221]);
    } finally {
      socket.destroy();
    }
  }
}

function responseCode(error: unknown): number | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "responseCode" in error &&
    typeof error.responseCode === "number"
  ) {
    return error.responseCode;
  }
  return undefined;
}

export class SmtpIdentityEmailAdapter implements IdentityEmailSender {
  constructor(
    private readonly options: Readonly<{ from: string }>,
    private readonly transport: SmtpMailTransport,
  ) {}

  async send(message: IdentityEmailMessage): Promise<void> {
    try {
      await this.transport.sendMail({
        from: this.options.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    } catch (error: unknown) {
      if (error instanceof IdentityEmailDeliveryError) {
        throw error;
      }
      const code = responseCode(error);
      if (code !== undefined && code >= 500) {
        throw new IdentityEmailDeliveryError("identity_email.smtp_permanent", false);
      }
      throw new IdentityEmailDeliveryError("identity_email.smtp_temporary", true);
    }
  }
}
