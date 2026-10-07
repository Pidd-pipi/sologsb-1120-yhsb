/** 走时测试系统判定结论 */
export type Verdict = '合格' | '可用（需再调）' | '不合格';

/** 待复核标记（旧数据回填不到当时版本时使用，不是正式判定结论） */
export const REVIEW_PENDING = '待复核';

export type ReviewVerdict = Verdict | typeof REVIEW_PENDING;

/** 合格判定阈值（随标准版本快照保存到测试记录上） */
export interface JudgeThresholds {
  /** 合格：|日差| 上限 s/d */
  ratePass: number;
  /** 合格：摆幅下限 ° */
  amplitudeMin: number;
  /** 合格：偏振上限 ms */
  beatErrorMax: number;
  /** 可用（需再调）：|日差| 上限 s/d */
  rateUsable: number;
  /** 可用（需再调）：偏振上限 ms */
  beatErrorUsableMax: number;
}

/** 走时合格标准版本（按生效日期管理） */
export interface TestStandard {
  id: string;
  /** 版本编号，唯一，如 STD-2026-10 */
  code: string;
  /** 版本名称 */
  name: string;
  /** 标准说明 */
  note: string;
  thresholds: JudgeThresholds;
  /** 生效起始时刻（含当日 00:00），ms */
  effectiveFrom: number;
  createdAt: number;
  updatedAt: number;
  /** 乐观锁修订号：两个页签同时修改同一版本时，只保留先提交（revision 未变）的一次 */
  revision: number;
}

/** 新建/编辑标准版本表单 */
export type TestStandardDraft = Pick<
  TestStandard,
  'code' | 'name' | 'note' | 'thresholds' | 'effectiveFrom'
>;

/** Element Plus 标签语义色 */
export type TagType = 'success' | 'warning' | 'danger' | 'info' | 'primary';
