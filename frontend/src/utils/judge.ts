import { REVIEW_PENDING, type JudgeThresholds, type ReviewVerdict, type TestStandard, type TagType } from '../types/standard';
import type { TimekeepingTest } from '../types/test';

/** 钟表放行状态：以最近一次走时测试的系统判定为准 */
export type ReleaseState = '未测试' | '待复核' | '可放行' | '不予放行';

/** 按阈值判定单次测试的系统结论 */
export function judgeByThresholds(
  rate: number,
  beatError: number,
  amplitude: number,
  t: JudgeThresholds,
): Exclude<ReviewVerdict, typeof REVIEW_PENDING> {
  if (Math.abs(rate) <= t.ratePass && beatError <= t.beatErrorMax && amplitude >= t.amplitudeMin) {
    return '合格';
  }
  if (Math.abs(rate) <= t.rateUsable && beatError <= t.beatErrorUsableMax) {
    return '可用（需再调）';
  }
  return '不合格';
}

/**
 * 找到某时刻生效的标准版本：effectiveFrom <= when 中生效日期最晚的一条。
 * 生效日期相同（或边界时刻）时取更新的版本。
 */
export function standardAt(standards: TestStandard[], when: number): TestStandard | undefined {
  return standards
    .filter((s) => s.effectiveFrom <= when)
    .sort((a, b) => b.effectiveFrom - a.effectiveFrom || b.updatedAt - a.updatedAt)[0];
}

/** 当前生效的标准版本 */
export function currentStandard(standards: TestStandard[], now = Date.now()): TestStandard | undefined {
  return standardAt(standards, now);
}

/** 阈值的可读判定依据 */
export function thresholdsBasis(t: JudgeThresholds): string {
  return (
    `|日差|≤${t.ratePass} s/d、摆幅≥${t.amplitudeMin}°、偏振≤${t.beatErrorMax} ms 判合格；` +
    `不满足但 |日差|≤${t.rateUsable} s/d 且偏振≤${t.beatErrorUsableMax} ms 判可用（需再调）；其余判不合格`
  );
}

/** 单次测试实际命中的判定条款 */
export function hitClause(test: Pick<TimekeepingTest, 'rate' | 'beatError' | 'amplitude'>, t: JudgeThresholds): string {
  const { rate, beatError, amplitude } = test;
  if (Math.abs(rate) <= t.ratePass && beatError <= t.beatErrorMax && amplitude >= t.amplitudeMin) {
    return `日差 ${rate}（|${rate}|≤${t.ratePass}）、摆幅 ${amplitude}（≥${t.amplitudeMin}）、偏振 ${beatError}（≤${t.beatErrorMax}），全部满足合格条款`;
  }
  if (Math.abs(rate) <= t.rateUsable && beatError <= t.beatErrorUsableMax) {
    return `未达合格条款，但 |日差| ${Math.abs(rate)}≤${t.rateUsable}、偏振 ${beatError}≤${t.beatErrorUsableMax}，命中可用条款`;
  }
  return `日差 ${rate}、摆幅 ${amplitude}°、偏振 ${beatError} ms 超出全部合格阈值`;
}

export interface TestVerdictView {
  /** 系统判定结论（重算结果），待复核时为「待复核」 */
  verdict: ReviewVerdict;
  /** 判定所依据的标准版本 */
  standard: TestStandard | undefined;
  /** 判定依据完整说明（标准编号/生效日期/阈值/命中条款） */
  basis: string;
  pending: boolean;
}

function basisOf(test: TimekeepingTest, standard: TestStandard | undefined): string {
  if (!standard || !test.thresholds) return '';
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const eff = new Date(standard.effectiveFrom);
  const tested = new Date(test.testedAt);
  return [
    `依据标准《${standard.name}》（${standard.code}，${fmt(eff)} 起生效）`,
    `测试时间 ${fmt(tested)} 处于该版本有效期内`,
    `阈值：${thresholdsBasis(test.thresholds)}`,
    hitClause(test, test.thresholds),
  ].join('；');
}

/**
 * 按当前标准版本表实时重算单次测试的结论与判定依据。
 * 标准一经修改，所有页面通过本函数得到新结论，而非读取历史 conclusion 文本。
 */
export function evaluateTest(test: TimekeepingTest, standards: TestStandard[]): TestVerdictView {
  if (test.reviewPending || !test.standardId) {
    const earliest = standards.length
      ? standards.reduce((a, b) => (a.effectiveFrom <= b.effectiveFrom ? a : b))
      : undefined;
    const reason = earliest
      ? `测试日期 ${new Date(test.testedAt).toLocaleDateString('zh-CN')} 早于最早标准版本（${earliest.code}，${new Date(
          earliest.effectiveFrom,
        ).toLocaleDateString('zh-CN')} 生效），无法回填当时版本`
      : '档案中尚无标准版本，无法回填当时版本';
    return {
      verdict: REVIEW_PENDING,
      standard: undefined,
      basis: `旧数据无版本记录且${reason}，已标记待复核，请人工指定当时执行的标准版本`,
      pending: true,
    };
  }
  const standard = standards.find((s) => s.id === test.standardId);
  if (!standard || !test.thresholds) {
    return {
      verdict: REVIEW_PENDING,
      standard: undefined,
      basis: `绑定的标准版本（${test.standardCode ?? test.standardId}）在标准表中缺失，需重新复核`,
      pending: true,
    };
  }
  const verdict = judgeByThresholds(test.rate, test.beatError, test.amplitude, standard.thresholds);
  return { verdict, standard, basis: basisOf(test, standard), pending: false };
}

/** 结论 → 标签色 */
export function verdictTagType(verdict: ReviewVerdict): TagType {
  if (verdict === '合格') return 'success';
  if (verdict === '不合格') return 'danger';
  if (verdict === '可用（需再调）') return 'warning';
  return 'info';
}

/** 放行状态 → 标签色 */
export function releaseTagType(state: ReleaseState): TagType {
  switch (state) {
    case '可放行':
      return 'success';
    case '不予放行':
      return 'danger';
    case '待复核':
      return 'warning';
    default:
      return 'info';
  }
}

export interface ClockReleaseView extends TestVerdictView {
  release: ReleaseState;
  /** 作为放行依据的最近一次测试（测试时间相同时取保存顺序靠后） */
  latest: TimekeepingTest | undefined;
  /** 该钟表下待复核测试条数 */
  pendingCount: number;
}

/**
 * 重算钟表放行状态：
 * - 无测试 → 未测试；
 * - 最近一次测试待复核，或存在任何待复核测试 → 待复核（不进可交付台账）；
 * - 最近一次重算结论「合格」→ 可放行；
 * - 「可用（需再调）/不合格」→ 不予放行（须再调后重测）。
 */
export function evaluateClockRelease(tests: TimekeepingTest[], standards: TestStandard[]): ClockReleaseView {
  if (tests.length === 0) {
    return {
      release: '未测试',
      latest: undefined,
      pendingCount: 0,
      verdict: REVIEW_PENDING,
      standard: undefined,
      basis: '尚无走时测试记录，不计算放行状态',
      pending: false,
    };
  }
  const sorted = [...tests].sort((a, b) => b.testedAt - a.testedAt);
  const latest = sorted[0];
  const latestView = evaluateTest(latest, standards);
  const pendingCount = tests.filter((t) => t.reviewPending || !t.standardId).length;

  if (latestView.pending) {
    return { ...latestView, release: '待复核', latest, pendingCount };
  }
  const release = latestView.verdict === '合格' ? '可放行' : '不予放行';
  const extra =
    pendingCount > 0
      ? `；另有 ${pendingCount} 条历史测试待复核（不影响本次放行依据，但需尽快补录版本）`
      : '';
  return { ...latestView, release, latest, pendingCount, basis: latestView.basis + extra };
}
