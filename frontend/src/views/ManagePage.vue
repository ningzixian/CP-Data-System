<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useCpStore } from '@/stores/cp'
import { unitsApi } from '@/api/units'
import { recordsApi } from '@/api/records'
import { importApi } from '@/api/import'
import StatusTag from '@/components/StatusTag.vue'
import type { CorrosionUnitInput, InspectionRecord } from '@/types/models'

const store = useCpStore()

const createVisible = ref(false)
const newUnit = reactive<CorrosionUnitInput>({
  pipeline_id: 1,
  name: '',
  start_mileage: 0,
  end_mileage: 0,
  lng: 118.85,
  lat: 31.95,
  address: '',
})

function fmt(d?: string) {
  if (!d) return '—'
  return new Date(d).toLocaleString('zh-CN')
}

const filteredRecords = computed(() => store.records)

async function submitNewUnit() {
  if (!newUnit.name) {
    ElMessage.warning('请输入单元名称')
    return
  }
  await unitsApi.create(newUnit)
  ElMessage.success('创建成功')
  createVisible.value = false
  newUnit.name = ''
  newUnit.start_mileage = 0
  newUnit.end_mileage = 0
  newUnit.address = ''
  await store.loadAll()
}

async function deleteRecord(row: InspectionRecord) {
  try {
    await ElMessageBox.confirm(`确认删除「${row.item_name}」的记录？`, '提示', { type: 'warning' })
  } catch {
    return
  }
  await recordsApi.remove(row.id)
  ElMessage.success('已删除')
  await store.loadAll()
}

async function uploadExcel(req: any) {
  try {
    const r = await importApi.excel(req.file)
    ElMessage.success(`导入完成：成功 ${r.imported} 条，失败 ${r.errors.length} 条`)
    if (r.errors.length) console.warn('导入错误：', r.errors)
    await store.loadAll()
  } catch (e: any) {
    ElMessage.error('导入失败：' + (e?.message || '未知错误'))
  }
}
</script>

<template>
  <div class="page-container">
    <el-card shadow="never">
      <template #header>
        <div style="display:flex;align-items:center">
          <b style="font-size:15px">检测记录（{{ filteredRecords.length }} 条）</b>
          <div style="flex:1"></div>
          <el-upload :http-request="uploadExcel" :show-file-list="false" accept=".xlsx,.xls">
            <el-button type="primary" plain>📥 Excel 批量导入</el-button>
          </el-upload>
          <el-button type="success" @click="createVisible = true" style="margin-left:8px">
            + 新增腐控单元
          </el-button>
          <el-button @click="store.loadAll()" style="margin-left:8px">刷新</el-button>
        </div>
      </template>

      <el-table :data="filteredRecords" stripe border>
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column label="所属单元" width="140">
          <template #default="{ row }">{{ store.unitName(row.unit_id) }}</template>
        </el-table-column>
        <el-table-column prop="item_name" label="检测项" min-width="200" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <StatusTag :status="row.status" />
          </template>
        </el-table-column>
        <el-table-column label="测量值" width="140">
          <template #default="{ row }">
            <span v-if="row.measured_value !== null && row.measured_value !== undefined">
              {{ row.measured_value }} <small style="color:#909399">{{ row.unit }}</small>
            </span>
            <span v-else style="color:#c0c4cc">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="inspector" label="检测员" width="100" />
        <el-table-column label="检测时间" width="170">
          <template #default="{ row }">{{ fmt(row.inspection_date) }}</template>
        </el-table-column>
        <el-table-column prop="result_summary" label="摘要" min-width="180" show-overflow-tooltip />
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="danger" link @click="deleteRecord(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="createVisible" title="新增腐控单元" width="500px">
      <el-form :model="newUnit" label-width="100px">
        <el-form-item label="单元名称" required>
          <el-input v-model="newUnit.name" placeholder="如 JN-05" />
        </el-form-item>
        <el-form-item label="所属管道">
          <el-select v-model="newUnit.pipeline_id" placeholder="选择管道" style="width:100%">
            <el-option v-for="p in store.pipelines" :key="p.id" :label="p.name" :value="p.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="起点里程 (m)">
          <el-input-number v-model="newUnit.start_mileage" :precision="2" :step="100" style="width:100%" />
        </el-form-item>
        <el-form-item label="终点里程 (m)">
          <el-input-number v-model="newUnit.end_mileage" :precision="2" :step="100" style="width:100%" />
        </el-form-item>
        <el-form-item label="经度">
          <el-input-number v-model="newUnit.lng" :precision="6" style="width:100%" />
        </el-form-item>
        <el-form-item label="纬度">
          <el-input-number v-model="newUnit.lat" :precision="6" style="width:100%" />
        </el-form-item>
        <el-form-item label="地址">
          <el-input v-model="newUnit.address" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" @click="submitNewUnit">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>