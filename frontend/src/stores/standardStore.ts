import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import { broadcastDataChange } from '../utils/crossTab';
import { standardAt } from '../utils/judge';
import type { TestStandard, TestStandardDraft } from '../types/standard';
import type { TimekeepingTest } from '../types/test';

/** 乐观锁冲突：标准已被另一页签（或另一提交）先行修改 */
export class RevisionConflictError extends Error {
  constructor(public latest: TestStandard) {
    super(`标准「${latest.code}」已被其他页签先行修改，本次提交未保留，请刷新后重试`);
    this.name = 'RevisionConflictError';
  }
}

interface StandardState {
  items: TestStandard[];
  loaded: boolean;
}

function sortByEffective(items: TestStandard[]): TestStandard[] {
  return [...items].sort((a, b) => a.effectiveFrom - b.effectiveFrom);
}

/**
 * 在一次标准写入事务内重算测试绑定：
 * - 待复核/未绑定测试：若测试时间落在某版本生效期内则回填该版本（新增历史版本时同样生效）；
 * - 已绑定测试的阈值快照刷新为版本最新阈值，结论一律实时重算（见 utils/judge.ts）。
 */
function rebindRow(row: TimekeepingTest, standards: TestStandard[]) {
  if (row.reviewPending || !row.standardId) {
    const std = standardAt(standards, row.testedAt);
    if (std) {
      row.standardId = std.id;
      row.standardCode = std.code;
      row.thresholds = { ...std.thresholds };
      row.reviewPending = false;
    }
    return;
  }
  const std = standards.find((s) => s.id === row.standardId);
  if (std) {
    row.thresholds = { ...std.thresholds };
    row.standardCode = std.code;
  }
}

export const useStandardStore = defineStore('standard', {
  state: (): StandardState => ({ items: [], loaded: false }),
  getters: {
    /** 按生效日期升序 */
    ordered: (state) => sortByEffective(state.items),
    byId: (state) => (id: string) => state.items.find((s) => s.id === id),
  },
  actions: {
    async load() {
      this.items = sortByEffective(await db.standards.toArray());
      this.loaded = true;
    },

    /**
     * 新建或修改标准版本。
     * 携带 baseRevision（编辑时打开表单那一刻的修订号）做 CAS：
     * 两个页签同时修改同一版本，只有先提交者成功，后提交者收到 RevisionConflictError。
     * 标准一经保存，全部相关测试在同一事务内按新版本重算绑定，放行状态随之变化。
     */
    async saveStandard(draft: TestStandardDraft, id: string | undefined, baseRevision: number | undefined): Promise<TestStandard> {
      const code = draft.code.trim();
      if (!code) throw new Error('版本编号必填');
      if (!draft.name.trim()) throw new Error('版本名称必填');
      const dup = this.items.find((s) => s.code === code && s.id !== id);
      if (dup) throw new Error(`版本编号「${code}」已存在，请更换`);
      const t = draft.thresholds;
      if (
        !(t.ratePass <= t.rateUsable) ||
        !(t.beatErrorMax <= t.beatErrorUsableMax) ||
        [t.ratePass, t.amplitudeMin, t.beatErrorMax, t.rateUsable, t.beatErrorUsableMax].some((v) => !Number.isFinite(v) || v < 0)
      ) {
        throw new Error('阈值不合法：合格阈值应不宽于可用阈值，且均需为非负数值');
      }

      let saved: TestStandard;
      await db.transaction('rw', db.standards, db.tests, async () => {
        const now = Date.now();
        if (id) {
          const existing = await db.standards.get(id);
          if (!existing) throw new Error('该标准版本不存在（可能已被删除）');
          if (baseRevision !== undefined && existing.revision !== baseRevision) {
            throw new RevisionConflictError(existing);
          }
          saved = {
            ...existing,
            ...toPlain(draft),
            code,
            name: draft.name.trim(),
            updatedAt: now,
            revision: existing.revision + 1,
          };
        } else {
          saved = {
            ...toPlain(draft),
            id: newId('std'),
            code,
            name: draft.name.trim(),
            createdAt: now,
            updatedAt: now,
            revision: 1,
          };
        }
        await db.standards.put(saved!);

        const standards = await db.standards.toArray();
        await db.tests.toCollection().modify((row) => rebindRow(row, standards));
      });

      // 提交后刷新本页签内存，并通知其他页签重拉
      this.items = sortByEffective(await db.standards.toArray());
      broadcastDataChange('standards');
      return saved!;
    },

    /** 仅当没有任何测试绑定该版本时允许删除（历史判定依据不可断链） */
    async removeStandard(id: string): Promise<number> {
      const bound = await db.tests.where('standardId').equals(id).count();
      if (bound > 0) {
        throw new Error(`仍有 ${bound} 条测试依据该版本判定，不能删除；可作废后新建收紧版本`);
      }
      await db.standards.delete(id);
      this.items = sortByEffective(this.items.filter((s) => s.id !== id));
      broadcastDataChange('standards');
      return bound;
    },

    /** 绑定到某版本的测试条数 */
    async boundCount(id: string): Promise<number> {
      return db.tests.where('standardId').equals(id).count();
    },

    /**
     * 待复核处理：为旧测试人工指定当时执行的标准版本。
     * 绑定后按该版本阈值实时重算；同样走事务与跨页签通知。
     */
    async resolveReview(testId: string, standardId: string): Promise<void> {
      await db.transaction('rw', db.tests, db.standards, async () => {
        const test = await db.tests.get(testId);
        if (!test) throw new Error('测试记录不存在');
        const std = await db.standards.get(standardId);
        if (!std) throw new Error('所选标准版本不存在');
        if (std.effectiveFrom > test.testedAt) {
          throw new Error(
            `该版本 ${new Date(std.effectiveFrom).toLocaleDateString('zh-CN')} 才生效，晚于测试日期 ${new Date(
              test.testedAt,
            ).toLocaleDateString('zh-CN')}，不能作为当时依据`,
          );
        }
        test.standardId = std.id;
        test.standardCode = std.code;
        test.thresholds = { ...std.thresholds };
        test.reviewPending = false;
        await db.tests.put(test);
      });
      broadcastDataChange('tests');
    },
  },
});
