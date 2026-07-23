import type { FastifyPluginAsync } from "fastify"
import { z } from "zod"
import { readCollection } from "../storage/jsonStore.js"
import { signToken, type JwtOptions } from "../auth/jwt.js"

/** Login request body contract: { username, password }. */
const LoginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

/** A user record as stored in the "users" JSON collection. */
interface UserRecord {
  id: string
  username: string
  // Stored as plaintext for simplicity in this skeleton. Production should
  // use a key-derivation hash (e.g. bcrypt) and never log credentials.
  password: string
}

/**
 * Login + auth route.
 *
 * POST /auth/login -> { token } | 401 | 400
 *
 * - Malformed body -> 400 {error}
 * - Username/password mismatch -> 401 {error}
 * - On success returns an HS256 JWT; secret and expiry are configurable via opts.
 */
export interface AuthRouteOptions extends JwtOptions {
  /** JSON collection root directory (jsonDir). */
  jsonDir: string
}

export const authRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, opts) => {
  app.post("/auth/login", async (req, reply) => {
    const parsed = LoginBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request body" })
    }
    const { username, password } = parsed.data

    const users = await readCollection<UserRecord>(opts.jsonDir, "users")
    app.log.info(`users: ${JSON.stringify(users)}`)
    const user = users.find((u) => u.username === username && u.password === password)
    if (!user) {
      return reply.code(401).send({ error: "invalid username or password" })
    }

    const token = signToken({ sub: user.id, username: user.username }, opts)
    return reply.send({ token })
  })
}