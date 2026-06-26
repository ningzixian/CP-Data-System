# API 接口约定 — 给后端开发

> 前端代码已封装好所有 API 调用（`src/api/`），后端只需按以下契约实现接口即可。  
> Base URL：`http://<server>:<port>`，所有接口前缀 `/api/`，建议走 JSON。  
> 时间格式统一 `ISO 8601`（如 `2026-06-26T09:30:00`），坐标用十进制小数（GCJ-02 火星坐标系，因为底图用高德）。

---

## 通用约定

### 响应格式
- 成功：直接返回数据（JSON 对象/数组）
- 失败：HTTP 4xx/5xx + body `{"detail": "错误说明"}`

### 分页（可选，第二阶段再上）
```json
{ "items": [...], "total": 100, "page": 1, "page_size": 20 }
```

### 鉴权（第二阶段）
- 建议 Bearer Token，Header：`Authorization: Bearer <jwt>`
- 前端 axios 拦截器可统一加，前端代码无需改业务逻辑

### 跨域
后端需允许前端域名（开发时 `http://localhost:5173`，生产时部署域名），可全部放开 `*`

---

## 接口清单

### 1. 管道 Pipeline

#### `GET /api/pipelines`
获取所有管道列表。

**响应**：`Pipeline[]`

```json
[
  {
    "id": 1,
    "name": "南京港华燃气-江宁示范段",
    "code": "NJ-JN-DEMO-001",
    "start_point": "江宁开发区 1#阀室",
    "end_point": "江宁大学城 7#阀室",
    "length_km": 8.5,
    "diameter_mm": 500,
    "install_year": 2012,
    "description": "...",
    "created_at": "2026-05-26T09:00:00"
  }
]
```

#### `GET /api/pipelines/{id}`
获取单个管道详情。

#### `POST /api/pipelines`
新建管道。Body：`PipelineInput`（除 id/created_at 外的字段）

---

### 2. 腐控单元 CorrosionUnit

#### `GET /api/units?pipeline_id={pid}`
获取腐控单元列表。`pipeline_id` 可选过滤。

**响应**：`CorrosionUnit[]`

```json
[
  {
    "id": 1,
    "pipeline_id": 1,
    "name": "JN-01",
    "start_mileage": 0,
    "end_mileage": 2100,
    "lng": 118.840,
    "lat": 31.952,
    "address": "江宁开发区站",
    "inspection_progress": 0.33,
    "inspection_status": "in_progress",
    "last_inspection_at": "2026-06-23T14:30:00",
    "note": "...",
    "created_at": "2026-06-01T10:00:00"
  }
]
```

**字段说明**：
- `inspection_progress` — 9 项检测的整体进度，0~1 之间小数
- `inspection_status` — `pending` / `in_progress` / `completed` / `exception`
- `last_inspection_at` — 最近一次检测时间（由后端在新增/更新检测记录时自动维护）

#### `GET /api/units/{id}`
#### `POST /api/units`
#### `PUT /api/units/{id}`
#### `DELETE /api/units/{id}`

---

### 3. 检测点 InspectionPoint

#### `GET /api/points?unit_id={uid}`
#### `POST /api/points`

字段：`{ unit_id, point_type, lng, lat, mileage?, bd_coord?, location_desc? }`

---

### 4. 检测项定义 Items

#### `GET /api/items`
**响应**：`InspectionItemDef[]`

```json
[
  {
    "code": "PLAN_OUTLINE",
    "name": "① 编制方案大纲",
    "pricePerKm": 450,
    "fields": [
      { "key": "plan_version", "label": "方案版本" },
      { "key": "deadline", "label": "计划完成日期" }
    ]
  }
]
```

> 注意：这是「检测项定义」接口，前端会动态渲染录入表单的字段。  
> 后端若暂时不实现，前端会 fallback 到本地静态定义（见 `src/types/items.ts`）。

---

### 5. 检测记录 InspectionRecord

#### `GET /api/records?unit_id={uid}&item_code={code}`
获取检测记录。`unit_id` 和 `item_code` 都可选。

**响应**：`InspectionRecord[]`

```json
[
  {
    "id": 100,
    "unit_id": 2,
    "point_id": 1,
    "item_code": "SOIL_RESISTIVITY",
    "item_name": "③ 土壤电阻率检测",
    "work_hours": 0.15,
    "personnel_count": 2,
    "personnel_level": "中级",
    "inspector": "张工",
    "inspection_date": "2026-06-23T14:00:00",
    "status": "passed",
    "result_summary": "检测合格，符合规范",
    "result_data": {
      "resistivity": 85.5,
      "method": "四极法",
      "depth": 1.0
    },
    "measured_value": 85.5,
    "unit": "Ω·m",
    "bd_coord": "E118.8570 N31.9480",
    "note": "...",
    "created_at": "2026-06-23T14:00:00",
    "updated_at": "2026-06-23T14:00:00"
  }
]
```

#### `POST /api/records`
新建检测记录。Body：`InspectionRecordInput`

**后端必须做的副作用**：
1. 自动填 `item_name`（根据 `item_code` 查定义）
2. 自动更新对应腐控单元的 `inspection_progress` 和 `inspection_status`
3. 自动更新腐控单元的 `last_inspection_at`

#### `PUT /api/records/{id}`
#### `DELETE /api/records/{id}`

---

### 6. 仪表盘 Dashboard

#### `GET /api/dashboard?pipeline_id={pid}`
**响应**：

```json
{
  "total_units": 4,
  "completed": 1,
  "in_progress": 1,
  "pending": 2,
  "exception": 0,
  "rows": [
    {
      "unit_id": 2,
      "unit_name": "JN-02",
      "lng": 118.857,
      "lat": 31.948,
      "progress": 0.33,
      "status": "in_progress",
      "items": [
        { "code": "PLAN_OUTLINE", "name": "① 编制方案大纲", "status": "passed" },
        { "code": "JOINT_VERIFY", "name": "② 绝缘接头位置和绝缘性能复核", "status": "passed" },
        { "code": "SOIL_RESISTIVITY", "name": "③ 土壤电阻率检测", "status": "passed" },
        { "code": "DC_STRAY_CURRENT", "name": "④ 直流杂散电流检测", "status": "pending" },
        { "code": "COATING_DETECT", "name": "⑤ 防腐层非开挖检测", "status": "pending" },
        { "code": "PIPE_GROUND_POTENTIAL", "name": "⑥ 管地腐蚀电位检测", "status": "pending" },
        { "code": "ELECTRIC_CONTINUITY", "name": "⑦ 管道电联通性检测", "status": "pending" },
        { "code": "INLET_PARAM", "name": "⑧ 引入口参数测量", "status": "pending" },
        { "code": "DATA_ENTRY", "name": "⑨ 检测数据填报", "status": "pending" }
      ]
    }
  ],
  "items": [
    { "code": "PLAN_OUTLINE", "name": "① 编制方案大纲" },
    ...
  ]
}
```

> 该接口已聚合好 9 项检测的状态，前端直接用于雷达图和详情矩阵渲染。  
> 后端推荐用 SQL JOIN 一次查出，不要让前端做 N+1 查询。

---

### 7. Excel 导入

#### `POST /api/import/excel`
- Content-Type: `multipart/form-data`
- Form field: `file`（.xlsx 或 .xls）

**Excel 列要求**（第一行表头）：

| 列名 | 必填 | 说明 |
|---|---|---|
| `unit_name` | ✅ | 腐控单元名称（已存在则复用，否则创建） |
| `pipeline_id` | | 所属管道 ID（不填默认 1） |
| `lng` | | 经度 |
| `lat` | | 纬度 |
| `address` | | 地址 |
| `item_code` | ✅ | 9 项检测项编码（见下表） |
| `status` | | pending / passed / exception |
| `inspector` | | 检测员 |
| `inspection_date` | | 检测时间（ISO 8601 或 Excel 日期） |
| `measured_value` | | 主测量值（数字） |
| `unit` | | 单位 |
| `bd_coord` | | 北斗坐标 |
| `note` | | 备注 |

**9 项检测项编码表**：

| code | 名称 |
|---|---|
| `PLAN_OUTLINE` | ① 编制方案大纲 |
| `JOINT_VERIFY` | ② 绝缘接头位置和绝缘性能复核 |
| `SOIL_RESISTIVITY` | ③ 土壤电阻率检测 |
| `DC_STRAY_CURRENT` | ④ 直流杂散电流检测 |
| `COATING_DETECT` | ⑤ 管道防腐层非开挖检测 |
| `PIPE_GROUND_POTENTIAL` | ⑥ 管地腐蚀电位检测 |
| `ELECTRIC_CONTINUITY` | ⑦ 管道电联通性检测 |
| `INLET_PARAM` | ⑧ 引入口参数测量 |
| `DATA_ENTRY` | ⑨ 检测数据填报 |

**响应**：

```json
{
  "imported": 50,
  "errors": ["行 12: unit_name 为空", "行 23: item_code 不合法"]
}
```

---

## 数据模型（TypeScript 定义）

前端类型定义在 `frontend/src/types/models.ts`，后端可直接对照实现：

```typescript
interface Pipeline {
  id: number
  name: string
  code?: string
  start_point?: string
  end_point?: string
  length_km?: number
  diameter_mm?: number
  install_year?: number
  description?: string
  created_at: string  // ISO 8601
}

interface CorrosionUnit {
  id: number
  pipeline_id: number
  name: string
  start_mileage?: number  // 米
  end_mileage?: number    // 米
  lng?: number            // GCJ-02 经度（和高德地图一致）
  lat?: number            // GCJ-02 纬度
  address?: string
  /** 管道走向轨迹，地图上画绿色实线。每个腐控单元一段线，连接上下游绝缘接头 */
  polyline?: Array<[number, number]>  // [[lat, lng], [lat, lng], ...]
  inspection_progress: number  // 0~1
  inspection_status: 'pending' | 'in_progress' | 'completed' | 'exception'
  last_inspection_at?: string  // ISO 8601
  note?: string
  created_at: string
}

interface InspectionRecord {
  id: number
  unit_id: number
  point_id?: number
  item_code: 'PLAN_OUTLINE' | 'JOINT_VERIFY' | 'SOIL_RESISTIVITY' | 'DC_STRAY_CURRENT'
           | 'COATING_DETECT' | 'PIPE_GROUND_POTENTIAL' | 'ELECTRIC_CONTINUITY'
           | 'INLET_PARAM' | 'DATA_ENTRY'
  item_name?: string
  work_hours?: number
  personnel_count?: number
  personnel_level?: '初级' | '中级' | '高级' | '专家'
  inspector?: string
  inspection_date?: string  // ISO 8601
  status: 'pending' | 'passed' | 'exception'
  result_summary?: string
  result_data?: Record<string, any>  // 自由 JSON，键值见 /api/items 返回的 fields
  measured_value?: number
  unit?: string
  bd_coord?: string  // 北斗坐标原始字符串
  note?: string
  created_at: string
  updated_at: string
}
```

---

## 实现优先级建议

**P0（必须）**：
1. `GET /api/pipelines`、`GET /api/units`、`GET /api/items` — 前端首页/地图渲染必需
2. `GET /api/dashboard` — 看板必需

**P1（重要）**：
3. `POST/PUT/DELETE /api/records` — 录入数据必需
4. `POST /api/units` — 创建单元必需
5. 后端副作用：保存记录时自动更新单元的进度和状态

**P2（可后补）**：
6. `POST /api/import/excel` — Excel 批量导入
7. `GET/POST /api/points` — 检测点管理（前端目前只用 unit_id 关联，没有详细编辑界面）
8. `PUT/DELETE /api/units` — 单元编辑删除

---

## 推荐后端技术栈

基于用户选择：**前端 Vue + 后端 Node.js**，建议：

- **Node.js 20+** + **Express** 或 **Fastify** 或 **NestJS**
- **数据库**：PostgreSQL 15+ + PostGIS（地理空间查询），起步可 SQLite
- **ORM**：Prisma / TypeORM / Drizzle
- **鉴权**：JWT（第二阶段再上）
- **部署**：PM2 / Docker

---

## 切换 mock → 真实后端

前端无需改代码，只需修改 `frontend/.env.production`：

```bash
VITE_USE_MOCK=false
VITE_API_BASE_URL=http://10.0.1.50:3000   # 公司服务器内网地址
```

重新 `npm run build` 即可。