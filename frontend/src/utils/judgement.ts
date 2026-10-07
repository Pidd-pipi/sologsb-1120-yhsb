import type { TimekeepingTest } from '../types/test';
import { formatDate, thresholdText, type PassStandard, type Verdict } from '../types/standard';

/** 单条测试的判定结果（含判定依据） */
export interface TestJudgement {
  verdict: Verdict;
  /** 判定所用标准版本（可能为 undefined：无版本可依，待复核） */
  standard: PassStandard | undefined;
  /** 是否处于待复核状态（无版本记录且按日期回填不到） */
  review: boolean;
  /** 判定依据文案 */
  reason: string;
}

/** 钟表放行状态 */
export type ReleaseState = 'releasable' | 'blocked' | 'review' | 'untested';

export interface ReleaseJudgement {
  state: ReleaseState;
  label: string;
  /** 放行判定依据文案 */
  reason: string;
}

/** 按某一版标准阈值判定 */
export function judgeBy(
  rate: number,
  beatError: number,
  amplitude: number,
  s: PassStandard,
): Verdict {
  if (
    Math.abs(rate) <= s.maxAbsRate &&
    beatError <= s.maxBeatError &&
    amplitude >= s.minAmplitude
  ) {
    return '合格';
  }
  if (Math.abs(rate) <= s.usableMaxAbsRate && beatError <= s.usableMaxBeatError) {
    return '可用（需再调）';
  }
  return '不合格';
}

/** 取某时刻生效的标准版本：effectiveAt <= at 中最晚生效的一版 */
export function effectiveStandardAt(standards: PassStandard[], at: number): PassStandard | undefined {
  return standards
    .filter((s) => s.effectiveAt <= at)
    .sort((a, b) => b.effectiveAt - a.effectiveAt)[0];
}

/** 现行版本（当前时间生效） */
export function currentStandard(standards: PassStandard[]): PassStandard | undefined {
  return effectiveStandardAt(standards, Date.now());
}

/**
 * 单条测试的历史判定：按测试绑定的版本（保存时生效 / 后来回填）判定。
 * 无绑定版本或绑定版本已不存在 → 待复核。
 */
export function judgeTestWith(
  test: TimekeepingTest,
  standards: PassStandard[],
): TestJudgement {
  const standard = standards.find((s) => s.id === test.standardId);
  if (!standard) {
    return {
      verdict: '不合格',
      standard: undefined,
      review: true,
      reason: '该测试无标准版本记录，按测试日期回填不到生效版本，结论待复核',
    };
  }
  const verdict = judgeBy(test.rate, test.beatError, test.amplitude, standard);
  return {
    verdict,
    standard,
    review: false,
    reason: `依据「${standard.name}」（${formatDate(standard.effectiveAt)} 生效）：${thresholdText(
      standard,
    )}；实测日差 ${test.rate} s/d、摆幅 ${test.amplitude}°、偏振 ${test.beatError} ms`,
  };
}

/**
 * 钟表放行判定（标准修改后重算）：以最近一次走时测试对照现行生效标准。
 * 只有现行标准下仍判「合格」才可交付，老测试当年合格但现已不达标的，
 * 不再计入放行——这正是本月标准收紧后台账要重算的部分。
 */
export function judgeRelease(
  tests: TimekeepingTest[],
  standards: PassStandard[],
  now: number = Date.now(),
): ReleaseJudgement {
  if (tests.length === 0) {
    return { state: 'untested', label: '未测试', reason: '尚无走时测试记录，不能放行' };
  }
  const latest = [...tests].sort((a, b) => b.testedAt - a.testedAt)[0];
  const judged = judgeTestWith(latest, standards);
  if (judged.review) {
    return {
      state: 'review',
      label: '待复核',
      reason: `最近测试（${formatDate(latest.testedAt)}）${judged.reason}，放行状态待复核`,
    };
  }
  const current = currentStandard(standards);
  if (!current) {
    return {
      state: 'review',
      label: '待复核',
      reason: `最近测试（${formatDate(latest.testedAt)}）无现行生效标准可依，放行状态待复核`,
    };
  }
  const presentVerdict = judgeBy(latest.rate, latest.beatError, latest.amplitude, current);
  const base = `最近测试 ${formatDate(latest.testedAt)}，对照现行「${current.name}」（${formatDate(
    current.effectiveAt,
  )} 生效，${thresholdText(current)}）`;
  if (presentVerdict === '合格') {
    return {
      state: 'releasable',
      label: '可交付',
      reason: `${base}：实测日差 ${latest.rate} s/d、摆幅 ${latest.amplitude}°、偏振 ${latest.beatError} ms，判合格，准予放行`,
    };
  }
  if (presentVerdict === '可用（需再调）') {
    return {
      state: 'blocked',
      label: '不予放行',
      reason: `${base}：实测日差 ${latest.rate} s/d、摆幅 ${latest.amplitude}°、偏振 ${latest.beatError} ms，仅判「可用（需再调）」，暂不予放行`,
    };
  }
  return {
    state: 'blocked',
    label: '不予放行',
    reason: `${base}：实测日差 ${latest.rate} s/d、摆幅 ${latest.amplitude}°、偏振 ${latest.beatError} ms，判不合格，不予放行`,
  };
}

/** el-tag 配色 */
export function releaseTagType(state: ReleaseState): 'success' | 'danger' | 'warning' | 'info' {
  switch (state) {
    case 'releasable':
      return 'success';
    case 'blocked':
      return 'danger';
    case 'review':
      return 'warning';
    default:
      return 'info';
  }
}

export function verdictTagType(verdict: Verdict, review: boolean): 'success' | 'danger' | 'warning' {
  if (review) return 'warning';
  if (verdict === '合格') return 'success';
  if (verdict === '可用（需再调）') return 'warning';
  return 'danger';
}
