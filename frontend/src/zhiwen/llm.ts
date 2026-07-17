/**
 * LLM 适配器 — 兼容 Ollama 原生 API + OpenAI 风格 Chat Completions
 *
 * 用于智问模块的"兜底"环节：当规则引擎置信度不足时调用本地 LLM。
 *
 * 支持的 endpoint 风格（由用户在配置中切换）：
 *  - ollama:  POST {baseUrl}/api/chat  body {model, messages, format:'json', stream:false}
 *  - openai:  POST {baseUrl}/v1/chat/completions  body {model, messages, response_format:{type:'json_object'}}
 *
 * 配置存 localStorage（key: zhiwen.llm）
 */

export type LLMStyle = 'ollama' | 'openai'

export interface LLMConfig {
  enabled: boolean
  style: LLMStyle
  baseUrl: string           // e.g. http://localhost:11434  /  http://localhost:1234
  apiKey: string            // 可空（Ollama 不需要）
  model: string             // e.g. qwen2.5:7b / llama3.1 / gpt-4
  temperature: number       // 0~1，默认 0.1（要稳定输出）
  timeoutMs: number         // 默认 30000
}

export const DEFAULT_LLM_CONFIG: LLMConfig = {
  enabled: false,
  style: 'ollama',
  baseUrl: 'http://localhost:11434',
  apiKey: '',
  model: 'qwen2.5:7b',
  temperature: 0.1,
  timeoutMs: 30000,
}

const STORAGE_KEY = 'zhiwen.llm'

export function loadLLMConfig(): LLMConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_LLM_CONFIG }
    return { ...DEFAULT_LLM_CONFIG, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_LLM_CONFIG }
  }
}

export function saveLLMConfig(cfg: LLMConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
  } catch {
    /* ignore */
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export class LLMError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

/** 调用本地 LLM，返回原始文本（模型输出） */
export async function callLLM(
  cfg: LLMConfig,
  messages: ChatMessage[],
  options?: { json?: boolean; abortSignal?: AbortSignal },
): Promise<string> {
  const json = options?.json ?? true
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs)
  options?.abortSignal?.addEventListener('abort', () => controller.abort())

  try {
    if (cfg.style === 'ollama') {
      return await callOllama(cfg, messages, json, controller.signal)
    } else {
      return await callOpenAI(cfg, messages, json, controller.signal)
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function callOllama(
  cfg: LLMConfig,
  messages: ChatMessage[],
  json: boolean,
  signal: AbortSignal,
): Promise<string> {
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/api/chat`
  const body: any = {
    model: cfg.model,
    messages,
    stream: false,
    options: { temperature: cfg.temperature },
  }
  if (json) body.format = 'json'
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`

  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
  if (!r.ok) {
    const txt = await r.text().catch(() => '')
    throw new LLMError(`Ollama ${r.status}: ${txt.slice(0, 200)}`, r.status)
  }
  const j = await r.json()
  return j?.message?.content ?? ''
}

async function callOpenAI(
  cfg: LLMConfig,
  messages: ChatMessage[],
  json: boolean,
  signal: AbortSignal,
): Promise<string> {
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/v1/chat/completions`
  const body: any = {
    model: cfg.model,
    messages,
    temperature: cfg.temperature,
    stream: false,
  }
  if (json) body.response_format = { type: 'json_object' }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`

  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
  if (!r.ok) {
    const txt = await r.text().catch(() => '')
    throw new LLMError(`OpenAI ${r.status}: ${txt.slice(0, 200)}`, r.status)
  }
  const j = await r.json()
  return j?.choices?.[0]?.message?.content ?? ''
}

/** 简单可达性测试（用于配置面板的"测试连接"按钮） */
export async function pingLLM(cfg: LLMConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const text = await callLLM(cfg, [
      { role: 'system', content: '你是测试助手，只回 1 个字：OK' },
      { role: 'user', content: 'ping' },
    ], { json: false })
    return { ok: !!text, message: `已连接，模型返回：${text.slice(0, 50)}` }
  } catch (e) {
    return { ok: false, message: (e as Error).message || '连接失败' }
  }
}
