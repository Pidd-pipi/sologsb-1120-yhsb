import Dexie, { type Table } from 'dexie';
import type { Clock } from '../types/clock';
import type { MovementPart } from '../types/part';
import type { RepairStep } from '../types/step';
import type { TimekeepingTest } from '../types/test';
import type { TestStandard } from '../types/standard';
import { newId } from './id';

export const DB_NAME = 'gbclockrepair';
export const DB_VERSION = 3;
export const LS_VERSION_KEY = 'gbclockrepair:db-version';

/** 内置标准版本固定 id，保证迁移回填与全新灌库引用一致 */
export const STD_OLD_ID = 'std_2024_loose';
export const STD_NEW_ID = 'std_2026_tight';

/** 当地时区某日 00:00 的时间戳（生效日期按本地日历计算） */
function localMidnight(year: number, monthIndex: number, day: number): number {
  return new Date(year, monthIndex, day).getTime();
}

class ClockRepairDB extends Dexie {
  clocks!: Table<Clock, string>;
  parts!: Table<MovementPart, string>;
  steps!: Table<RepairStep, string>;
  tests!: Table<TimekeepingTest, string>;
  standards!: Table<TestStandard, string>;

  constructor() {
    super(DB_NAME);
    // v1：四张业务表
    this.version(1).stores({
      clocks: 'id, clockNo, kind, caliber, conditionGrade, createdAt',
      parts: 'id, clockId, name, wearState, decision',
      steps: 'id, clockId, seq, stepType, state',
      tests: 'id, clockId, testedAt',
    });
    // v2：补索引并迁移老记录缺省字段
    this.version(2)
      .stores({
        clocks: 'id, clockNo, kind, caliber, conditionGrade, createdAt',
        parts: 'id, clockId, name, wearState, decision, sourceLot',
        steps: 'id, clockId, seq, stepType, state, startedAt',
        tests: 'id, clockId, testedAt, conclusion',
      })
      .upgrade(async (tx) => {
        await tx
          .table('steps')
          .toCollection()
          .modify((row: any) => {
            if (!row.state) row.state = 'pending';
            if (row.partIds === undefined) row.partIds = [];
            if (row.torque === undefined) row.torque = 0;
          });
        await tx
          .table('tests')
          .toCollection()
          .modify((row: any) => {
            if (row.positions === undefined) row.positions = [];
          });
      });
    // v3：合格标准版本化；standards 表 + 测试绑定版本；旧测试按日期回填，回填不到标待复核
    this.version(3)
      .stores({
        clocks: 'id, clockNo, kind, caliber, conditionGrade, createdAt',
        parts: 'id, clockId, name, wearState, decision, sourceLot',
        steps: 'id, clockId, seq, stepType, state, startedAt',
        tests: 'id, clockId, testedAt, standardId, reviewPending',
        standards: 'id, code, effectiveFrom, revision',
      })
      .upgrade(async (tx) => {
        const now = Date.now();
        const standards: any[] = [
          {
            id: STD_OLD_ID,
            code: 'STD-2010-01',
            name: '机械钟表走时合格标准（旧标准）',
            note: '2010 年起执行的放宽口径；2026-10 起被新标准替代，但旧测试仍按本版本判定。',
            thresholds: {
              ratePass: 15,
              amplitudeMin: 220,
              beatErrorMax: 1.0,
              rateUsable: 40,
              beatErrorUsableMax: 1.5,
            },
            effectiveFrom: localMidnight(2010, 0, 1),
            createdAt: localMidnight(2010, 0, 1),
            updatedAt: localMidnight(2010, 0, 1),
            revision: 1,
          },
          {
            id: STD_NEW_ID,
            code: 'STD-2026-10',
            name: '机械钟表走时合格标准（收紧版）',
            note: '2026 年 10 月收紧：日差 ±10 s/d、摆幅≥250°、偏振≤0.8 ms。',
            thresholds: {
              ratePass: 10,
              amplitudeMin: 250,
              beatErrorMax: 0.8,
              rateUsable: 30,
              beatErrorUsableMax: 1.2,
            },
            effectiveFrom: localMidnight(2026, 9, 1),
            createdAt: now,
            updatedAt: now,
            revision: 1,
          },
        ];
        await tx.table('standards').bulkAdd(standards);

        // 旧数据无版本记录：按测试日期回填当时生效版本；早于最早版本的标待复核
        await tx
          .table('tests')
          .toCollection()
          .modify((row: any) => {
            if (row.standardId !== undefined && row.standardId !== null && row.standardId !== '') return;
            const std =
              typeof row.testedAt === 'number'
                ? standards
                    .filter((s: any) => s.effectiveFrom <= row.testedAt)
                    .sort((a: any, b: any) => b.effectiveFrom - a.effectiveFrom)[0]
                : undefined;
            if (std) {
              row.standardId = std.id;
              row.standardCode = std.code;
              row.thresholds = { ...std.thresholds };
              row.reviewPending = false;
            } else {
              // 早于最早版本生效日（或测试时间缺失）→ 回填不了，待人工复核
              row.standardId = '';
              row.standardCode = '';
              row.reviewPending = true;
            }
          });
      });
  }
}

export const db = new ClockRepairDB();

/** 内置的两版标准（全新灌库与 v3 迁移共用） */
export function seedStandards(now = Date.now()): TestStandard[] {
  return [
    {
      id: STD_OLD_ID,
      code: 'STD-2010-01',
      name: '机械钟表走时合格标准（旧标准）',
      note: '2010 年起执行的放宽口径；2026-10 起被新标准替代，但旧测试仍按本版本判定。',
      thresholds: {
        ratePass: 15,
        amplitudeMin: 220,
        beatErrorMax: 1.0,
        rateUsable: 40,
        beatErrorUsableMax: 1.5,
      },
      effectiveFrom: localMidnight(2010, 0, 1),
      createdAt: localMidnight(2010, 0, 1),
      updatedAt: localMidnight(2010, 0, 1),
      revision: 1,
    },
    {
      id: STD_NEW_ID,
      code: 'STD-2026-10',
      name: '机械钟表走时合格标准（收紧版）',
      note: '2026 年 10 月收紧：日差 ±10 s/d、摆幅≥250°、偏振≤0.8 ms。',
      thresholds: {
        ratePass: 10,
        amplitudeMin: 250,
        beatErrorMax: 0.8,
        rateUsable: 30,
        beatErrorUsableMax: 1.2,
      },
      effectiveFrom: localMidnight(2026, 9, 1),
      createdAt: now,
      updatedAt: now,
      revision: 1,
    },
  ];
}

/**
 * 把 Vue 响应式代理（reactive/ref 内部对象，含嵌套数组）转成可结构化克隆的普通对象。
 * IndexedDB 的 put/add 无法克隆 Proxy，否则抛 DataCloneError。
 */
export function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function markDbVersion(): void {
  try {
    window.localStorage.setItem(LS_VERSION_KEY, String(DB_VERSION));
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

export function readDbVersion(): number {
  try {
    const raw = window.localStorage.getItem(LS_VERSION_KEY);
    return raw ? Number(raw) : DB_VERSION;
  } catch {
    return DB_VERSION;
  }
}

/** 标准表为空（老库被清理过 / 全新库首次打开）时补齐内置两版标准 */
export async function ensureSeedStandards(now = Date.now()): Promise<TestStandard[]> {
  const existing = await db.standards.toArray();
  if (existing.length > 0) return existing.sort((a, b) => a.effectiveFrom - b.effectiveFrom);
  const standards = seedStandards(now);
  await db.standards.bulkPut(standards);
  return standards;
}

/** 首次进入灌入示范数据，保证页面非空壳 */
export async function ensureSeedData(): Promise<void> {
  // 标准版本必须先就位：示范测试保存时即绑定当时生效版本
  const standards = await ensureSeedStandards();
  const count = await db.clocks.count();
  if (count > 0) return;

  const now = Date.now();
  const day = 24 * 3600 * 1000;
  const clockA = newId('clk');
  const clockB = newId('clk');

  const clocks: Clock[] = [
    {
      id: clockA,
      clockNo: 'CLK-1932-004',
      kind: '座钟',
      caliber: 'Junghans W278',
      origin: '德国',
      maker: 'Junghans',
      yearMade: '1932',
      caseMaterial: '胡桃木壳 + 铜机芯',
      size: '420×260×180',
      dialMark: 'Junghans 八日链，罗马数字盘',
      acquireFrom: '天津藏家转让',
      conditionGrade: '三级',
      storagePos: '修复台 A-2',
      createdAt: now - 20 * day,
    },
    {
      id: clockB,
      clockNo: 'CLK-1890-011',
      kind: '怀表',
      caliber: 'Longines 18.79',
      origin: '瑞士',
      maker: 'Longines',
      yearMade: '1890',
      caseMaterial: '银质猎壳',
      size: '52×18',
      dialMark: '白瓷盘，罗马数字，小秒针',
      acquireFrom: '上海拍卖会',
      conditionGrade: '二级',
      storagePos: '保险柜 B-1',
      createdAt: now - 9 * day,
    },
  ];

  const parts: MovementPart[] = [
    {
      id: newId('prt'),
      clockId: clockA,
      name: '发条',
      qtyNeeded: 1,
      position: '条盒内',
      wearState: '断裂',
      decision: '换新',
      sourceLot: 'MS-2024-07',
      dimension: 0.35,
    },
    {
      id: newId('prt'),
      clockId: clockA,
      name: '宝石轴承',
      qtyNeeded: 4,
      position: '二轮上下轴孔',
      wearState: '磨损',
      decision: '修配',
      sourceLot: 'JWL-18',
      dimension: 1.2,
    },
    {
      id: newId('prt'),
      clockId: clockB,
      name: '摆轮',
      qtyNeeded: 1,
      position: '摆轮夹板下',
      wearState: '完好',
      decision: '保留',
      sourceLot: '',
      dimension: 14.5,
    },
  ];

  const steps: RepairStep[] = [
    {
      id: newId('stp'),
      clockId: clockA,
      stepType: '拆解',
      seq: 1,
      partIds: [parts[0].id],
      cleanSolvent: '',
      cleanMethod: '',
      oilType: '',
      oilPoints: '',
      torque: 0.6,
      troubleNote: '条盒盖螺纹轻微锈死，用渗透油浸润后拆下',
      operator: '祁仲言',
      startedAt: now - 40 * day,
      finishedAt: now - 40 * day + 80 * 60000,
      state: 'done',
    },
    {
      id: newId('stp'),
      clockId: clockA,
      stepType: '清洗',
      seq: 2,
      partIds: [parts[1].id],
      cleanSolvent: '石油醚 + 无水乙醇',
      cleanMethod: '超声',
      oilType: '',
      oilPoints: '',
      torque: 0,
      troubleNote: '宝石轴承孔内油泥结块，超声 3 遍',
      operator: '祁仲言',
      startedAt: now - 37 * day,
      finishedAt: now - 37 * day + 45 * 60000,
      state: 'done',
    },
    {
      id: newId('stp'),
      clockId: clockA,
      stepType: '润滑',
      seq: 3,
      partIds: [parts[1].id],
      cleanSolvent: '',
      cleanMethod: '',
      oilType: 'Moebius 9010',
      oilPoints: '二轮上下轴孔、擒纵叉瓦',
      torque: 0,
      troubleNote: '',
      operator: '祁仲言',
      startedAt: now - 34 * day,
      finishedAt: now - 34 * day + 30 * 60000,
      state: 'done',
    },
  ];

  /** 按测试时间绑定当时生效版本并留存阈值快照；早于最早版本的标待复核 */
  const bind = (test: TimekeepingTest): TimekeepingTest => {
    const std = standards
      .filter((s) => s.effectiveFrom <= test.testedAt)
      .sort((a, b) => b.effectiveFrom - a.effectiveFrom)[0];
    if (std) {
      return { ...test, standardId: std.id, standardCode: std.code, thresholds: { ...std.thresholds }, reviewPending: false };
    }
    return { ...test, standardId: '', standardCode: '', reviewPending: true };
  };

  // ① 2008 年旧档：早于最早标准版本，回填不了 → 待复核；
  // ② 2023 年旧档：按日期回填旧版本，按旧阈值判合格（新阈值下仅可用，历史判定保留）；
  // ③ 35 天前（2026-09）测试：当时旧标准判合格，标准本月收紧不影响其历史判定；
  // ④ 2 天前测试：按 10 月新标准只够「可用（需再调）」，修复全完成仍不予放行。
  const tests: TimekeepingTest[] = [
    bind({
      id: newId('tst'),
      clockId: clockA,
      testedAt: localMidnight(2008, 2, 15),
      amplitude: 205,
      beatError: 1.4,
      rate: 26,
      positions: [
        { position: '面上', rate: 24.5, amplitude: 208, beatError: 1.3 },
        { position: '面下', rate: 27.8, amplitude: 202, beatError: 1.5 },
        { position: '12上', rate: 25.1, amplitude: 206, beatError: 1.4 },
        { position: '6上', rate: 26.6, amplitude: 204, beatError: 1.4 },
      ],
      powerReserve: 36,
      conclusion: '入藏初测（老台账按旧口径记合格，无版本记录）',
    }),
    bind({
      id: newId('tst'),
      clockId: clockA,
      testedAt: localMidnight(2023, 4, 12),
      amplitude: 232,
      beatError: 0.8,
      rate: 12,
      positions: [
        { position: '面上', rate: 10.5, amplitude: 238, beatError: 0.7 },
        { position: '面下', rate: 13.8, amplitude: 226, beatError: 0.9 },
        { position: '12上', rate: 11.1, amplitude: 234, beatError: 0.8 },
        { position: '6上', rate: 12.6, amplitude: 230, beatError: 0.8 },
      ],
      powerReserve: 40,
      conclusion: '按旧标准判合格（收紧后只算可用）',
    }),
    bind({
      id: newId('tst'),
      clockId: clockA,
      testedAt: now - 35 * day,
      amplitude: 238,
      beatError: 0.7,
      rate: 12.5,
      positions: [
        { position: '面上', rate: 11.2, amplitude: 244, beatError: 0.6 },
        { position: '面下', rate: 13.8, amplitude: 232, beatError: 0.8 },
        { position: '12上', rate: 12.1, amplitude: 240, beatError: 0.7 },
        { position: '6上', rate: 12.9, amplitude: 236, beatError: 0.7 },
      ],
      powerReserve: 44,
      conclusion: '按旧标准判合格',
    }),
    bind({
      id: newId('tst'),
      clockId: clockA,
      testedAt: now - 2 * day,
      amplitude: 258,
      beatError: 0.6,
      rate: 14.2,
      positions: [
        { position: '面上', rate: 12.8, amplitude: 262, beatError: 0.5 },
        { position: '面下', rate: 15.4, amplitude: 254, beatError: 0.7 },
        { position: '12上', rate: 13.9, amplitude: 260, beatError: 0.6 },
        { position: '6上', rate: 14.7, amplitude: 256, beatError: 0.6 },
      ],
      powerReserve: 46,
      conclusion: '收紧标准复测',
    }),
  ];

  await db.transaction('rw', db.clocks, db.parts, db.steps, db.tests, db.standards, async () => {
    await db.clocks.bulkPut(clocks);
    await db.parts.bulkPut(parts);
    await db.steps.bulkPut(steps);
    await db.tests.bulkPut(tests);
  });
}
