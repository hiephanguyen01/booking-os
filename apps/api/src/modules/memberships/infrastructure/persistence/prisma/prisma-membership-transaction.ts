export interface MembershipPrismaTransaction {
  $queryRawUnsafe<T>(sql: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<number>;
}
