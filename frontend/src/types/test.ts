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

/** 走时测试记录（判定结论全部来自所绑定的标准版本，见 utils/judge.ts） */
export interface TimekeepingTest {
  id: string;
  clockId: string;
  /** 测试时刻：保存时据此找到当时生效的标准版本 */
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
  /** 保存时绑定的标准版本 id；早期无版本记录的数据回填不到时为空，reviewPending=true */
  standardId?: string;
  /** 绑定版本的编号快照（如标准版本事后删除编号仍可追溯） */
  standardCode?: string;
  /** 绑定时生效的阈值快照，作为判定依据留存 */
  thresholds?: import('./standard').JudgeThresholds;
  /** 旧数据回填不到当时版本：true 表示结论待人工复核，不参与放行 */
  reviewPending?: boolean;
  /** 人工备注（原 conclusion 字段保留，不再作为系统判定结论） */
  conclusion?: string;
}

export type TimekeepingTestDraft = Omit<TimekeepingTest, 'id'>;
