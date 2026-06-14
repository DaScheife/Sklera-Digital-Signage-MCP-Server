import { z } from "zod";

/**
 * Optional `instance` selector shared by every tool. It lets a single
 * connection (env, header or OAuth) address any configured Sklera domain via
 * the ClientRegistry; omitting it uses the default instance. The field is
 * stripped from request bodies in handlers that forward their params verbatim,
 * so it never reaches the Sklera API.
 */
export const instanceField = {
  instance: z
    .string()
    .optional()
    .describe(
      "Optional: name of the configured Sklera instance/domain to query. Omit for the default instance."
    ),
};
