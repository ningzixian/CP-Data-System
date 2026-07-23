// _test_vite_fetch.mjs — 模拟 Vite middleware 的 fetch
import https from 'node:https'
https.globalAgent = new https.Agent({ rejectUnauthorized: false })

try {
  const r = await fetch('https://192.168.20.40:3000/api/health')
  console.log('STATUS:', r.status)
  console.log('BODY:', await r.text())
} catch (e) {
  console.log('ERROR:', e.message)
  console.log('CAUSE:', e.cause)
}
