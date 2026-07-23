// _test_https.mjs — 用 Node 内置 https module 测自签证书
import https from 'node:https'
import { Buffer } from 'node:buffer'

const agent = new https.Agent({ rejectUnauthorized: false })

function req(path) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const r = https.request({
      host: '192.168.20.40',
      port: 3000,
      path: `/api${path}`,
      method: 'GET',
      agent,
      headers: {},
    }, (res) => {
      let body = ''
      res.on('data', (chunk) => body += chunk)
      res.on('end', () => {
        console.log(`${path} ${res.statusCode} ${Date.now() - t0}ms (${body.length}b)`)
        try { resolve(JSON.parse(body)) } catch { resolve(body) }
      })
    })
    r.on('error', (e) => {
      console.log(`${path} ERROR: ${e.message}`)
      reject(e)
    })
    r.end()
  })
}

async function login() {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const body = JSON.stringify({ username: 'admin', password: 'admin123' })
    const r = https.request({
      host: '192.168.20.40', port: 3000, path: '/api/auth/login',
      method: 'POST', agent,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, (res) => {
      let d = ''
      res.on('data', (c) => d += c)
      res.on('end', () => {
        console.log(`login ${res.statusCode} ${Date.now() - t0}ms`)
        resolve(JSON.parse(d).token)
      })
    })
    r.on('error', reject)
    r.write(body)
    r.end()
  })
}

const token = await login()
async function authReq(path) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const r = https.request({
      host: '192.168.20.40', port: 3000, path: `/api${path}`,
      method: 'GET', agent,
      headers: { authorization: `Bearer ${token}` },
    }, (res) => {
      let d = ''
      res.on('data', (c) => d += c)
      res.on('end', () => {
        console.log(`${path} ${res.statusCode} ${Date.now() - t0}ms`)
        resolve(JSON.parse(d))
      })
    })
    r.on('error', reject)
    r.end()
  })
}

const t0 = Date.now()
const tasks = await authReq('/tasks')
for (const t of tasks) {
  const pts = await authReq(`/tasks/${t.id}/points`)
  for (const p of pts) {
    await authReq(`/tasks/${t.id}/reports?pointId=${p.id}`)
  }
}
console.log(`Total: ${Date.now() - t0}ms`)
