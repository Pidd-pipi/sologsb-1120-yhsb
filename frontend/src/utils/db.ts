import Dexie, { type Table } from 'dexie';
import type { Clock } from '../types/clock';
import type { MovementPart } from '../types/part';
import type { RepairStep } from '../types/step';
import type { TimekeepingTest } from '../types/test';
import { effectiveStandardAt, judgeBy } from './judgement';
import { newId } from './id';
import { parseDate, type PassStandard } from '../types/standard';

export const DB_NAME = 'gbclockrepair';
export const DB_VERSION = 3;
export const LS_VERSION_KEY = 'gbclockrepair:db-version';

/** 内置标准版本 id（首次打开灌入 / 迁移时补齐） */
export const SEED_STANDARD_V1 = 'std_seed_2026spring';
export const SEED_STANDARD_V2 = 'std_seed_202610';

class ClockRepairDB extends Dexie {
  clocks!: Table<Clock, string>;
  parts!: Table<MovementPart, string>;
  steps!: Table<RepairStep, string>;
  tests!: Table<TimekeepingTest, string>;
  standards!: Table<PassStandard, string>;

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
    // v3：合格标准版本化；走时测试绑定生效版本
    this.version(3).stores({
      clocks: 'id, clockNo, kind, caliber, conditionGrade, createdAt',
      parts: 'id, clockId, name, wearState, decision, sourceLot',
      steps: 'id, clockId, seq, stepType, state, startedAt',
      tests: 'id, clockId, testedAt, conclusion, standardId',
      standards: 'id, name, effectiveAt, updatedAt',
    });
  }
}

export const db = new ClockRepairDB();

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

/** 本月收紧前后的两版内置标准 */
function seedStandards(): PassStandard[] {
  const now = Date.now();
  return [
    {
      id: SEED_STANDARD_V1,
      name: '2026年春版（旧标准）',
      effectiveAt: parseDate('2026-01-01'),
      maxAbsRate: 10,
      maxBeatError: 0.8,
      minAmplitude: 250,
      usableMaxAbsRate: 30,
      usableMaxBeatError: 1.2,
      note: '沿用多年的老判据：日差 10 s/d 内、摆幅 250° 以上即合格。',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: SEED_STANDARD_V2,
      name: '2026-10 收紧版',
      effectiveAt: parseDate('2026-10-01'),
      maxAbsRate: 5,
      maxBeatError: 0.5,
      minAmplitude: 270,
      usableMaxAbsRate: 20,
      usableMaxBeatError: 0.8,
      note: '本月起收紧：日差收至 5 s/d、摆幅提至 270°、偏振收至 0.5 ms。',
      createdAt: now,
      updatedAt: now,
    },
  ];
}

/**
 * 老数据回填：无版本记录的测试，按 testedAt 找回当时生效的版本绑定；
 * 早于最早版本、回填不到的保持无绑定，页面判为「待复核」。
 */
async function backfillLegacyTests(standards: PassStandard[]): Promise<void> {
  if (standards.length === 0) return;
  // 无绑定标准版本的记录：旧库记录 standardId 字段缺失，新库未绑定者为空串
  const unbound = await db.tests.filter((t) => !t.standardId).toArray();
  if (unbound.length === 0) return;
  await db.transaction('rw', db.tests, async () => {
    for (const test of unbound) {
      const std = effectiveStandardAt(standards, test.testedAt);
      if (!std) {
        await db.tests.update(test.id, {
          standardId: '',
          bindSource: 'legacy',
          verdictSnapshot: '',
        });
        continue;
      }
      await db.tests.update(test.id, {
        standardId: std.id,
        bindSource: 'backfill',
        verdictSnapshot: judgeBy(test.rate, test.beatError, test.amplitude, std),
      });
    }
  });
}

/** 首次进入灌入示范数据，保证页面非空壳 */
export async function ensureSeedData(): Promise<void> {
  // 标准版本优先补齐（老库升级时 standards 表为空）
  if ((await db.standards.count()) === 0) {
    await db.standards.bulkPut(seedStandards());
  }
  const standards = await db.standards.toArray();

  const count = await db.clocks.count();
  if (count > 0) {
    await backfillLegacyTests(standards);
    return;
  }

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
      createdAt: now - 320 * day,
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
      createdAt: now - 309 * day,
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
      startedAt: now - 312 * day,
      finishedAt: now - 312 * day + 80 * 60000,
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
      startedAt: now - 308 * day,
      finishedAt: now - 308 * day + 45 * 60000,
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
      startedAt: now - 303 * day,
      state: 'done',
    },
  ];

  // 三条历史测试先按「无版本记录」灌入，随后由 backfillLegacyTests 回填：
  // 最早一条早于任何版本 → 回填不到 → 待复核；
  // 5 月一条按旧标准判合格；10 月一条旧标准下合格，按本月收紧版重算不合格。
  const tests: TimekeepingTest[] = [
    {
      id: newId('tst'),
      clockId: clockA,
      testedAt: now - 300 * day,
      amplitude: 275,
      beatError: 0.3,
      rate: 4,
      positions: [
        { position: '面上', rate: 3.6, amplitude: 278, beatError: 0.3 },
        { position: '面下', rate: 4.4, amplitude: 272, beatError: 0.3 },
        { position: '12上', rate: 4.1, amplitude: 276, beatError: 0.3 },
        { position: '6上', rate: 3.9, amplitude: 274, beatError: 0.3 },
      ],
      powerReserve: 48,
      conclusion: '合格（档案旧录）',
      standardId: '',
      bindSource: 'legacy',
      verdictSnapshot: '',
    },
    {
      id: newId('tst'),
      clockId: clockA,
      testedAt: now - 150 * day,
      amplitude: 255,
      beatError: 0.6,
      rate: 8,
      positions: [
        { position: '面上', rate: 7.2, amplitude: 258, beatError: 0.5 },
        { position: '面下', rate: 8.8, amplitude: 252, beatError: 0.7 },
        { position: '12上', rate: 7.9, amplitude: 256, beatError: 0.6 },
        { position: '6上', rate: 8.1, amplitude: 254, beatError: 0.6 },
      ],
      powerReserve: 45,
      conclusion: '合格',
      standardId: '',
      bindSource: 'legacy',
      verdictSnapshot: '',
    },
    {
      id: newId('tst'),
      clockId: clockA,
      testedAt: now - 2 * day,
      amplitude: 242,
      beatError: 0.9,
      rate: 22,
      positions: [
        { position: '面上', rate: 20.2, amplitude: 246, beatError: 0.8 },
        { position: '面下', rate: 23.8, amplitude: 238, beatError: 1.0 },
        { position: '12上', rate: 21.6, amplitude: 242, beatError: 0.9 },
        { position: '6上', rate: 22.4, amplitude: 242, beatError: 0.9 },
      ],
      powerReserve: 46,
      conclusion: '合格',
      standardId: '',
      bindSource: 'legacy',
      verdictSnapshot: '',
    },
  ];

  await db.transaction('rw', db.clocks, db.parts, db.steps, db.tests, async () => {
    await db.clocks.bulkPut(clocks);
    await db.parts.bulkPut(parts);
    await db.steps.bulkPut(steps);
    await db.tests.bulkPut(tests);
  });

  await backfillLegacyTests(standards);
}
