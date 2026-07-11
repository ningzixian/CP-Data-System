# 燃气管道阴极保护数据管理系统 — 前端

**第一阶段：绝缘方案-现状检测** — 纯前端展示，后端接口预留。

---

## 项目结构

```
CP Data System/
├── frontend/                ← 你在这里写代码
│   ├── src/
│   │   ├── api/             ← 后端接口调用层（封装 axios）
│   │   │   ├── client.ts        axios 实例 + mock 切换
│   │   │   ├── pipelines.ts     管道 CRUD
│   │   │   ├── units.ts         腐控单元 CRUD
│   │   │   ├── points.ts        检测点 CRUD
│   │   │   ├── records.ts       检测记录 CRUD
│   │   │   ├── items.ts         9 项检测项定义
│   │   │   ├── dashboard.ts     仪表盘统计
│   │   │   └── import.ts        Excel 导入
│   │   ├── components/      ← 复用组件
│   │   │   ├── MapView.vue          主地图（高德 JS API 2.0）
│   │   │   ├── SurveyMapView.vue    管线勘测地图（高德 JS API 2.0）
│   │   │   ├── UnitCard.vue         腐控单元卡片
│   │   │   ├── InspectionForm.vue   9 项检测录入表单
│   │   │   └── StatusTag.vue        状态标签
│   │   ├── views/           ← 三个主页面
│   │   │   ├── MapPage.vue          地图 + 单元列表 + 抽屉录入
│   │   │   ├── DashboardPage.vue    进度看板（雷达图+矩阵）
│   │   │   └── ManagePage.vue       数据管理（表格+Excel 导入+新增单元）
│   │   ├── stores/cp.ts     ← Pinia 全局状态
│   │   ├── mock/            ← Mock 数据 + 适配器（不依赖后端能跑）
│   │   ├── types/           ← TypeScript 类型定义（前后端契约）
│   │   │   ├── models.ts
│   │   │   └── items.ts
│   │   ├── router.ts        ← Vue Router
│   │   ├── App.vue          ← 入口组件
│   │   ├── main.ts          ← 启动文件
│   │   └── style.css        ← 全局样式
│   ├── .env.development     ← 开发环境变量（默认 mock=true）
│   ├── .env.production      ← 生产环境变量（mock=false，待填后端地址）
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── README.md
├── docs/
│   └── API.md               ← 给后端开发看的接口约定文档
├── 讯腾报价.xlsx            ← 原始报价文件（参考）
└── README.md                ← 本文件
```

---

## 快速开始

### 1. 安装依赖

需要 Node.js 18+：

```bash
cd frontend
npm install
```

### 2. 启动开发服务器

```bash
npm run dev
```

打开 `http://localhost:5173` 即可看到界面，**无需后端**（默认 mock 模式）。

### 3. 演示数据

mock 数据里预置了：
- 1 条管道（南京港华燃气-江宁示范段）
- 4 个腐控单元（JN-01 ~ JN-04）
- 13 条检测记录（JN-02 部分完成、JN-04 全部完成）

打开就能看到效果。

### 4. 切到真实后端

后端联调时，修改 `frontend/.env.development`：

```bash
VITE_USE_MOCK=false
VITE_API_BASE_URL=http://localhost:3000   # 或公司内网地址
```

无需改任何前端代码。

---

## 三个页面功能

### 🗺️ 地图视图 (`/map`)
- **左侧**：4 个统计卡 + 腐控单元卡片列表（点击高亮+地图飞行）
- **右侧**：高德地图 + 腐控单元标记（百分比+颜色显示进度）
- **抽屉**：点击单元或标记打开抽屉，按 9 项检测分类 Tab，每个 Tab 一个录入表单

### 📊 进度看板 (`/dashboard`)
- **4 个统计卡**：总数 / 已完成 / 进行中 / 异常
- **雷达图**：每个腐控单元 9 项检测的完成度
- **详情矩阵**：横轴 9 项检测 × 纵轴单元，单元格颜色显示状态

### 📋 数据管理 (`/manage`)
- **检测记录表格**：所有检测记录的列表
- **Excel 批量导入**：上传 .xlsx 批量导入
- **新增腐控单元**：弹窗表单（包含经纬度、里程、地址）

---

## 9 项检测项（与报价文件 R3-R11 对应）

| 编码 | 名称 | 报价（元/km） |
|---|---|---|
| `PLAN_OUTLINE` | ① 编制方案大纲 | 450 |
| `JOINT_VERIFY` | ② 绝缘接头位置和绝缘性能复核 | 12,500 |
| `SOIL_RESISTIVITY` | ③ 土壤电阻率检测 | 1,350 |
| `DC_STRAY_CURRENT` | ④ 直流杂散电流检测 | 1,700 |
| `COATING_DETECT` | ⑤ 管道防腐层非开挖检测 | 750 |
| `PIPE_GROUND_POTENTIAL` | ⑥ 管地腐蚀电位检测 | 3,000 |
| `ELECTRIC_CONTINUITY` | ⑦ 管道电联通性检测 | 4,500 |
| `INLET_PARAM` | ⑧ 引入口参数测量 | 350 |
| `DATA_ENTRY` | ⑨ 检测数据填报 | 300 |

合计约 **25,000 元/km**

---

## 常用命令

```bash
# 开发（mock 模式）
npm run dev

# 开发（连接真实后端）
# 先改 .env.development 的 VITE_USE_MOCK=false
npm run dev

# 构建生产包
npm run build
# → dist/ 目录可丢到任何静态服务器（Nginx、公司服务器）

# 本地预览构建产物
npm run preview

# 类型检查
npm run build   # vue-tsc --noEmit 会自动跑
```

---

## 部署到公司服务器（VPN 内网）

### 1. 构建

```bash
npm run build
```

输出在 `frontend/dist/`，纯静态文件。

### 2. 上传到服务器

把 `dist/` 整个目录上传到服务器，比如 `/var/www/cp-frontend/`。

### 3. Nginx 配置（示例）

```nginx
server {
    listen 80;
    server_name cp.xxx.local;   # 你的内网域名

    root /var/www/cp-frontend;
    index index.html;

    # SPA 路由 fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 反代后端 API（如果后端在同一台机器）
    location /api/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # 缓存静态资源
    location ~* \.(js|css|png|jpg|svg|woff2?)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

### 4. 内网访问

通过 VPN 连接后访问 `http://cp.xxx.local` 即可。

---

## 开发小贴士

### 加一个 API 调用

在 `src/api/` 加文件，导出对象：

```typescript
// src/api/foo.ts
import { request } from './client'

export const fooApi = {
  list: () => request<Foo[]>({ url: '/api/foo', method: 'GET' }),
}
```

在组件里：

```typescript
import { fooApi } from '@/api/foo'
const list = await fooApi.list()
```

### 加一个视图

1. 在 `src/views/` 加 `FooPage.vue`
2. 在 `src/router.ts` 注册路由

### 改 9 项检测项

直接改 `src/types/items.ts` 的 `INSPECTION_ITEMS` 数组即可。

### 切换 mock 数据

修改 `src/mock/data.ts` 即可。

---

## 后端开发对接

后端开发请看 `../docs/API.md`，里面有完整的接口约定、请求/响应示例、数据模型 TS 定义。

后端实现完后，修改 `.env.production` 切到真实地址即可，无需改前端代码。

---

## 移动端适配

Element Plus 本身是响应式的，地图和表单在手机上都能用。但有以下建议：

- 抽屉宽度在小屏幕下可能过宽，可在 CSS 里 `@media (max-width: 768px)` 调整
- 现场录入的 GPS 定位 + 北斗坐标字段已预留（`bd_coord`），可在手机 H5 里调用 `navigator.geolocation`

如果后续要做原生 Android App（你提到过），可以考虑：
- **UniApp / Taro** — Vue 代码编译为 Android/iOS
- **WebView 套壳** — 最简单，直接打包为 APK

---

## 技术栈

- **Vue 3.4** — Composition API + `<script setup>`
- **TypeScript 5** — 完整类型约束
- **Vite 5** — 极速开发服务器
- **Pinia 2** — Vuex 的继任者，更轻量
- **Vue Router 4** — Hash 模式（无需后端路由配合）
- **Element Plus 2.6** — UI 组件库
- **高德地图 JS API 2.0** — 主地图与管线勘测地图
- **ECharts 5** — 图表（雷达图）
- **Axios 1.6** — HTTP 客户端

---

## 常见问题

**Q: 后端还没准备好，怎么预览？**  
A: 默认就是 mock 模式，`npm run dev` 直接看效果。

**Q: 改完代码没生效？**  
A: Vite 是热更新的，浏览器会自动刷新；如果没动，强制刷新（Ctrl+Shift+R）。

**Q: 地图加载不出来？**  
A: 检查网络（高德瓦片需要外网访问）。公司内网可以换成天地图瓦片 URL（在 `src/components/MapView.vue` 改 `AMAP_URL`）。

**Q: 9 项检测项的数据怎么录入？**  
A: 在地图视图点击任意单元 → 抽屉弹出 → 按 9 个 Tab 切换 → 每个 Tab 一个表单 → 填完点保存。

**Q: 怎么加第十项检测？**  
A: 在 `src/types/items.ts` 的 `INSPECTION_ITEMS` 数组加一项，前端自动渲染。后端 `InspectionRecord.ITEM_CODES` 同步加。

---

## 许可与引用

报价数据来源：`讯腾报价.xlsx`（项目原始文件）。
