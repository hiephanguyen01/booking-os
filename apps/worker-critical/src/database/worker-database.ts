import type { Prisma, PrismaClient } from "@prisma/client";

const WORKER_DATABASE_ROLE = "booking_worker";

export class WorkerDatabase {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  run<T>(work: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe(`SET LOCAL ROLE ${WORKER_DATABASE_ROLE}`);
      return work(transaction);
    });
  }
}
