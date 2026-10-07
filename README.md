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
        ├── hooks/{useClockSearch,useRepairProgress,useClockRelease}.ts
        ├── pages/{ClockList,ClockDetail,StepForm,PartList,TestView,StandardsPage}.vue
        └── utils/{db,timeCalc,id,judge,crossTab}.ts
```

## 页面与路由

| 路由 | 页面 | 消费模型 |
| --- | --- | --- |
| `/clocks` | 钟表台账：按种类/机芯/品相/年代/放行状态筛选，按修复状态分栏，卡片显示重算后的放行状态 | Clock、RepairStep、TimekeepingTest、TestStandard |
| `/clocks/:id` | 钟表详情：左侧机芯信息，右侧工序流与走时测试记录（含重算结论、绑定版本、判定依据、待复核处理），可切零件清单 | Clock、RepairStep、TimekeepingTest、MovementPart、TestStandard |
| `/steps/new` | 新建维修工序：选步骤类型后动态出清洗液/油脂/力矩字段，顺序号冲突即报错 | RepairStep、MovementPart |
| `/parts` | 零件与配换清单：按磨损状态分组，标出待修配条目与来源批号 | MovementPart |
| `/tests/:clockId?` | 走时测试录入（保存即绑定当时生效版本）、多方位均值与判定预演，生成含判定依据的走时单 | TimekeepingTest、TestStandard |
| `/standards` | 走时合格标准版本管理：生效日期/阈值维护、修改后事务内重算、revision 乐观锁防并发覆盖 | TestStandard、TimekeepingTest |

`/` 重定向到 `/clocks`，未匹配路由同样兜底到 `/clocks`。

## 数据存储说明

- 数据库名 `gbclockrepair`，当前结构版本 **v3**（`localStorage['gbclockrepair:db-version']` 记录）。
- 五张表：`clocks`（钟表）、`parts`（机芯零件）、`steps`（维修工序）、`tests`（走时测试）、`standards`（合格标准版本）。
- v1 → v2 迁移：补齐老记录的 `state`、`partIds`、`torque`、`positions` 字段并新增索引。
- v2 → v3 迁移：合格标准版本化。补入内置两版标准（STD-2010-01 放宽版、STD-2026-10 本月收紧版）；旧测试按 `testedAt` 回填当时生效版本并写入阈值快照，早于最早版本（回填不了）的标 `reviewPending` 待复核。
- 容器无状态、不挂载命名卷；清空站点数据即回到初始示范数据。
- 首次打开灌入 2 台示范钟表、3 项零件、3 道工序与 4 次走时测试（含 1 条待复核旧档与按新旧两版标准分别判定的记录）。

## 合格标准版本化与放行

- **标准带生效日期**：`/standards`（合格标准页签）维护版本编号、生效日期（含当日 00:00）与五项阈值（合格：日差上限/摆幅下限/偏振上限；可用：日差/偏振上限）。
- **测试绑定当时版本**：每次走时测试保存时，按 `testedAt` 自动找到当时生效的版本，把版本 id、编号与阈值快照写入测试记录；之后标准再收紧也不改写历史判定。
- **改标准即重算**：修改任一版本后，同一 IndexedDB 事务内刷新全部相关测试的阈值快照，钟表放行状态（未测试/待复核/可放行/不予放行，以最近一次测试的重算结论为准）在台账、钟表详情、走时单实时更新，并写明判定依据（版本编号、生效日期、阈值、命中条款）。
- **并发控制**：标准带 `revision` 乐观锁，两个页签同时编辑同一版本只保留先提交的修改，后提交收到冲突提示并需刷新重开；页签间通过 BroadcastChannel（回退 storage 事件）互通知重拉。
- **旧数据处理**：无版本记录的测试按日期回填；回填不了的标「待复核」，不进可交付台账，可在钟表详情人工指定当时执行的版本（生效日晚于测试日期的版本会被拒绝），补录更早版本时会自动回填。
- **走时单**：导出文本含系统判定结论、绑定标准版本、生效日期与完整阈值依据；人工备注不再参与系统判定。

## 功能要点

- **顺序号不跳号**：新建工序时若顺序号大于「当前最大顺序号 + 1」直接报错并给出建议值；`<StepSequence>` 对缺口行标红。
- **工序排序**：支持「上移 / 下移」按钮与原生拖拽交换顺序，交换的是 `seq`。
- **工序完成 / 回退**：完成后写 `finishedAt`，回退后计入待办与回退计数。
- **双轴走时图**：`<RateChart>` 左轴日差 s/d、右轴摆幅 °，标注四方位读数与均值。
- **走时单导出**：按方位均值生成文本，可复制或下载 txt。
