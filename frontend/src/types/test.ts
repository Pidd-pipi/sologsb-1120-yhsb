/** 测试方位 */
export type TestPosition = '面上' | '面下' | '12上' | '6上';

export const TEST_POSITIONS: TestPosition[] = ['面上', '面下', '12上', '6上'];

/** 单方位读数 */
export interface PositionReading {
  position: TestPosition;
  /** 日差 s/d */
  rate: number;
  /** 摆幅 ° */
  amplitude: number;
  /** 偏振 ms */
  beatError: number;
}

/** 无版本记录且按日期回填不到的老测试：空 id + bindSource='legacy'，判为待复核 */
export type StandardBindSource = 'current' | 'backfill' | 'legacy';

/** 走时测试记录 */
export interface TimekeepingTest {
  id: string;
  clockId: string;
  testedAt: number;
  /** 摆幅 ° */
  amplitude: number;
  /** 偏振 ms */
  beatError: number;
  /** 日差 s/d */
  rate: number;
  positions: PositionReading[];
  /** 动力储备 h */
  powerReserve: number;
  /**
   * 保存时录入的结论/备注（可能是人工填写）。
   * 权威判定结论按 standardId 对应版本实时重算，此字段仅作历史备注展示。
   */
  conclusion: string;
  /** 绑定时生效的合格标准版本 id；回填不到的老数据为空串 */
  standardId: string;
  /** 绑定来源：保存时绑定 / 老数据按日期回填 / 无版本可回填（待复核） */
  bindSource: StandardBindSource;
  /** 绑定时按该版标准判出的结论快照（标准修改后不再重写，留作历史） */
  verdictSnapshot: string;
}

export type TimekeepingTestDraft = Omit<TimekeepingTest, 'id'>;
