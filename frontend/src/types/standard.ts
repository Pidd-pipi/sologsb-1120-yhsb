/** 判定结论 */
export type Verdict = '合格' | '可用（需再调）' | '不合格';

/** 测试与标准版本的绑定来源 */
export type StandardBindSource = 'current' | 'backfill';

/**
 * 走时合格标准版本。
 * 每次收紧/放宽都新增一个版本并指定生效日期，不就地覆盖老版本，
 * 这样历史测试可以永久保留「当时按哪版判定」的依据。
 */
export interface PassStandard {
  id: string;
  /** 版本名称，如「2026-10 收紧版」 */
  name: string;
  /** 生效日期（本地零点时间戳 ms），该日 00:00 起生效 */
  effectiveAt: number;
  /** 合格：|日差| 上限 s/d */
  maxAbsRate: number;
  /** 合格：偏振上限 ms */
  maxBeatError: number;
  /** 合格：摆幅下限 ° */
  minAmplitude: number;
  /** 可用（需再调）：|日差| 上限 s/d */
  usableMaxAbsRate: number;
  /** 可用（需再调）：偏振上限 ms */
  usableMaxBeatError: number;
  /** 版本说明 */
  note: string;
  createdAt: number;
  updatedAt: number;
}

export type PassStandardDraft = Omit<PassStandard, 'id' | 'createdAt' | 'updatedAt'>;

/** 时间戳 → YYYY-MM-DD（本地时区） */
export function formatDate(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** YYYY-MM-DD → 本地零点时间戳 */
export function parseDate(value: string): number {
  return new Date(`${value}T00:00:00`).getTime();
}

/** 阈值清单文案，用于走时单与判定依据 */
export function thresholdText(s: PassStandard): string {
  return `|日差|≤${s.maxAbsRate} s/d、偏振≤${s.maxBeatError} ms、摆幅≥${s.minAmplitude}°`;
}
