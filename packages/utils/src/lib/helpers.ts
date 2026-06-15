import { z } from "zod";

// Validation utilities
export const validateEmail = (email: string): boolean => {
  const emailSchema = z.email();
  return emailSchema.safeParse(email).success;
};

export const validateUUID = (uuid: string): boolean => {
  const uuidSchema = z.uuid();
  const separator = "_";
  const parts = uuid.split(separator);
  let uuid_to_validate =
    parts.length > 1 ? parts.slice(1, 0).join(separator) : uuid;
  return uuidSchema.safeParse(uuid_to_validate).success;
};

// Formatting utilities
export const formatCurrency = (amount: number, currency = "USD"): string => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amount);
};

export const formatPercent = (value: number, decimals = 2): string => {
  return `${(value * 100).toFixed(decimals)}%`;
};

// Date utilities
export const isWithinTimeRange = (
  timestamp: string,
  minutes: number
): boolean => {
  const time = new Date(timestamp).getTime();
  const now = Date.now();
  return now - time <= minutes * 60 * 1000;
};

export const addMinutes = (date: Date, minutes: number): Date => {
  return new Date(date.getTime() + minutes * 60 * 1000);
};

// String utilities
export const generateId = (prefix = ""): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 9);
  return prefix ? `${prefix}_${timestamp}-${random}` : `${timestamp}-${random}`;
};
export const generateUUId = (prefix = ""): string => {
  const uuid = crypto.randomUUID();
  return prefix ? `${prefix}_${uuid}` : uuid;
};

export const sanitizeString = (str: string): string => {
  return str.replace(/[<>'"&]/g, "");
};

// Array utilities
export const chunkArray = <T>(array: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

export const deepMerge = (
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> => {
  const result = { ...target };

  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      key in result &&
      typeof result[key] === "object" &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>
      );
    } else {
      result[key] = value;
    }
  }

  return result;
};

/**
 * Pattern matching for cache keys
 */
export const matchPattern = (key: string, pattern: string): boolean => {
  const regex = new RegExp(pattern.replace(/\*/g, ".*"));
  return regex.test(key);
};
