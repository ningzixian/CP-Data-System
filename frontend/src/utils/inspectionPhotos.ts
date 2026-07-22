/**
 * 检测模块通用照片接口。
 *
 * 当前复用已经投入使用的绝缘性能 IndexedDB，避免另建多个结构相同的图片库。
 * ownerKey 负责区分检测模块、控制单元和具体测试位置。
 */
export {
  type InsulationPhotoRecord as InspectionPhotoRecord,
  listInsulationPhotos as listInspectionPhotos,
  listInsulationPhotosForOwners as listInspectionPhotosForOwners,
  addInsulationPhotos as addInspectionPhotos,
  deleteInsulationPhoto as deleteInspectionPhoto,
  deleteInsulationPhotos as deleteInspectionPhotos,
} from './insulationPhotos'
