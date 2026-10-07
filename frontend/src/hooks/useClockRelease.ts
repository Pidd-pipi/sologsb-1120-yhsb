import { computed, unref, type Ref } from 'vue';
import { useStepStore } from '../stores/stepStore';
import { useStandardStore } from '../stores/standardStore';
import { evaluateClockRelease, type ClockReleaseView } from '../utils/judge';

/**
 * 重算某台钟表的放行状态与判定依据。
 * 标准版本或测试一变（含其他页签改后重拉），结论自动更新。
 */
export function useClockRelease(clockId: string | Ref<string>) {
  const stepStore = useStepStore();
  const standardStore = useStandardStore();
  const id = computed(() => unref(clockId));

  const tests = computed(() => stepStore.testsByClock(id.value));
  const release = computed<ClockReleaseView>(() => evaluateClockRelease(tests.value, standardStore.items));

  return { tests, release };
}
