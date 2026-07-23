import { z } from 'zod'

/**
 * 共享数据契约（后端与前端均依据本文件扩展）。
 * 本阶段仅定义 schema 骨架与派生类型，具体业务 CRUD 在后续功能项实现。
 */

/** 压力等级枚举：低压 / 中压A / 中压B */
export const PressureLevelSchema = z.enum(['low', 'medA', 'medB'])
export type PressureLevel = z.infer<typeof PressureLevelSchema>

/** 任务 Task */
export const TaskSchema = z.object({
  id: z.string(),
  name: z.string(),
  area: z.string(),
  unit: z.string(),
  buildings: z.array(z.string()),
  pressureLevel: PressureLevelSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Task = z.infer<typeof TaskSchema>

/** 检测项数据类型枚举 */
export const DataTypeSchema = z.enum([
  '位置',
  '土壤电阻率',
  '土壤酸碱值',
  '管线探测',
  '馈电实验',
])
export type DataType = z.infer<typeof DataTypeSchema>

/** 检测点 DetectionPoint */
export const DetectionPointSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  /** 编号 (同一任务内唯一, 简单序号) */
  seq: z.number(),
  location: z.string(),
  lng: z.number(),
  lat: z.number(),
  dataTypes: z.array(DataTypeSchema),
  createdAt: z.string(),
})
export type DetectionPoint = z.infer<typeof DetectionPointSchema>

/** 土壤电阻率填报项 */
export const SoilResistivityItemSchema = z.object({
  地钎距离: z.number(),
  电阻值: z.number(),
  电阻率: z.number(),
  /** 照片相对路径列表（与前端 string[] 契约一致） */
  photos: z.array(z.string()),
})

/** 土壤酸碱值填报项 */
export const SoilPhItemSchema = z.object({
  酸碱度: z.number(),
  photos: z.array(z.string()),
})

/** 管线探测填报项 */
export const PipelineDetectionItemSchema = z.object({
  rtkNo: z.string(),
  埋深: z.number(),
  破损点: z.boolean(),
  photos: z.array(z.string()),
})

/** 检测填报 items（各子项可选） */
export const DetectionReportItemsSchema = z
  .object({
    土壤电阻率: SoilResistivityItemSchema.optional(),
    土壤酸碱值: SoilPhItemSchema.optional(),
    管线探测: PipelineDetectionItemSchema.optional(),
  })
  .strict()

/** 检测填报 DetectionReport */
export const DetectionReportSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  pointId: z.string(),
  items: DetectionReportItemsSchema,
  createdAt: z.string(),
})
export type DetectionReport = z.infer<typeof DetectionReportSchema>

/** 照片上传响应 */
export const PhotoUploadResponseSchema = z.object({
  path: z.string(),
})
export type PhotoUploadResponse = z.infer<typeof PhotoUploadResponseSchema>

/** 健康检查响应 */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
})
export type HealthResponse = z.infer<typeof HealthResponseSchema>
