import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import { currentStandard, effectiveStandardAt } from '../utils/judgement';
import type { PassStandard, PassStandardDraft } from '../types/standard';

/** 跨页签通知键：某页签改了标准后广播，其他页签据此刷新 */
export const STANDARDS_BROADCAST_KEY = 'gbclockrepair:standards-changed';

/** 乐观锁冲突：当前记录的 updatedAt 与提交时依据的不一致（已被另一个页签抢先提交） */
export class StandardVersionConflict extends Error {
  constructor(public current: PassStandard | undefined, public missing: boolean) {
    super(missing ? '该标准版本已被另一个页签删除' : '标准已被另一个页签先行修改，本次提交未保留');
    this.name = 'StandardVersionConflict';
  }
}

interface StandardState {
  items: PassStandard[];
  loaded: boolean;
}

export const useStandardStore = defineStore('standard', {
  state: (): StandardState => ({ items: [], loaded: false }),
  getters: {
    /** 按生效日期从新到旧 */
    sorted: (state) => [...state.items].sort((a, b) => b.effectiveAt - a.effectiveAt),
    /** 现行生效版本 */
    current: (state) => currentStandard(state.items),
    effectiveAt: (state) => (at: number) => effectiveStandardAt(state.items, at),
  },
  actions: {
    async load() {
      this.items = await db.standards.orderBy('effectiveAt').toArray();
      this.loaded = true;
    },
    /** 通知同浏览器其他页签：标准已变更，放行状态需重算 */
    notifyChanged() {
      try {
        window.localStorage.setItem(STANDARDS_BROADCAST_KEY, String(Date.now()));
      } catch {
        /* localStorage 不可用时忽略 */
      }
    },
    async addVersion(draft: PassStandardDraft) {
      if (this.items.some((s) => s.effectiveAt === draft.effectiveAt)) {
        throw new Error('该生效日期已存在标准版本，请改用其他生效日期，或直接编辑已有版本');
      }
      const now = Date.now();
      const record: PassStandard = { ...toPlain(draft), id: newId('std'), createdAt: now, updatedAt: now };
      await db.standards.put(toPlain(record));
      this.items = [...this.items, record];
      this.notifyChanged();
      return record;
    },
    /**
     * 修改版本（乐观锁）：
     * expectedUpdatedAt 为编辑表单打开时依据的 updatedAt；
     * 若库中记录已被其他页签先提交（updatedAt 不一致），本次提交直接拒绝，
     * 即「两个页签同时修改只保留先提交的」。
     */
    async updateVersion(id: string, patch: Partial<PassStandardDraft>, expectedUpdatedAt: number) {
      const existing = await db.standards.get(id);
      if (!existing) throw new StandardVersionConflict(undefined, true);
      if (existing.updatedAt !== expectedUpdatedAt) {
        throw new StandardVersionConflict(existing, false);
      }
      if (
        patch.effectiveAt !== undefined &&
        patch.effectiveAt !== existing.effectiveAt &&
        this.items.some((s) => s.id !== id && s.effectiveAt === patch.effectiveAt)
      ) {
        throw new Error('该生效日期已存在其他标准版本');
      }
      const updated: PassStandard = {
        ...existing,
        ...toPlain(patch),
        id,
        createdAt: existing.createdAt,
        updatedAt: Date.now(),
      };
      await db.standards.put(toPlain(updated));
      this.items = this.items.map((s) => (s.id === id ? updated : s));
      this.notifyChanged();
      return updated;
    },
  },
});
