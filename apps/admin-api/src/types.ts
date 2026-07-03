import type { createDb } from '@org/db';

export type DbClient = ReturnType<typeof createDb>;
