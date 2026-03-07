/**
 * IPC Input Validation Utilities
 * Uses Zod schemas to validate IPC handler inputs
 */

import { z } from 'zod';

export interface ValidationResult<T> {
  success: true;
  data: T;
}

export interface ValidationError {
  success: false;
  error: string;
  issues?: z.ZodIssue[];
}

/**
 * Validate input against a Zod schema
 * Returns either success with data or error with details
 */
export function validate<T>(
  schema: z.ZodSchema<T>,
  input: unknown,
): ValidationResult<T> | ValidationError {
  const result = schema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    error: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
    issues: result.error.errors,
  };
}

/**
 * Create a validated IPC handler wrapper
 * Returns an error response if validation fails
 */
export function withValidation<TInput, TOutput>(
  schema: z.ZodSchema<TInput>,
  handler: (input: TInput) => Promise<TOutput>,
): (input: unknown) => Promise<TOutput | { error: string }> {
  return async (input: unknown) => {
    const result = validate(schema, input);
    if (!result.success) {
      return { error: result.error };
    }
    return handler(result.data);
  };
}

// ─── Common Schemas ───────────────────────────────────────────────────────────

/** Valid file path (non-empty string) */
export const FilePathSchema = z.string().min(1, 'File path is required');

/** Valid ID (non-empty string) */
export const IdSchema = z.string().min(1, 'ID is required');

/** Valid tag name (non-empty string, max 100 chars) */
export const TagNameSchema = z
  .string()
  .min(1, 'Tag name is required')
  .max(100, 'Tag name too long');

/** Papers list query schema */
export const PapersListQuerySchema = z.object({
  q: z.string().optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  tag: z.string().optional(),
  importedWithin: z.enum(['today', 'week', 'month', 'all']).optional(),
});

/** Tagging merge schema */
export const TaggingMergeSchema = z.object({
  keep: TagNameSchema,
  remove: z.array(TagNameSchema).min(1, 'At least one tag to remove is required'),
});

/** CLI run options schema */
export const CliRunOptionsSchema = z.object({
  tool: z.string().min(1, 'Tool command is required'),
  args: z.array(z.string()).default([]),
  sessionId: z.string().min(1, 'Session ID is required'),
  cwd: z.string().optional(),
  envVars: z.string().optional(),
  useProxy: z.boolean().optional(),
});

/** Environment variable name pattern - only allow safe names */
const ENV_VAR_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Environment variable string schema (KEY=value pairs separated by spaces) */
export const EnvVarsStringSchema = z.string().superRefine((val, ctx) => {
  if (!val) return;

  // Parse and validate each KEY=value pair
  // Support quoted values: KEY="value with spaces" or KEY='value with spaces'
  const pairs: string[] = [];
  let current = '';
  let inQuote: '"' | "'" | null = null;

  for (let i = 0; i < val.length; i++) {
    const char = val[i];

    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (char === ' ' || char === '\t') {
      if (current) {
        pairs.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current) pairs.push(current);

  // Validate each pair
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid env var format: "${pair}" (expected KEY=value)`,
      });
      continue;
    }

    const key = pair.slice(0, eq);
    if (!ENV_VAR_NAME_PATTERN.test(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid env var name: "${key}" (must start with letter or underscore, contain only alphanumeric or underscore)`,
      });
    }
  }
});

/**
 * Parse environment variables string into object
 * Supports: KEY=value KEY="value with spaces" KEY='value with spaces'
 */
export function parseEnvVars(envVarsString: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!envVarsString) return result;

  let current = '';
  let currentKey = '';
  let inQuote: '"' | "'" | null = null;
  let afterEq = false;

  for (let i = 0; i < envVarsString.length; i++) {
    const char = envVarsString[i];

    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (char === '=' && !afterEq) {
      currentKey = current;
      current = '';
      afterEq = true;
    } else if ((char === ' ' || char === '\t') && afterEq) {
      if (currentKey && ENV_VAR_NAME_PATTERN.test(currentKey)) {
        result[currentKey] = current;
      }
      current = '';
      currentKey = '';
      afterEq = false;
    } else {
      current += char;
    }
  }

  // Handle last pair
  if (currentKey && afterEq && ENV_VAR_NAME_PATTERN.test(currentKey)) {
    result[currentKey] = current;
  }

  return result;
}
