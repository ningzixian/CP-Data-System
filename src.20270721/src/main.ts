import { buildApp } from './app.js'
import { loadConfig } from './config.js'

/**
 * 进程入口：开发与生产启动均经此。
 * - dev: tsx watch src/main.ts
 * - start: node dist/main.js
 */
async function main(): Promise<void> {
  const cfg = loadConfig()
  const app = await buildApp({ config: cfg, ensureDirs: true })

  try {
    await app.listen({ port: cfg.port, host: cfg.host })
    app.log.info(`server listening on http://${cfg.host}:${cfg.port}/api/health`)
    app.log.info(`data dir: ${cfg.dataDir}`)
    app.log.info(`photos dir: ${cfg.photosDir}`)
    app.log.info(`json dir: ${cfg.jsonDir}`)
    app.log.info(`cors origin: ${cfg.corsOrigin}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

void main()
