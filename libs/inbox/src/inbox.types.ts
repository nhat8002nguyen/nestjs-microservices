import { EntityManager } from 'typeorm';

export type InboxHandler = (
  payload: unknown,
  em: EntityManager,
) => Promise<void>;

export interface InboxModuleOptions {
  redis: { host: string; port: number };
  repeatEveryMs: number;
  take: number;
  maxAttempts: number;
  handlers: Record<string, InboxHandler>;
}

export interface InboxModuleAsyncOptions {
  imports?: any[];
  inject?: any[];
  useFactory: (
    ...args: any[]
  ) => InboxModuleOptions | Promise<InboxModuleOptions>;
}
