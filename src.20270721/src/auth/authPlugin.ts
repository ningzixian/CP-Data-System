import type { FastifyReply, FastifyRequest } from "fastify"
import { extractBearerToken, verifyToken, type JwtOptions } from "./jwt.js"

/**
 * Anonymous auth Fastify preHandler decorator.
 *
 * Validates "Authorization: Bearer <token>" and replies 401 {error} on failure.
 *
 * Usage: pass { preHandler: authPlugin(opts) } on routes that require auth.
 * Caching: opts are captured once; routes sharing the same config reuse the
 * same preHandler instance to avoid per-route allocation.
 */
export interface AuthPluginOptions extends JwtOptions {}

export function authPlugin(opts: AuthPluginOptions = {}) {
  // Capture the provided opts; verifyToken resolves env-based defaults when
  // secret / expiresIn are omitted, so we forward them unchanged.
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = extractBearerToken(req.headers.authorization)
    if (!token) {
      // Missing or malformed Authorization header.
      await reply.code(401).send({ error: "missing or invalid Authorization header" })
      return
    }
    try {
      const payload = verifyToken(token, opts)
      // Annotate the request with the verified user for downstream handlers.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(req as any).user = payload
    } catch {
      // Invalid or expired token: uniform 401.
      await reply.code(401).send({ error: "invalid or expired token" })
    }
  }
}

/** Augment FastifyRequest to expose the verified user set by authPlugin. */
declare module "fastify" {
  interface FastifyRequest {
    user?: { sub: string; username: string }
  }
}