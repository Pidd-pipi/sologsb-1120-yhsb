<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useClockStore } from '../stores/clockStore';
import { useStepStore } from '../stores/stepStore';
import { useStandardStore } from '../stores/standardStore';
import RateChart from '../components/common/RateChart.vue';
import StateBadge from '../components/common/StateBadge.vue';
import { TEST_POSITIONS, type PositionReading } from '../types/test';
import { amplitudeLevel, avgAmplitude, avgBeatError, avgRate, beatErrorLevel, rateLabel, ratePerDayToMonth } from '../utils/timeCalc';
import {
  evaluateTest,
  judgeByThresholds,
  standardAt,
  thresholdsBasis,
  verdictTagType,
  type TestVerdictView,
} from '../utils/judge';

const route = useRoute();
const router = useRouter();
const clockStore = useClockStore();
const stepStore = useStepStore();
const standardStore = useStandardStore();

const clockId = ref(String(route.params.clockId ?? ''));
const clock = computed(() => clockStore.byId(clockId.value));
const tests = computed(() => stepStore.testsByClock(clockId.value));

const readings = reactive<PositionReading[]>(
  TEST_POSITIONS.map((position) => ({ position, rate: 0, amplitude: 260, beatError: 0.4 })),
);
const powerReserve = ref(42);
/** 人工备注（可选）；系统判定结论不由该文本决定 */
const customNote = ref('');

const avg = computed(() => ({
  rate: avgRate(readings),
  amplitude: avgAmplitude(readings),
  beatError: avgBeatError(readings),
}));

/** 保存时将绑定的、当时生效的标准版本 */
const effectiveStandard = computed(() => standardAt(standardStore.items, Date.now()));

/** 录入中的实时判定（预演保存后结论，依据当前生效版本） */
const liveVerdict = computed<TestVerdictView | undefined>(() => {
  const std = effectiveStandard.value;
  if (!std) return undefined;
  const verdict = judgeByThresholds(avg.value.rate, avg.value.beatError, avg.value.amplitude, std.thresholds);
  const clause =
    verdict === '合格'
      ? '当前均值全部满足合格条款'
      : verdict === '不合格'
        ? '当前均值超出合格与可用条款'
        : '当前均值未达合格条款，但落入可用（需再调）条款';
  return {
    verdict,
    standard: std,
    pending: false,
    basis:
      `保存时将绑定《${std.name}》（${std.code}，${new Date(std.effectiveFrom).toLocaleDateString(
        'zh-CN',
      )} 起生效）；阈值：${thresholdsBasis(std.thresholds)}；${clause}。`,
  };
});

const workSheet = computed(() => {
  const lines: string[] = [];
  const std = effectiveStandard.value;
  const verdict = std
    ? judgeByThresholds(avg.value.rate, avg.value.beatError, avg.value.amplitude, std.thresholds)
    : '待复核';
  lines.push('走时测试单');
  lines.push(`藏品号：${clock.value?.clockNo ?? '未知'}（${clock.value?.kind ?? ''} / ${clock.value?.caliber ?? ''}）`);
  lines.push(`测试时间：${new Date().toLocaleString('zh-CN')}`);
  lines.push('');
  lines.push('方位\t日差(s/d)\t摆幅(°)\t偏振(ms)');
  readings.forEach((r) => {
    lines.push(`${r.position}\t${r.rate}\t${r.amplitude}\t${r.beatError}`);
  });
  lines.push('');
  lines.push(`平均日差：${avg.value.rate} s/d（约 ${ratePerDayToMonth(avg.value.rate)} s/月，${rateLabel(avg.value.rate)}）`);
  lines.push(`平均摆幅：${avg.value.amplitude} °（${amplitudeLevel(avg.value.amplitude).label}）`);
  lines.push(`平均偏振：${avg.value.beatError} ms（${beatErrorLevel(avg.value.beatError).label}）`);
  lines.push(`动力储备：${powerReserve.value} h`);
  lines.push('');
  lines.push(`系统判定：${verdict}`);
  if (std) {
    lines.push(`判定依据：《${std.name}》版本 ${std.code}，${new Date(std.effectiveFrom).toLocaleDateString('zh-CN')} 起生效（本单保存时绑定该版本）`);
    lines.push(`合格阈值：${thresholdsBasis(std.thresholds)}`);
  } else {
    lines.push('判定依据：当前没有生效的标准版本，保存后将标记为待复核');
  }
  if (customNote.value.trim()) lines.push(`人工备注：${customNote.value.trim()}`);
  return lines.join('\n');
});

async function save() {
  if (!clockId.value) {
    ElMessage.error('未指定钟表');
    return;
  }
  await stepStore.addTest({
    clockId: clockId.value,
    testedAt: Date.now(),
    amplitude: avg.value.amplitude,
    beatError: avg.value.beatError,
    rate: avg.value.rate,
    positions: readings.map((r) => ({ ...r })),
    powerReserve: powerReserve.value,
    conclusion: customNote.value.trim() || undefined,
  });
  ElMessage.success(
    effectiveStandard.value
      ? `走时测试已记录，已绑定版本 ${effectiveStandard.value.code}，放行状态按该版本重算`
      : '走时测试已记录；当前无生效标准，已标记待复核',
  );
  reset();
}

async function copySheet() {
  try {
    await navigator.clipboard.writeText(workSheet.value);
    ElMessage.success('走时单已复制');
  } catch {
    ElMessage.warning('浏览器未授权剪贴板，请手动复制');
  }
}

function downloadSheet() {
  const blob = new Blob([workSheet.value], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `走时单_${clock.value?.clockNo ?? 'clock'}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  ElMessage.success('走时单已导出');
}

function reset() {
  readings.forEach((r) => {
    r.rate = 0;
    r.amplitude = 260;
    r.beatError = 0.4;
  });
  powerReserve.value = 42;
  customNote.value = '';
}

onMounted(async () => {
  await clockStore.load();
  await stepStore.load();
  await standardStore.load();
  if (!clock.value && clockStore.items.length > 0) {
    clockId.value = clockStore.items[0].id;
    await router.replace(`/tests/${clockId.value}`);
  }
});
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>走时测试 · {{ clock?.clockNo ?? '未选择' }}</h2>
      <StateBadge :grade="clock?.conditionGrade" />
      <el-tag type="info" effect="plain">历史测试 {{ tests.length }} 次</el-tag>
      <el-tag v-if="effectiveStandard" type="success" effect="plain">
        本次保存绑定：{{ effectiveStandard.code }}（{{ new Date(effectiveStandard.effectiveFrom).toLocaleDateString('zh-CN') }} 起生效）
      </el-tag>
      <el-tag v-else type="warning">当前无生效标准，保存将标待复核</el-tag>
      <div class="spacer" />
      <el-button @click="router.push(`/clocks/${clockId}`)">返回钟表详情</el-button>
    </div>

    <div class="grid">
      <el-card shadow="never">
        <template #header><strong>多方位读数录入</strong></template>
        <el-table :data="readings" size="small" border>
          <el-table-column prop="position" label="方位" width="90" />
          <el-table-column label="日差 s/d" width="150">
            <template #default="{ row }">
              <el-input-number v-model="row.rate" :min="-99" :max="99" :step="0.1" :precision="1" size="small" />
            </template>
          </el-table-column>
          <el-table-column label="摆幅 °" width="160">
            <template #default="{ row }">
              <el-input-number v-model="row.amplitude" :min="0" :max="400" :step="1" size="small" />
            </template>
          </el-table-column>
          <el-table-column label="偏振 ms" width="160">
            <template #default="{ row }">
              <el-input-number v-model="row.beatError" :min="0" :max="9.9" :step="0.1" :precision="1" size="small" />
            </template>
          </el-table-column>
          <el-table-column label="分级" min-width="140">
            <template #default="{ row }">
              <StateBadge :label="amplitudeLevel(row.amplitude).label" :tone="amplitudeLevel(row.amplitude).type" />
              <StateBadge :label="beatErrorLevel(row.beatError).label" :tone="beatErrorLevel(row.beatError).type" />
            </template>
          </el-table-column>
        </el-table>

        <el-form label-width="110px" style="margin-top: 14px">
          <el-form-item label="动力储备 h">
            <el-input-number v-model="powerReserve" :min="0" :max="400" />
          </el-form-item>
          <el-form-item label="人工备注（可选）">
            <el-input v-model="customNote" placeholder="不影响系统判定，系统结论按绑定标准版本重算" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="save">保存测试记录</el-button>
            <el-button @click="reset">重置读数</el-button>
          </el-form-item>
        </el-form>
      </el-card>

      <div class="right">
        <el-card shadow="never">
          <template #header><strong>多方位均值与判定预演</strong></template>
          <div class="stats">
            <div><span class="muted">平均日差</span><strong>{{ avg.rate }}</strong> s/d</div>
            <div><span class="muted">折算</span><strong>{{ ratePerDayToMonth(avg.rate) }}</strong> s/月</div>
            <div><span class="muted">平均摆幅</span><strong>{{ avg.amplitude }}</strong> °</div>
            <div><span class="muted">平均偏振</span><strong>{{ avg.beatError }}</strong> ms</div>
          </div>
          <el-alert
            v-if="liveVerdict"
            :title="`判定结论：${liveVerdict.verdict}（${rateLabel(avg.rate)}）`"
            :type="verdictTagType(liveVerdict.verdict) === 'success' ? 'success' : verdictTagType(liveVerdict.verdict) === 'danger' ? 'error' : 'warning'"
            :closable="false"
            show-icon
          />
          <div v-if="liveVerdict" class="basis-box">{{ liveVerdict.basis }}</div>
          <RateChart :readings="readings" />
        </el-card>

        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <strong>走时单</strong>
              <div class="spacer" />
              <el-button size="small" @click="copySheet">复制</el-button>
              <el-button size="small" type="primary" @click="downloadSheet">导出</el-button>
            </div>
          </template>
          <el-input v-model="workSheet" type="textarea" :rows="14" readonly />
        </el-card>

        <el-card shadow="never">
          <template #header><strong>历史测试记录（按绑定版本重算）</strong></template>
          <el-table :data="tests" size="small" border>
            <el-table-column label="时间" width="170">
              <template #default="{ row }">{{ new Date(row.testedAt).toLocaleString('zh-CN') }}</template>
            </el-table-column>
            <el-table-column prop="rate" label="日差" width="80" />
            <el-table-column prop="amplitude" label="摆幅" width="80" />
            <el-table-column prop="beatError" label="偏振" width="80" />
            <el-table-column prop="powerReserve" label="动储 h" width="90" />
            <el-table-column label="绑定版本" width="130">
              <template #default="{ row }">{{ row.standardCode || '无（待复核）' }}</template>
            </el-table-column>
            <el-table-column label="重算结论" min-width="120">
              <template #default="{ row }">
                <el-tag size="small" :type="verdictTagType(evaluateTest(row, standardStore.items).verdict)" effect="dark">
                  {{ evaluateTest(row, standardStore.items).verdict }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="判定依据" min-width="260">
              <template #default="{ row }">
                <el-tooltip :content="evaluateTest(row, standardStore.items).basis" placement="top" :show-after="100">
                  <span class="basis-link">查看依据</span>
                </el-tooltip>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="tests.length === 0" description="暂无历史测试" :image-size="60" />
        </el-card>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.header h2 {
  margin: 0;
}
.spacer {
  flex: 1;
}
.grid {
  display: grid;
  grid-template-columns: minmax(0, 620px) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.right {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 14px;
}
.stats strong {
  font-size: 18px;
  margin: 0 4px;
}
.muted {
  color: #7b8592;
  font-size: 13px;
}
.card-head {
  display: flex;
  align-items: center;
}
.basis-box {
  margin-top: 10px;
  padding: 8px 10px;
  background: #f7f3e8;
  border-left: 3px solid #c9a94e;
  border-radius: 3px;
  font-size: 12.5px;
  color: #5b5238;
  line-height: 1.7;
}
.basis-link {
  font-size: 12px;
  color: #8a6d1d;
  border-bottom: 1px dashed #c9a94e;
  cursor: help;
}
</style>
