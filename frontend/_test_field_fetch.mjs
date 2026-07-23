// _test_field_fetch.mjs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
import https from 'node:https'

const agent = new https.Agent({ rejectUnauthorized: false })

try {
  const r = await fetch('https://192.168.20.40:3000/api/health', { agent })
  console.log('STATUS:', r.status)
  console.log('BODY:', await r.text())
} catch (e) {
  console.log('ERROR:', e.message)
  console.log('CAUSE:', e.cause?.message || e.cause)
}
