import AMapLoader from '@amap/amap-jsapi-loader'

let loading: Promise<any> | null = null

/**
 * 统一加载高德 JS API 2.0。
 * 生产环境应配置 serviceHost，由服务端保存安全密钥；securityJsCode 只用于本地调试。
 */
export function loadAMap(): Promise<any> {
  if (loading) return loading

  const key = import.meta.env.VITE_AMAP_KEY as string | undefined
  const serviceHost = import.meta.env.VITE_AMAP_SERVICE_HOST as string | undefined
  const securityJsCode = import.meta.env.DEV
    ? import.meta.env.VITE_AMAP_SECURITY_CODE as string | undefined
    : undefined

  if (!key) return Promise.reject(new Error('缺少 VITE_AMAP_KEY，无法加载高德地图'))

  window._AMapSecurityConfig = serviceHost
    ? { serviceHost }
    : securityJsCode
      ? { securityJsCode }
      : undefined

  loading = AMapLoader.load({
    key,
    version: '2.0',
    plugins: ['AMap.Scale', 'AMap.ToolBar'],
  }) as Promise<any>

  return loading
}

declare global {
  interface Window {
    _AMapSecurityConfig?: {
      serviceHost?: string
      securityJsCode?: string
    }
  }
}
