/**
 * 智问报告 → PDF 导出
 *
 * 策略：
 *   1. 拿到已经渲染好的 A4 报告容器（`.report-paper`）
 *   2. 把它克隆到屏幕外（off-screen）的容器里，并把所有 ECharts canvas 转成 <img>
 *   3. 用 html2canvas 逐段截屏（A4 一页一段）→ jsPDF 多页拼接
 *
 * 设计要点：
 *   - A4 尺寸 210×297mm = 794×1123px (96dpi)
 *   - 截屏时 backgroundColor 设为白色（避免透明背景）
 *   - 进度回调：onProgress(current, total) 方便 UI 显示
 *   - 失败回调：onError 抛错并把原始错误透出
 */
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'

export interface PdfExportOptions {
  /** 报告标题（也用作文件名） */
  title: string
  /** 报告副标题（可选） */
  subtitle?: string
  /** 进度回调，0~1 */
  onProgress?: (percent: number, stage: string) => void
}

const A4_WIDTH_MM = 210
const A4_HEIGHT_MM = 297
/** 96dpi 下 1mm ≈ 3.78px */
const MM_TO_PX = 3.78

/**
 * 从一个已经渲染的 .report-paper 元素生成 PDF 并下载。
 */
export async function exportReportToPDF(
  sourceEl: HTMLElement,
  opts: PdfExportOptions,
): Promise<void> {
  const { title, subtitle, onProgress } = opts
  onProgress?.(0, '准备导出…')

  // 1) 克隆源节点到屏幕外
  const wrapper = document.createElement('div')
  wrapper.style.cssText = `
    position: fixed;
    top: -100000px;
    left: 0;
    width: ${Math.round(A4_WIDTH_MM * MM_TO_PX)}px;
    background: #fff;
    z-index: -1;
    pointer-events: none;
  `
  // 浅克隆（保留样式计算后的 inline 样式）
  const clone = sourceEl.cloneNode(true) as HTMLElement
  // 把所有 scoped 样式烘焙成 inline（关键 — 否则克隆出来没样式）
  bakeStyles(sourceEl, clone)
  wrapper.appendChild(clone)
  document.body.appendChild(wrapper)

  try {
    // 2) 替换 ECharts canvas → img（html2canvas 对 canvas 支持有限，转 img 最稳）
    replaceEChartsCanvasWithImage(clone)

    // 3) 等待渲染稳定（字体、图表）
    await waitFrames(2)
    onProgress?.(0.1, '正在生成截图…')

    // 4) 整段截屏
    const canvas = await html2canvas(clone, {
      scale: 2,                          // 高清
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: clone.scrollWidth,
      windowHeight: clone.scrollHeight,
    })
    onProgress?.(0.5, '正在组装 PDF…')

    // 5) jsPDF 多页切分
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
    const pageWidth = A4_WIDTH_MM
    const pageHeight = A4_HEIGHT_MM
    /** 整张报告的毫米宽高（按比例换算） */
    const imgWidthMm = pageWidth
    const imgHeightMm = (canvas.height * imgWidthMm) / canvas.width

    /** jsPDF 用 Image 切分。我们用 canvas.toDataURL 切片的方式更稳 */
    const pageCanvasHeightPx = Math.floor((pageHeight * canvas.width) / pageWidth)
    const totalPages = Math.ceil(canvas.height / pageCanvasHeightPx)

    for (let i = 0; i < totalPages; i++) {
      const sy = i * pageCanvasHeightPx
      const sh = Math.min(pageCanvasHeightPx, canvas.height - sy)
      const pageCanvas = document.createElement('canvas')
      pageCanvas.width = canvas.width
      pageCanvas.height = sh
      const ctx = pageCanvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
      ctx.drawImage(canvas, 0, -sy)

      const pageImg = pageCanvas.toDataURL('image/jpeg', 0.92)
      if (i > 0) pdf.addPage()
      const sliceHeightMm = (sh * imgWidthMm) / canvas.width
      pdf.addImage(pageImg, 'JPEG', 0, 0, imgWidthMm, sliceHeightMm)
      onProgress?.(0.5 + (0.5 * (i + 1)) / totalPages, `写入第 ${i + 1}/${totalPages} 页`)
    }

    // 6) 元数据
    const now = new Date()
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
    const safeTitle = (title || '智问报告').replace(/[\\/:*?"<>|]/g, '_').slice(0, 50)
    pdf.setProperties({
      title: title || '智问报告',
      subject: subtitle || '阴极保护数据管理系统',
      author: '智问模块',
      creator: 'CP-Data-System Zhiwen',
    })

    pdf.save(`${safeTitle}_${stamp}.pdf`)
    onProgress?.(1, '导出完成')
  } finally {
    document.body.removeChild(wrapper)
  }
}

/* ============== 内部工具 ============== */

function waitFrames(n: number): Promise<void> {
  return new Promise((resolve) => {
    let i = 0
    const tick = () => {
      i++
      if (i >= n) resolve()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

/**
 * 把源节点计算后的样式烘焙到克隆节点上。
 * （scoped 属性选择器在克隆树上不生效，必须 inline）
 */
function bakeStyles(src: HTMLElement, dst: HTMLElement) {
  const srcAll = src.querySelectorAll<HTMLElement>('*')
  const dstAll = dst.querySelectorAll<HTMLElement>('*')
  if (srcAll.length !== dstAll.length) {
    console.warn('[pdfExporter] 源/克隆节点数不一致，样式烘焙可能不完整')
  }
  const len = Math.min(srcAll.length, dstAll.length)
  for (let i = 0; i < len; i++) {
    const s = srcAll[i]
    const d = dstAll[i]
    const cs = window.getComputedStyle(s)
    // 关键样式复制（不要全 copy，否则会和默认值打架导致 0 高度）
    const important: (keyof CSSStyleDeclaration)[] = [
      'display', 'position', 'top', 'left', 'right', 'bottom',
      'width', 'height', 'minHeight', 'maxHeight',
      'margin', 'padding', 'border', 'borderRadius',
      'background', 'backgroundColor', 'backgroundImage',
      'color', 'font', 'fontSize', 'fontWeight', 'fontFamily',
      'lineHeight', 'textAlign', 'letterSpacing',
      'flex', 'flexDirection', 'justifyContent', 'alignItems', 'gap',
      'gridTemplateColumns', 'gridGap',
      'boxShadow', 'opacity', 'overflow', 'overflowWrap', 'wordBreak',
      'whiteSpace', 'textOverflow', 'listStyle',
    ]
    for (const k of important) {
      const v = cs.getPropertyValue(k as string)
      if (v) d.style.setProperty(k as string, v)
    }
    // 源节点本身的样式也补上
    if (i === -1) {
      const csRoot = window.getComputedStyle(src)
      for (const k of important) {
        const v = csRoot.getPropertyValue(k as string)
        if (v) dst.style.setProperty(k as string, v)
      }
    }
  }
  // 根节点
  const csRoot = window.getComputedStyle(src)
  const important = [
    'display', 'width', 'padding', 'background', 'backgroundColor',
    'font', 'color', 'boxShadow',
  ] as const
  for (const k of important) {
    const v = csRoot.getPropertyValue(k as string)
    if (v) dst.style.setProperty(k as string, v)
  }
  // 关键：给克隆的根节点一个明确宽高，避免 html2canvas 算出 0
  dst.style.width = `${Math.round(A4_WIDTH_MM * MM_TO_PX)}px`
  dst.style.background = '#fff'
  dst.style.color = '#222'
  dst.style.position = 'relative'
  dst.style.left = '0'
}

/**
 * 把 ECharts 的 canvas 替换成对应的 <img>。
 * 必须在 html2canvas 之前调用，否则有些图表在克隆树里渲染会丢。
 */
function replaceEChartsCanvasWithImage(root: HTMLElement) {
  const canvases = root.querySelectorAll<HTMLCanvasElement>('canvas')
  canvases.forEach((canvas) => {
    try {
      const dataUrl = canvas.toDataURL('image/png')
      const img = document.createElement('img')
      img.src = dataUrl
      img.style.width = canvas.style.width || `${canvas.width}px`
      img.style.height = canvas.style.height || `${canvas.height}px`
      img.style.maxWidth = '100%'
      img.style.display = 'block'
      canvas.parentNode?.replaceChild(img, canvas)
    } catch (e) {
      console.warn('[pdfExporter] 转换 canvas 失败：', e)
    }
  })
}
