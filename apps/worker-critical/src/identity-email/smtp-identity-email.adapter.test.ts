import assert from "node:assert/strict";
import { type AddressInfo, createServer } from "node:net";
import test from "node:test";

import { IdentityEmailDeliveryError } from "./identity-email-error.js";
import {
  NodeSmtpTransport,
  SmtpIdentityEmailAdapter,
} from "./smtp-identity-email.adapter.js";

const MESSAGE = {
  to: "owner@example.com",
  subject: "Activate your Booking OS account",
  text: "Open https://console.example.com/activate#token=redacted",
} as const;

test("submits a text-only identity email with the configured sender", async () => {
  const submissions: unknown[] = [];
  const adapter = new SmtpIdentityEmailAdapter(
    { from: "no-reply@booking.test" },
    {
      async sendMail(input) {
        submissions.push(input);
        return { accepted: [MESSAGE.to] };
      },
    },
  );

  await adapter.send(MESSAGE);

  assert.deepEqual(submissions, [
    {
      from: "no-reply@booking.test",
      to: MESSAGE.to,
      subject: MESSAGE.subject,
      text: MESSAGE.text,
    },
  ]);
});

test("speaks SMTP with multiline replies and dot-stuffs text bodies", async () => {
  const commands: string[] = [];
  let submittedMessage = "";
  const server = createServer((socket) => {
    let buffer = "";
    let readingData = false;
    socket.setEncoding("utf8");
    socket.write("220 smtp.test ready\r\n");

    const processBuffer = () => {
      while (true) {
        if (readingData) {
          const terminator = buffer.indexOf("\r\n.\r\n");
          if (terminator < 0) {
            return;
          }
          submittedMessage = buffer.slice(0, terminator);
          buffer = buffer.slice(terminator + 5);
          readingData = false;
          socket.write("250 queued\r\n");
          continue;
        }

        const lineEnd = buffer.indexOf("\r\n");
        if (lineEnd < 0) {
          return;
        }
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);
        commands.push(line);

        if (line.startsWith("EHLO ")) {
          socket.write("250-smtp.test\r\n250 PIPELINING\r\n");
        } else if (line.startsWith("MAIL FROM:")) {
          socket.write("250 sender ok\r\n");
        } else if (line.startsWith("RCPT TO:")) {
          socket.write("250 recipient ok\r\n");
        } else if (line === "DATA") {
          readingData = true;
          socket.write("354 send data\r\n");
        } else if (line === "QUIT") {
          socket.write("221 bye\r\n");
          socket.end();
        }
      }
    };

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      processBuffer();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;

  try {
    const transport = new NodeSmtpTransport({
      host: "127.0.0.1",
      port: address.port,
      secure: false,
      from: "no-reply@booking.test",
    });
    await transport.sendMail({
      from: "no-reply@booking.test",
      to: MESSAGE.to,
      subject: MESSAGE.subject,
      text: "first line\n.leading dot",
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  assert.deepEqual(commands, [
    "EHLO booking-os",
    "MAIL FROM:<no-reply@booking.test>",
    "RCPT TO:<owner@example.com>",
    "DATA",
    "QUIT",
  ]);
  assert.match(submittedMessage, /Content-Type: text\/plain; charset=UTF-8/u);
  assert.match(submittedMessage, /first line\r\n\.\.leading dot$/u);
});

test("classifies temporary and permanent SMTP failures without preserving provider details", async () => {
  for (const [responseCode, code, retryable] of [
    [421, "identity_email.smtp_temporary", true],
    [550, "identity_email.smtp_permanent", false],
  ] as const) {
    const adapter = new SmtpIdentityEmailAdapter(
      { from: "no-reply@booking.test" },
      {
        async sendMail() {
          throw Object.assign(new Error("SMTP rejected token=raw-secret by smtp.internal"), {
            responseCode,
            code: "EENVELOPE",
          });
        },
      },
    );

    await assert.rejects(adapter.send(MESSAGE), (error: unknown) => {
      assert.ok(error instanceof IdentityEmailDeliveryError);
      assert.equal(error.code, code);
      assert.equal(error.retryable, retryable);
      assert.equal(error.message, code);
      assert.doesNotMatch(error.message, /raw-secret|smtp\.internal|EENVELOPE/u);
      return true;
    });
  }
});
