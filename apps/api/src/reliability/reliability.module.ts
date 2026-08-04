import { Global, Module } from "@nestjs/common";

import { OutboxRepository } from "./outbox.repository.js";

@Global()
@Module({
  providers: [OutboxRepository],
  exports: [OutboxRepository],
})
export class ReliabilityModule {}
