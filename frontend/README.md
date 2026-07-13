# 燃气管道阴极保护数据管理系统（前端）

面向燃气管道阴极保护“绝缘方案—现状检测”阶段的数据管理前端。目前项目可在无后端的 Mock 模式下运行，包含多小区设施地图、检测记录录入、进度看板、数据管理和管线勘测功能。

## 当前功能

### 地图视图（`/map`）

- 展示南海家园三里、六里、七里的小区边界和设施数据。
- 支持小区概览与单元详情两级地图视图。
- 展示控制单元、低压管线、绝缘接头、调压箱和引入口。
- 可分别控制各类设施的显示与隐藏。
- 点击控制单元可查看面积、管线长度、关联设施和检测进度。
- 可在详情抽屉中录入和修改 7 项现场检测记录。

### 管线勘测（`/survey`）

- 当前勘测范围为南海家园三里。
- 自动导入现场检测点坐标 CSV。
- 将 GPS 的 WGS-84 坐标转换为高德地图使用的 GCJ-02 坐标。
- 支持添加普通点、三通和弯头，并可编辑点位类型与旋转角度。
- 支持勘测点和引入口之间连线、删除管线、撤销和重做。
- 支持燃气管线、引入口、勘测点和勘测管线的独立显隐。
- 勘测成果暂存在浏览器 `localStorage`，目前尚未接入后端。

### 进度看板（`/dashboard`）

- 统计腐控单元总数、已完成、进行中、待开始和异常数量。
- 用雷达图展示各控制单元 7 项检测的完成情况。
- 用状态矩阵查看每个单元、每个检测项的状态。

### 数据管理（`/manage`）

- 查看和删除检测记录。
- 新增腐控单元。
- 预留 Excel 批量导入接口。
- Mock 模式下 Excel 导入尚未实现，需要真实后端支持。

## 技术栈

- Vue 3 + TypeScript
- Vite 5
- Pinia
- Vue Router（Hash 路由）
- Element Plus
- 高德地图 JS API 2.0
- ECharts
- Axios

## 项目结构

```text
CP Data System/
├─ docs/
│  └─ API.md                    # 后端接口约定
└─ frontend/
   ├─ public/data/              # 运行时加载的设施与现场坐标 CSV
   ├─ src/
   │  ├─ api/                   # API 调用封装及 Mock/真实后端切换
   │  ├─ components/            # 地图、表单和业务卡片组件
   │  ├─ map/                   # 高德地图统一加载器
   │  ├─ mock/                  # Mock 路由、业务数据及本地持久化
   │  ├─ stores/                # Pinia 业务状态和管线勘测状态
   │  ├─ types/                 # 业务模型、检测项和勘测类型
   │  ├─ utils/                 # CSV、几何和设施拓扑处理
   │  ├─ views/                 # 四个主页面
   │  ├─ App.vue
   │  ├─ main.ts
   │  ├─ router.ts
   │  └─ style.css
   ├─ .env.development
   ├─ .env.example
   ├─ .env.production
   ├─ package.json
   └─ vite.config.ts
```

## 数据架构

项目目前同时使用两类数据源。

### 设施空间数据

`public/data/` 下的 CSV 提供：

- 小区边界
- 控制单元多边形
- 低压燃气管线
- 绝缘接头
- 调压箱
- 引入口
- 现场勘测点坐标

应用启动后，`src/utils/facilities.ts` 会并行加载各小区数据。引入口通过点与控制单元多边形的空间关系确定归属；绝缘接头优先通过管网拓扑搜索可达引入口，再确定所属控制单元。

新增小区时，需要在 `public/data/` 中放入相应 CSV，并更新 `src/utils/facilities.ts` 中的 `COMMUNITIES`。

### 检测业务数据

管道、检测项和检测记录统一从 `src/api/` 调用：

- 开发环境默认使用 `src/mock/`。
- 接入后端时使用 `/api/*` 接口。
- Mock 检测记录会持久化到浏览器 `localStorage`。
- `src/stores/cp.ts` 将业务记录与设施数据合并并计算单元进度。

后端接口契约见 [`../docs/API.md`](../docs/API.md)。

## 7 项现场检测内容

| 编码 | 检测项 | 报价（元/km） |
| --- | --- | ---: |
| `JOINT_VERIFY` | 绝缘接头位置和绝缘性能复核 | 12,500 |
| `SOIL_RESISTIVITY` | 土壤电阻率检测 | 1,350 |
| `DC_STRAY_CURRENT` | 直流杂散电流检测 | 1,700 |
| `COATING_DETECT` | 管道防腐层非开挖检测 | 750 |
| `PIPE_GROUND_POTENTIAL` | 管地腐蚀电位检测 | 3,000 |
| `ELECTRIC_CONTINUITY` | 管道电连通性检测 | 4,500 |
| `INLET_PARAM` | 引入口参数测量 | 350 |

检测项定义位于 `src/types/items.ts`。调整检测项时，需要同步确认后端契约和已有记录的兼容性。

## 本地运行

需要 Node.js 18 或更高版本。

```bash
cd frontend
npm install
npm run dev
```

默认地址为 `http://localhost:5173`。

常用命令：

```bash
# 启动开发服务器
npm run dev

# TypeScript 检查并构建生产文件
npm run build

# 预览生产构建
npm run preview
```

## 环境配置

可从 `.env.example` 复制配置。主要变量如下：

```dotenv
# 是否使用前端 Mock
VITE_USE_MOCK=true

# 真实后端地址；留空时使用当前站点
VITE_API_BASE_URL=

# 高德 Web 端 JS API Key
VITE_AMAP_KEY=

# 仅供本地开发临时使用
VITE_AMAP_SECURITY_CODE=

# 生产环境推荐使用同源安全代理
VITE_AMAP_SERVICE_HOST=/_AMapService
```

### Mock 模式

开发环境默认配置：

```dotenv
VITE_USE_MOCK=true
```

无需启动后端即可使用主要页面。检测记录和勘测成果分别保存在浏览器本地存储中。

### 真实后端

```dotenv
VITE_USE_MOCK=false
VITE_API_BASE_URL=http://localhost:3000
```

开发服务器也配置了 `/api` 到 `http://localhost:3000` 的代理。实际部署时应按环境调整后端地址或反向代理。

### 高德地图

项目通过 `src/map/amap-loader.ts` 统一加载高德地图。生产环境不应把安全密钥直接打包到前端，推荐配置 `VITE_AMAP_SERVICE_HOST`，由服务端代理高德安全验证请求。

## 构建与部署

```bash
cd frontend
npm run build
```

输出目录为 `frontend/dist/`。项目使用 Hash 路由，可部署到 Nginx 或其他静态文件服务。若使用真实后端，还需为 `/api/` 配置反向代理。

## 当前限制

- 管线勘测页面暂时固定为南海家园三里。
- 勘测点和勘测管线仅保存在当前浏览器中。
- 勘测 ID 前缀目前固定为 `NHJY`。
- Mock 模式不执行真实 Excel 导入。
- 仓库当前仅包含前端，生产使用需要实现 `docs/API.md` 中的后端接口。

## 编码约定

- 源代码、Markdown 和 CSV 配置文本应统一保存为 UTF-8。
- 修改中文文件时，编辑器应明确使用 UTF-8，避免用系统默认 ANSI/GBK 编码覆盖。
- 如果 PowerShell 中显示乱码，应先检查终端输入输出编码；不要仅因终端显示异常就转换原文件编码。
