<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useClockStore } from '../stores/clockStore';
import { usePartStore } from '../stores/partStore';
import { useStepStore } from '../stores/stepStore';
import { useStandardStore } from '../stores/standardStore';
import { useRepairProgress } from '../hooks/useRepairProgress';
import { useClockRelease } from '../hooks/useClockRelease';
import StepSequence from '../components/common/StepSequence.vue';
import RateChart from '../components/common/RateChart.vue';
import StateBadge from '../components/common/StateBadge.vue';
import { CONDITION_GRADES, type ConditionGrade } from '../types/clock';
import { evaluateTest, releaseTagType, verdictTagType } from '../utils/judge';

const route = useRoute();
const router = useRouter();
const clockStore = useClockStore();
const partStore = usePartStore();
const stepStore = useStepStore();
const standardStore = useStandardStore();

const clockId = computed(() => String(route.params.id ?? ''));
const clock = computed(() => clockStore.byId(clockId.value));
const { progress, steps, done, total, percent, current, gaps } = useRepairProgress(clockId);
const parts = computed(() => partStore.byClock(clockId.value));
const { tests, release } = useClockRelease(clockId);
const activeTab = ref('steps');

/** 待复核处理弹窗 */
const reviewVisible = ref(false);
const reviewTestId = ref('');
const reviewStandardId = ref('');
const reviewCandidates = computed(() =>
  standardStore.ordered.filter((s) => {
    const t = stepStore.tests.find((it) => it.id === reviewTestId.value);
    return t ? s.effectiveFrom <= t.testedAt : false;
  }),
);

function openReview(testId: string) {
  reviewTestId.value = testId;
  reviewStandardId.value = reviewCandidates.value[reviewCandidates.value.length - 1]?.id ?? '';
  reviewVisible.value = true;
}

async function submitReview() {
  if (!reviewStandardId.value) {
    ElMessage.warning('请选择当时执行的标准版本');
    return;
  }
  try {
    await standardStore.resolveReview(reviewTestId.value, reviewStandardId.value);
    await stepStore.load();
    reviewVisible.value = false;
    ElMessage.success('已绑定版本并重算结论，放行状态已更新');
  } catch (err) {
    ElMessage.error((err as Error).message);
  }
}

function viewOf(testId: string) {
  const t = tests.value.find((it) => it.id === testId);
  return t ? evaluateTest(t, standardStore.items) : undefined;
}

async function finish(id: string) {
  await stepStore.finish(id);
  ElMessage.success('步骤已完成');
}
async function rollback(id: string) {
  await stepStore.rollback(id);
  ElMessage.warning('步骤已回退');
}
async function move(payload: { id: string; direction: 'up' | 'down' }) {
  const list = steps.value;
  const index = list.findIndex((it) => it.id === payload.id);
  const target = payload.direction === 'up' ? list[index - 1] : list[index + 1];
  if (!target) return;
  await stepStore.swapSeq(payload.id, target.id);
  ElMessage.success('顺序已调整');
}
async function reorder(payload: { fromId: string; toId: string }) {
  await stepStore.swapSeq(payload.fromId, payload.toId);
  ElMessage.success('已按拖拽交换顺序');
}
async function changeGrade(value: unknown) {
  const grade = String(value) as ConditionGrade;
  await clockStore.setGrade(clockId.value, grade);
  ElMessage.success(`品相等级已更新为「${grade}」`);
}

onMounted(async () => {
  await clockStore.load();
  await partStore.load();
  await stepStore.load();
  await standardStore.load();
});
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>钟表详情 · {{ clock?.clockNo ?? '未找到' }}</h2>
      <StateBadge v-if="clock" :grade="clock.conditionGrade" />
      <el-tag :type="releaseTagType(release.release)" effect="dark">放行状态：{{ release.release }}</el-tag>
      <el-tag v-if="gaps.length" type="danger">顺序号缺口：{{ gaps.join('、') }}</el-tag>
      <el-tag v-else type="success" effect="plain">顺序号连续</el-tag>
      <div class="spacer" />
      <el-button type="primary" @click="router.push(`/steps/new?clockId=${clockId}`)">追加维修工序</el-button>
      <el-button @click="router.push(`/tests/${clockId}`)">走时测试录入</el-button>
      <el-button @click="router.push('/clocks')">返回台账</el-button>
    </div>

    <el-alert v-if="clock && release.latest" :type="releaseTagType(release.release)" :closable="false" show-icon>
      <template #title>
        <strong>放行判定（重算结果）：{{ release.release }}</strong>
        <span class="basis">依据 {{ release.standard?.code ?? '—' }} · {{ release.basis }}</span>
      </template>
    </el-alert>

    <el-alert v-if="!clock" type="warning" :closable="false" title="未找到该钟表（可能已被删除）" show-icon />

    <div v-if="clock" class="grid">
      <el-card shadow="never">
        <template #header><strong>机芯信息</strong></template>
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="藏品号">{{ clock.clockNo }}</el-descriptions-item>
          <el-descriptions-item label="种类">{{ clock.kind }}</el-descriptions-item>
          <el-descriptions-item label="机芯型号">{{ clock.caliber }}</el-descriptions-item>
          <el-descriptions-item label="国别 / 制作者">{{ clock.origin }} / {{ clock.maker }}</el-descriptions-item>
          <el-descriptions-item label="年代">{{ clock.yearMade }}</el-descriptions-item>
          <el-descriptions-item label="钟壳材质">{{ clock.caseMaterial }}</el-descriptions-item>
          <el-descriptions-item label="尺寸 mm">{{ clock.size }}</el-descriptions-item>
          <el-descriptions-item label="盘面标识">{{ clock.dialMark }}</el-descriptions-item>
          <el-descriptions-item label="来源">{{ clock.acquireFrom }}</el-descriptions-item>
          <el-descriptions-item label="存放位置">{{ clock.storagePos }}</el-descriptions-item>
          <el-descriptions-item label="零件条目">{{ parts.length }} 项</el-descriptions-item>
        </el-descriptions>
        <div class="grade-row">
          <span>品相等级：</span>
          <el-radio-group :model-value="clock.conditionGrade" size="small" @change="changeGrade">
            <el-radio-button v-for="g in CONDITION_GRADES" :key="g" :value="g">{{ g }}</el-radio-button>
          </el-radio-group>
        </div>
      </el-card>

      <div class="right">
        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <strong>修复进度</strong>
              <el-tag size="small">{{ done }}/{{ total }} · {{ percent }}%</el-tag>
              <span v-if="current" class="muted">
                当前卡点：#{{ current.seq }} {{ current.stepType }}（{{ current.operator }}）
              </span>
              <span v-else class="muted">全部步骤已完成（修复完成不等于自动放行，放行以走时测试重算结论为准）</span>
            </div>
          </template>
          <el-progress :percentage="percent" :stroke-width="12" />
          <el-tabs v-model="activeTab" style="margin-top: 12px">
            <el-tab-pane label="工序顺序" name="steps">
              <StepSequence
                :items="steps"
                sortable
                @finish="finish"
                @rollback="rollback"
                @move="move"
                @reorder="reorder"
              />
            </el-tab-pane>
            <el-tab-pane :label="`零件清单（${parts.length}）`" name="parts">
              <el-table :data="parts" size="small" border>
                <el-table-column prop="name" label="零件" width="110" />
                <el-table-column prop="position" label="装配位置" min-width="150" />
                <el-table-column prop="wearState" label="磨损" width="90" />
                <el-table-column prop="decision" label="处理" width="90" />
                <el-table-column prop="sourceLot" label="来源批号" width="120" />
                <el-table-column prop="dimension" label="尺寸 mm" width="100" />
              </el-table>
              <el-empty v-if="parts.length === 0" description="暂无零件登记" :image-size="60" />
            </el-tab-pane>
            <el-tab-pane :label="`走时测试（${tests.length}）`" name="tests">
              <div v-for="t in tests" :key="t.id" class="test-block">
                <div class="card-head">
                  <strong>{{ new Date(t.testedAt).toLocaleString('zh-CN') }}</strong>
                  <el-tag size="small" :type="verdictTagType(viewOf(t.id)?.verdict ?? '待复核')" effect="dark">
                    {{ viewOf(t.id)?.verdict ?? '待复核' }}
                  </el-tag>
                  <el-tag size="small" effect="plain">{{ t.standardCode || '无版本' }}<template v-if="t.reviewPending"> · 待复核</template></el-tag>
                  <span class="muted">日差 {{ t.rate }} s/d · 摆幅 {{ t.amplitude }}° · 偏振 {{ t.beatError }} ms</span>
                  <el-button v-if="t.reviewPending" size="small" type="warning" plain @click="openReview(t.id)">
                    指定版本复核
                  </el-button>
                </div>
                <div v-if="viewOf(t.id)?.basis" class="basis-box">
                  <span class="basis-label">判定依据：</span>{{ viewOf(t.id)?.basis }}
                </div>
                <div v-if="t.conclusion" class="muted note">人工备注：{{ t.conclusion }}</div>
                <RateChart :readings="t.positions" />
              </div>
              <el-empty v-if="tests.length === 0" description="暂无走时测试记录" :image-size="60" />
            </el-tab-pane>
          </el-tabs>
        </el-card>
      </div>
    </div>

    <el-dialog v-model="reviewVisible" title="待复核测试 · 指定当时执行的标准版本" width="560px">
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        title="该旧测试没有版本记录且回填不到当时版本。请按测试实际执行日期选择当时生效的标准，保存后按该版本阈值重算并更新放行状态。"
        style="margin-bottom: 12px"
      />
      <el-form label-width="110px">
        <el-form-item label="执行标准">
          <el-select v-model="reviewStandardId" placeholder="选择标准版本" style="width: 100%">
            <el-option
              v-for="s in reviewCandidates"
              :key="s.id"
              :label="`${s.code} · ${s.name}（${new Date(s.effectiveFrom).toLocaleDateString('zh-CN')} 起生效）`"
              :value="s.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reviewVisible = false">取消</el-button>
        <el-button type="primary" @click="submitReview">确认绑定并重算</el-button>
      </template>
    </el-dialog>
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
  grid-template-columns: 380px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.right {
  min-width: 0;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.muted {
  color: #7b8592;
  font-size: 13px;
}
.basis {
  margin-left: 10px;
  font-size: 12.5px;
  font-weight: 400;
}
.basis-box {
  margin: 6px 0;
  padding: 8px 10px;
  background: #f7f3e8;
  border-left: 3px solid #c9a94e;
  border-radius: 3px;
  font-size: 12.5px;
  color: #5b5238;
  line-height: 1.7;
}
.basis-label {
  font-weight: 700;
}
.note {
  margin-bottom: 6px;
}
.grade-row {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.test-block {
  margin-bottom: 16px;
}
</style>
