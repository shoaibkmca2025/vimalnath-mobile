import { HTTPException } from 'hono/http-exception';
import { validator } from 'hono/validator';
import type { z } from 'zod';

/** Checks input against a schema. A failure becomes a 400 that names the first bad field. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issue = result.error.issues[0]!;
  throw new HTTPException(400, { message: issue.message, cause: { field: issue.path.join('.') || undefined } });
}

/** Route middleware: checks the JSON body, then a handler reads it with c.req.valid('json'). */
export const jsonBody = <T extends z.ZodType>(schema: T) => validator('json', (input) => parse(schema, input));
