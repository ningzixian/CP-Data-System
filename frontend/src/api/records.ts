import type { InspectionRecord, InspectionRecordInput, InspectionItemCode } from '@/types/models'

let readonlyRecords: InspectionRecord[] = []

export function setReadonlyRecords(records: InspectionRecord[]) {
  readonlyRecords = records.map((record) => ({ ...record }))
}

function readonlyError(): never {
  throw new Error('手机端后端数据当前为只读，未启用新增、修改或删除操作')
}

export const recordsApi = {
  async list(params?: { unit_id?: number; item_code?: InspectionItemCode }) {
    return readonlyRecords.filter((record) =>
      (params?.unit_id === undefined || record.unit_id === params.unit_id)
      && (params?.item_code === undefined || record.item_code === params.item_code),
    )
  },
  async create(_data: InspectionRecordInput): Promise<InspectionRecord> {
    return readonlyError()
  },
  async update(_id: number, _data: InspectionRecordInput): Promise<InspectionRecord> {
    return readonlyError()
  },
  async remove(_id: number): Promise<{ ok: boolean }> {
    return readonlyError()
  },
}
