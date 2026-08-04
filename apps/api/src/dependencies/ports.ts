export interface PostgresQueryResultPort {
  readonly rows: readonly unknown[];
}

export interface PostgresPoolPort {
  query(text: string): Promise<PostgresQueryResultPort>;
  end(): Promise<void>;
  on(event: "error", listener: (error: unknown) => void): this;
}

export interface RedisClientPort {
  readonly status: string;
  ping(): Promise<string>;
  quit(): Promise<string>;
  disconnect(reconnect?: boolean): void;
  on(event: "error", listener: (error: unknown) => void): this;
}
