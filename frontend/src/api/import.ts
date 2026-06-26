import { request } from './client'

export interface ImportResult {
  imported: number
  errors: string[]
}

export const importApi = {
  /** Excel 批量导入检测记录，列要求见 docs/API.md */
  excel: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return request<ImportResult>({
      url: '/api/import/excel',
      method: 'POST',
      data: fd,
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
}