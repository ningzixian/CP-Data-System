import jwt, { type SignOptions } from "jsonwebtoken"

/**
 * JWT helpers (HS256).
 *
 * Secret: override via JWT_SECRET env, default "dev-secret" (dev-only; production MUST set a strong secret).
 * Expiry: override via JWT_EXPIRES_IN (e.g. "7d", "1h"), default "7d".
 */
export interface JwtOptions {
  readonly secret?: string
  readonly expiresIn?: string
}

/** Resolve the JWT secret (default dev-secret). */
export function getJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  return env["JWT_SECRET"] ?? "dev-secret"
}

/** Resolve token expiry (default 7d). */
export function getJwtExpiresIn(env: NodeJS.ProcessEnv = process.env): string {
  return env["JWT_EXPIRES_IN"] ?? "7d"
}

/** Claims carried by a login token. */
export interface JwtPayload {
  readonly sub: string
  readonly username: string
}

/**
 * Sign a JWT with HS256.
 * @param payload user claims (sub + username)
 * @param opts optional secret / expiry; falls back to env defaults when omitted
 */
export function signToken(payload: JwtPayload, opts: JwtOptions = {}): string {
  const secret = opts.secret ?? getJwtSecret()
  const expiresIn = opts.expiresIn ?? getJwtExpiresIn()
  // expiresIn is a human-readable duration string (e.g. "7d"); cast to the
  // library's StringValue-typed field since a plain string is valid at runtime.
  const signOpts = { algorithm: "HS256", expiresIn } as SignOptions
  return jwt.sign(payload, secret, signOpts)
}

/**
 * Verify a JWT and return its payload; throws on invalid/expired tokens.
 * @param token raw token string (without the "Bearer " prefix)
 */
export function verifyToken(token: string, opts: JwtOptions = {}): JwtPayload {
  const secret = opts.secret ?? getJwtSecret()
  return jwt.verify(token, secret) as JwtPayload
}

/**
 * Extract the bearer token from an Authorization header.
 * Accepts a "Bearer <token>" prefix (case-insensitive); returns undefined
 * when the header is missing or malformed.
 */
export function extractBearerToken(authHeader: string | undefined): string | undefined {
  if (!authHeader) {
    return undefined
  }
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim())
  return match ? match[1] : undefined
}