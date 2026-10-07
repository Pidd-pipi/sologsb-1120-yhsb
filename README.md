# sologsb-1120 古钟表维修工序档案（gbclockrepair）

面向钟表修复师的工序档案台：为一台古董钟表建档，记录机芯型号、零件缺失与配换、拆解顺序、清洗润滑点位，以及修复后的走时测试数据。纯前端单页应用，数据全部保存在浏览器本地。

## Docker 一键启动（推荐）

```bash
cp .env.example .env
docker compose up -d --build
```

访问地址：**http://localhost:21820**

停止服务：

```bash
docker compose down
```

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | Vue 3 + TypeScript（`<script setup>`） |
| UI | Element Plus 2 |
| 构建 | Vite 5 |
| 状态管理 | Pinia |
| 路由 | Vue Router 4（history 模式） |
| 本地存储 | IndexedDB（Dexie 4），含结构版本号与升级迁移 |

## 本地开发

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
npm run build    # vue-tsc 类型检查 + vite 构建
```

> 生产环境由 nginx 托管 `dist`，`nginx.conf` 已启用 `try_files $uri $uri/ /index.html;` 与 gzip。

## 目录结构

```
sologsb-1120/
├── docker-compose.yml
├── .env.example
├── .env
└── frontend/
    ├── Dockerfile              # 多阶段：node:20-alpine 构建 → nginx:alpine 托管
    ├── nginx.conf
    ├── index.html
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── public/favicon.svg
    └── src/
        ├── main.ts
        ├── App.vue
        ├── router/index.ts
        ├── types/{clock,part,step,test,standard}.ts
        ├── stores/{clock,part,step,standard}Store.ts
        ├── components/common/{StepSequence,RateChart,ClockCard,StateBadge}.vue
        ├── hooks/{useClockSearch,useRepairProgress}.ts
        ├── pages/{ClockList,ClockDetail,StepForm,PartList,TestView,Standards}.vue
        └── utils/{db,timeCalc,judgement,id}.ts
```

## 页面与路由

| 路由 | 页面 | 消费模型 |
| --- | --- | --- |
| `/clocks` | 钟表台账：按种类/机芯/品相/年代区间筛选，按修复状态分栏 | Clock |
| `/clocks/:id` | 钟表详情：左侧机芯信息，右侧工序流与走时测试记录，可切零件清单 | Clock、RepairStep、TimekeepingTest、MovementPart |
| `/steps/new` | 新建维修工序：选步骤类型后动态出清洗液/油脂/力矩字段，顺序号冲突即报错 | RepairStep、MovementPart |
| `/parts` | 零件与配换清单：按磨损状态分组，标出待修配条目与来源批号 | MovementPart |
| `/tests/:clockId` | 走时测试录入与多方位均值计算，生成走时单文本 | TimekeepingTest、PassStandard |
| `/standards` | 合格标准版本管理：带生效日期的多版本，修改后重算各钟表放行状态 | PassStandard、TimekeepingTest |

`/` 重定向到 `/clocks`，未匹配路由同样兜底到 `/clocks`。

## 数据存储说明

- 数据库名 `gbclockrepair`，当前结构版本 **v3**（`localStorage['gbclockrepair:db-version']` 记录）。
- 五张表：`clocks`（钟表）、`parts`（机芯零件）、`steps`（维修工序）、`tests`（走时测试）、`standards`（走时合格标准版本）。
- v1 → v2 迁移：补齐老记录的 `state`、`partIds`、`torque`、`positions` 字段并新增索引。
- v2 → v3 迁移：新增 `standards` 表（灌入两版内置标准：2026 春旧版、2026-10 收紧版）；`tests` 增加 `standardId`、`bindSource`、`verdictSnapshot` 字段。无版本记录的老测试按 `testedAt` 回填当时生效版本（`bindSource='backfill'`），早于最早版本、回填不到的标 `bindSource='legacy'`，页面判为**待复核**。
- 容器无状态、不挂载命名卷；清空站点数据即回到初始示范数据。
- 首次打开灌入 2 台示范钟表、3 项零件、3 道工序与 3 次走时测试（1 条待复核、1 条旧标准合格、1 条收紧版不合格，用于演示重算）。

## 合格标准版本化与放行重算

- **标准带生效日期**：标准按版本管理，同一生效日期唯一；测试保存时绑定当时生效版本（`bindSource='current'`），历史判定永远以绑定版本为准，并写入 `verdictSnapshot` 留痕。
- **修改即重算**：标准版本一经修改，钟表**放行状态**统一对照现行版本重算——只有最近一次测试在现行标准下仍判「合格」才可交付；老测试当年合格、现已不达标的不再放行。
- **并发编辑**：标准编辑采用乐观锁（记录 `updatedAt`）。两个页签同时改同一版本时只保留先提交的，后提交者收到冲突提示，需刷新后以最新内容重新编辑；其他页签通过 `storage` 事件自动拉新版本并重算。
- **判定依据可见**：台账卡片（悬停/展开）、钟表详情页顶部放行提示与每条测试、走时单文本均写明依据的版本名称、生效日期、阈值与实测值。

## 功能要点

- **顺序号不跳号**：新建工序时若顺序号大于「当前最大顺序号 + 1」直接报错并给出建议值；`<StepSequence>` 对缺口行标红。
- **工序排序**：支持「上移 / 下移」按钮与原生拖拽交换顺序，交换的是 `seq`。
- **工序完成 / 回退**：完成后写 `finishedAt`，回退后计入待办与回退计数。
- **双轴走时图**：`<RateChart>` 左轴日差 s/d、右轴摆幅 °，标注四方位读数与均值。
- **走时单导出**：按方位均值生成文本，可复制或下载 txt；走时单含判定标准版本与判定依据。
- **标准版本化**：见上节「合格标准版本化与放行重算」。
