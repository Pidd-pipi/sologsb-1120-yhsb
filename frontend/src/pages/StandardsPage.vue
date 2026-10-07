<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import StateBadge from '../components/common/StateBadge.vue';
import { RevisionConflictError, useStandardStore } from '../stores/standardStore';
import { currentStandard, thresholdsBasis } from '../utils/judge';
import type { JudgeThresholds, TestStandard, TestStandardDraft } from '../types/standard';

const standardStore = useStandardStore();

const dialogVisible = ref(false);
const editingId = ref<string | undefined>(undefined);
/** 打开编辑表单时的修订号，保存时做 CAS 比对 */
const baseRevision = ref<number | undefined>(undefined);
const formError = ref('');
const saving = ref(false);

const boundCounts = ref<Record<string, number>>({});

/** 时间戳 → 当地 00:00（el-date-picker 取值） */
function tsToDate(ts: number): Date {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
/** 当地 00:00 → 时间戳 */
function dateToTs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const form = reactive<{
  code: string;
  name: string;
  note: string;
  effectiveFrom: Date;
  thresholds: JudgeThresholds;
}>({
  code: '',
  name: '',
  note: '',
  effectiveFrom: new Date(),
  thresholds: { ratePass: 10, amplitudeMin: 250, beatErrorMax: 0.8, rateUsable: 30, beatErrorUsableMax: 1.2 },
});

const current = computed(() => currentStandard(standardStore.items));
const ordered = computed(() => standardStore.ordered);

function isCurrent(s: TestStandard): boolean {
  return current.value?.id === s.id;
}

async function refreshCounts() {
  const entries = await Promise.all(
    standardStore.items.map(async (s) => [s.id, await standardStore.boundCount(s.id)] as const),
  );
  boundCounts.value = Object.fromEntries(entries);
}

function openCreate() {
  editingId.value = undefined;
  baseRevision.value = undefined;
  form.code = `STD-${new Date().getFullYear()}-`;
  form.name = '';
  form.note = '';
  form.effectiveFrom = new Date();
  form.thresholds = { ratePass: 10, amplitudeMin: 250, beatErrorMax: 0.8, rateUsable: 30, beatErrorUsableMax: 1.2 };
  formError.value = '';
  dialogVisible.value = true;
}

function openEdit(s: TestStandard) {
  editingId.value = s.id;
  baseRevision.value = s.revision;
  form.code = s.code;
  form.name = s.name;
  form.note = s.note;
  form.effectiveFrom = tsToDate(s.effectiveFrom);
  form.thresholds = { ...s.thresholds };
  formError.value = '';
  dialogVisible.value = true;
}

async function submit() {
  formError.value = '';
  if (!form.effectiveFrom || Number.isNaN(form.effectiveFrom.getTime())) {
    formError.value = '请选择生效日期';
    return;
  }
  const draft: TestStandardDraft = {
    code: form.code.trim(),
    name: form.name.trim(),
    note: form.note.trim(),
    effectiveFrom: dateToTs(form.effectiveFrom),
    thresholds: { ...form.thresholds },
  };
  saving.value = true;
  try {
    const saved = await standardStore.saveStandard(draft, editingId.value, baseRevision.value);
    dialogVisible.value = false;
    const affected = await standardStore.boundCount(saved.id);
    ElMessage.success(
      editingId.value
        ? `标准「${saved.code}」已更新，绑定该版本的 ${affected} 条测试及相关钟表放行状态已重算`
        : `标准版本「${saved.code}」已建立`,
    );
    await refreshCounts();
  } catch (err) {
    if (err instanceof RevisionConflictError) {
      formError.value = `${err.message}。请放弃本次修改后重新打开编辑。`;
      ElMessage.error('并发冲突：另一个页签已先提交该标准，本次修改未保留');
    } else {
      formError.value = (err as Error).message;
    }
  } finally {
    saving.value = false;
  }
}

async function remove(s: TestStandard) {
  try {
    await ElMessageBox.confirm(
      `确认删除标准版本「${s.code}」？仅当没有测试绑定时可删除。`,
      '删除标准版本',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    await standardStore.removeStandard(s.id);
    ElMessage.success('已删除');
    await refreshCounts();
  } catch (err) {
    ElMessage.error((err as Error).message);
  }
}

onMounted(async () => {
  await standardStore.load();
  await refreshCounts();
});
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>走时合格标准（版本管理）</h2>
      <el-tag type="info" effect="plain">共 {{ ordered.length }} 个版本</el-tag>
      <el-tag v-if="current" type="success">当前执行：{{ current.code }} · {{ current.name }}</el-tag>
      <div class="spacer" />
      <el-button type="primary" @click="openCreate">新建标准版本</el-button>
    </div>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="标准按生效日期版本化：每次走时测试保存时自动绑定当时生效的版本，之后标准再收紧也不会改写历史判定；修改任一版本阈值后，绑定该版本的测试结论与相关钟表放行状态立即重算。两个页签同时编辑同一版本时，只保留先提交的修改。"
      style="margin-bottom: 12px"
    />

    <el-card v-for="s in ordered" :key="s.id" shadow="never" class="std-card">
      <div class="std-head">
        <strong>{{ s.name }}</strong>
        <StateBadge :label="s.code" tone="primary" />
        <el-tag v-if="isCurrent(s)" type="success" size="small">当前生效</el-tag>
        <el-tag v-else type="info" size="small" effect="plain">历史版本</el-tag>
        <span class="muted">生效日期：{{ new Date(s.effectiveFrom).toLocaleDateString('zh-CN') }}</span>
        <span class="muted">修订号 r{{ s.revision }}</span>
        <div class="spacer" />
        <el-button size="small" @click="openEdit(s)">修改</el-button>
        <el-button size="small" type="danger" plain @click="remove(s)">删除</el-button>
      </div>
      <div class="thresholds">
        <el-tag>合格 |日差| ≤ {{ s.thresholds.ratePass }} s/d</el-tag>
        <el-tag>合格摆幅 ≥ {{ s.thresholds.amplitudeMin }}°</el-tag>
        <el-tag>合格偏振 ≤ {{ s.thresholds.beatErrorMax }} ms</el-tag>
        <el-tag type="warning" effect="plain">可用 |日差| ≤ {{ s.thresholds.rateUsable }} s/d</el-tag>
        <el-tag type="warning" effect="plain">可用偏振 ≤ {{ s.thresholds.beatErrorUsableMax }} ms</el-tag>
      </div>
      <div v-if="s.note" class="muted note">{{ s.note }}</div>
      <div class="muted bound">绑定测试 {{ boundCounts[s.id] ?? 0 }} 条 · {{ thresholdsBasis(s.thresholds) }}</div>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="editingId ? '修改标准版本' : '新建标准版本'" width="640px">
      <el-alert
        v-if="editingId"
        type="warning"
        :closable="false"
        show-icon
        title="修改保存后，绑定该版本的全部走时测试将按新阈值重算，相关钟表的放行状态同步更新；若另一页签已先修改同一版本，本次提交会被拒绝。"
        style="margin-bottom: 12px"
      />
      <el-alert v-if="formError" :title="formError" type="error" :closable="false" style="margin-bottom: 10px" />
      <el-form label-width="150px">
        <el-form-item label="版本编号" required>
          <el-input v-model="form.code" placeholder="如 STD-2026-10" />
        </el-form-item>
        <el-form-item label="版本名称" required>
          <el-input v-model="form.name" placeholder="如 机械钟表走时合格标准（收紧版）" />
        </el-form-item>
        <el-form-item label="生效日期" required>
          <el-date-picker v-model="form.effectiveFrom" type="date" format="YYYY-MM-DD" placeholder="选择生效日（含当日）" />
        </el-form-item>
        <el-form-item label="合格·日差上限">
          <el-input-number v-model="form.thresholds.ratePass" :min="0" :max="99" :step="0.5" :precision="1" />
          <span class="muted">s/d，|平均日差| ≤ 此值</span>
        </el-form-item>
        <el-form-item label="合格·摆幅下限">
          <el-input-number v-model="form.thresholds.amplitudeMin" :min="0" :max="400" :step="5" />
          <span class="muted">°</span>
        </el-form-item>
        <el-form-item label="合格·偏振上限">
          <el-input-number v-model="form.thresholds.beatErrorMax" :min="0" :max="9.9" :step="0.1" :precision="1" />
          <span class="muted">ms</span>
        </el-form-item>
        <el-form-item label="可用·日差上限">
          <el-input-number v-model="form.thresholds.rateUsable" :min="0" :max="99" :step="0.5" :precision="1" />
          <span class="muted">s/d，不达合格但在此限内判「可用（需再调）」</span>
        </el-form-item>
        <el-form-item label="可用·偏振上限">
          <el-input-number v-model="form.thresholds.beatErrorUsableMax" :min="0" :max="9.9" :step="0.1" :precision="1" />
          <span class="muted">ms</span>
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="form.note" type="textarea" :rows="2" placeholder="版本变更背景等" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">保存并触发重算</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 12px;
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
.std-card {
  margin-bottom: 0;
}
.std-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.thresholds {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.muted {
  color: #7b8592;
  font-size: 13px;
}
.note {
  margin-bottom: 6px;
}
.bound {
  margin-top: 4px;
}
</style>
