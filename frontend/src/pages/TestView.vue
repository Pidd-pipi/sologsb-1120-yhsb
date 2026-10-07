<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useClockStore } from '../stores/clockStore';
import { useStepStore } from '../stores/stepStore';
import RateChart from '../components/common/RateChart.vue';
import StateBadge from '../components/common/StateBadge.vue';
import { TEST_POSITIONS, type PositionReading } from '../types/test';
import { formatDate, thresholdText } from '../types/standard';
import { useStandardStore } from '../stores/standardStore';
import { judgeBy, judgeTestWith, verdictTagType } from '../utils/judgement';
import { amplitudeLevel, avgAmplitude, avgBeatError, avgRate, beatErrorLevel, rateLabel, ratePerDayToMonth } from '../utils/timeCalc';

const route = useRoute();
const router = useRouter();
const clockStore = useClockStore();
const stepStore = useStepStore();
const standardStore = useStandardStore();

const clockId = ref(String(route.params.clockId ?? ''));
const clock = computed(() => clockStore.byId(clockId.value));
const tests = computed(() => stepStore.testsByClock(clockId.value));
/** 保存时将绑定的现行标准版本 */
const activeStandard = computed(() => standardStore.current);

const readings = reactive<PositionReading[]>(
  TEST_POSITIONS.map((position) => ({ position, rate: 0, amplitude: 260, beatError: 0.4 })),
);
const powerReserve = ref(42);
const customConclusion = ref('');

const avg = computed(() => ({
  rate: avgRate(readings),
  amplitude: avgAmplitude(readings),
  beatError: avgBeatError(readings),
}));

/** 按现行标准版本判定（无版本时提示待复核） */
const autoConclusion = computed(() =>
  activeStandard.value
    ? judgeBy(avg.value.rate, avg.value.beatError, avg.value.amplitude, activeStandard.value)
    : '待复核',
);

const conclusion = computed(() =>
  customConclusion.value.trim() ? customConclusion.value.trim() : autoConclusion.value,
);

/** 判定依据全文（写入走时单） */
const judgeBasis = computed(() => {
  const s = activeStandard.value;
  if (!s) return '当前无生效标准版本，本次保存将标记为待复核';
  return (
    `依据现行标准「${s.name}」（${formatDate(s.effectiveAt)} 生效，${thresholdText(s)}）：` +
    `实测平均日差 ${avg.value.rate} s/d、摆幅 ${avg.value.amplitude}°、偏振 ${avg.value.beatError} ms，判「${autoConclusion.value}」`
  );
});

const workSheet = computed(() => {
  const lines: string[] = [];
  lines.push('走时测试单');
  lines.push(`藏品号：${clock.value?.clockNo ?? '未知'}（${clock.value?.kind ?? ''} / ${clock.value?.caliber ?? ''}）`);
  lines.push(`测试时间：${new Date().toLocaleString('zh-CN')}`);
  if (activeStandard.value) {
    lines.push(`判定标准：${activeStandard.value.name}（${formatDate(activeStandard.value.effectiveAt)} 生效）`);
  } else {
    lines.push('判定标准：无生效版本，本次记录将标记待复核');
  }
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
  lines.push(`合格判据：${activeStandard.value ? thresholdText(activeStandard.value) : '—'}`);
  lines.push(`结论：${conclusion.value}`);
  lines.push(`判定依据：${judgeBasis.value}`);
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
    conclusion: conclusion.value,
  });
  ElMessage.success(
    activeStandard.value
      ? `走时测试已记录并绑定「${activeStandard.value.name}」`
      : '走时测试已记录（无生效标准，已标记待复核）',
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
  customConclusion.value = '';
}

onMounted(async () => {
  await clockStore.load();
  await standardStore.load();
  await stepStore.load();
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
      <el-tag v-if="activeStandard" type="warning" effect="plain">
        现行标准：{{ activeStandard.name }}（{{ formatDate(activeStandard.effectiveAt) }} 生效）
      </el-tag>
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
          <el-form-item label="结论（可选）">
            <el-input v-model="customConclusion" placeholder="留空则按均值自动判定" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="save">保存测试记录</el-button>
            <el-button @click="reset">重置读数</el-button>
          </el-form-item>
        </el-form>
      </el-card>

      <div class="right">
        <el-card shadow="never">
          <template #header><strong>多方位均值</strong></template>
          <div class="stats">
            <div><span class="muted">平均日差</span><strong>{{ avg.rate }}</strong> s/d</div>
            <div><span class="muted">折算</span><strong>{{ ratePerDayToMonth(avg.rate) }}</strong> s/月</div>
            <div><span class="muted">平均摆幅</span><strong>{{ avg.amplitude }}</strong> °</div>
            <div><span class="muted">平均偏振</span><strong>{{ avg.beatError }}</strong> ms</div>
          </div>
          <el-alert
            v-if="activeStandard"
            :title="`判定结论：${autoConclusion}（${rateLabel(avg.rate)}）`"
            :type="autoConclusion === '合格' ? 'success' : autoConclusion === '不合格' ? 'error' : 'warning'"
            :closable="false"
            show-icon
            :description="judgeBasis"
          />
          <el-alert
            v-else
            title="当前无生效标准版本，保存后该记录将标记为待复核"
            type="warning"
            :closable="false"
            show-icon
          />
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
          <el-input v-model="workSheet" type="textarea" :rows="12" readonly />
        </el-card>

        <el-card shadow="never">
          <template #header><strong>历史测试记录</strong>（按各测试绑定的标准版本判定）</template>
          <el-table :data="tests" size="small" border>
            <el-table-column label="时间" width="170">
              <template #default="{ row }">{{ new Date(row.testedAt).toLocaleString('zh-CN') }}</template>
            </el-table-column>
            <el-table-column prop="rate" label="日差" width="80" />
            <el-table-column prop="amplitude" label="摆幅" width="80" />
            <el-table-column prop="beatError" label="偏振" width="80" />
            <el-table-column label="结论" min-width="100">
              <template #default="{ row }">
                <el-tag :type="verdictTagType(judgeTestWith(row, standardStore.items).verdict, judgeTestWith(row, standardStore.items).review)" size="small">
                  {{ judgeTestWith(row, standardStore.items).review ? '待复核' : judgeTestWith(row, standardStore.items).verdict }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="绑定版本 / 判定依据" min-width="260">
              <template #default="{ row }">
                <div v-if="judgeTestWith(row, standardStore.items).standard">
                  「{{ judgeTestWith(row, standardStore.items).standard!.name }}」
                  <span class="muted">
                    （{{ row.bindSource === 'current' ? '保存时绑定' : '老数据按日期回填' }}，{{ formatDate(judgeTestWith(row, standardStore.items).standard!.effectiveAt) }} 生效）
                  </span>
                </div>
                <div v-else class="muted">无版本记录，回填不到，待复核</div>
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
</style>
