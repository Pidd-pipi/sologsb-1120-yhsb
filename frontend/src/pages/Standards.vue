<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useStandardStore, StandardVersionConflict } from '../stores/standardStore';
import { formatDate, thresholdText } from '../types/standard';

const standardStore = useStandardStore();

const versions = computed(() => standardStore.sorted);
const now = Date.now();

/** 新增版本弹窗 */
const dialogVisible = ref(false);
const editingId = ref<string>('');
const form = reactive({
  name: '',
  effectiveDate: formatDate(Date.now()),
  maxAbsRate: 5,
  maxBeatError: 0.5,
  minAmplitude: 270,
  usableMaxAbsRate: 20,
  usableMaxBeatError: 0.8,
  note: '',
});
/** 打开编辑时记录的 updatedAt，作为乐观锁依据 */
const expectedUpdatedAt = ref(0);
const formError = ref('');
const submitting = ref(false);

const dialogTitle = computed(() => (editingId.value ? '编辑标准版本' : '新增标准版本（按生效日期切换）'));

function resetForm() {
  form.name = '';
  form.effectiveDate = formatDate(Date.now());
  form.maxAbsRate = 5;
  form.maxBeatError = 0.5;
  form.minAmplitude = 270;
  form.usableMaxAbsRate = 20;
  form.usableMaxBeatError = 0.8;
  form.note = '';
  formError.value = '';
}

function openCreate() {
  editingId.value = '';
  resetForm();
  dialogVisible.value = true;
}

function openEdit(row: {
  id: string;
  name: string;
  effectiveAt: number;
  maxAbsRate: number;
  maxBeatError: number;
  minAmplitude: number;
  usableMaxAbsRate: number;
  usableMaxBeatError: number;
  note: string;
  updatedAt: number;
}) {
  editingId.value = row.id;
  form.name = row.name;
  form.effectiveDate = formatDate(row.effectiveAt);
  form.maxAbsRate = row.maxAbsRate;
  form.maxBeatError = row.maxBeatError;
  form.minAmplitude = row.minAmplitude;
  form.usableMaxAbsRate = row.usableMaxAbsRate;
  form.usableMaxBeatError = row.usableMaxBeatError;
  form.note = row.note;
  expectedUpdatedAt.value = row.updatedAt;
  formError.value = '';
  dialogVisible.value = true;
}

function validate(): string {
  if (!form.name.trim()) return '版本名称必填';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.effectiveDate)) return '请填写生效日期';
  if (!(form.maxAbsRate >= 0)) return '合格日差上限不合法';
  if (!(form.maxBeatError >= 0)) return '合格偏振上限不合法';
  if (!(form.minAmplitude >= 0)) return '合格摆幅下限不合法';
  if (form.usableMaxAbsRate < form.maxAbsRate) return '「可用」日差上限不得严于合格线';
  if (form.usableMaxBeatError < form.maxBeatError) return '「可用」偏振上限不得严于合格线';
  return '';
}

async function submit() {
  const err = validate();
  if (err) {
    formError.value = err;
    return;
  }
  if (submitting.value) return;
  submitting.value = true;
  try {
    const payload = {
      name: form.name.trim(),
      effectiveAt: new Date(`${form.effectiveDate}T00:00:00`).getTime(),
      maxAbsRate: Number(form.maxAbsRate),
      maxBeatError: Number(form.maxBeatError),
      minAmplitude: Number(form.minAmplitude),
      usableMaxAbsRate: Number(form.usableMaxAbsRate),
      usableMaxBeatError: Number(form.usableMaxBeatError),
      note: form.note.trim(),
    };
    if (editingId.value) {
      await standardStore.updateVersion(editingId.value, payload, expectedUpdatedAt.value);
      ElMessage.success('标准已修改，相关钟表的放行状态已重算');
    } else {
      await standardStore.addVersion(payload);
      ElMessage.success('新版本已保存，自生效日期起自动对新测试生效');
    }
    dialogVisible.value = false;
  } catch (e) {
    if (e instanceof StandardVersionConflict) {
      formError.value = e.message + '；请刷新版本列表后以最新内容重新编辑（本次修改未保存）';
      void standardStore.load();
    } else {
      formError.value = e instanceof Error ? e.message : String(e);
    }
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  void standardStore.load();
});
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>走时合格标准</h2>
      <el-tag type="warning" effect="plain">版本按生效日期切换，修改只影响放行重算，历史测试始终保留当时所依据的版本</el-tag>
      <div class="spacer" />
      <el-button type="primary" @click="openCreate">新增标准版本</el-button>
    </div>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="规则说明"
      description="每次走时测试保存时绑定当时生效的版本，作为历史判定依据；标准一旦修改，钟表放行状态统一对照现行版本重算。两个页签同时编辑同一版本时，只保留先提交的修改，后提交的会被拒绝并提示重新打开。"
    />

    <el-card shadow="never">
      <el-table :data="versions" size="small" border>
        <el-table-column label="版本" min-width="190">
          <template #default="{ row }">
            <strong>{{ row.name }}</strong>
            <el-tag v-if="standardStore.current?.id === row.id" type="success" size="small" style="margin-left: 6px">
              现行
            </el-tag>
            <el-tag v-else-if="row.effectiveAt > now" type="info" size="small" effect="plain" style="margin-left: 6px">
              待生效
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="生效日期" width="110">
          <template #default="{ row }">{{ formatDate(row.effectiveAt) }}</template>
        </el-table-column>
        <el-table-column label="合格阈值" min-width="260">
          <template #default="{ row }">{{ thresholdText(row) }}</template>
        </el-table-column>
        <el-table-column label="可用（需再调）" min-width="180">
          <template #default="{ row }">
            |日差|≤{{ row.usableMaxAbsRate }} s/d、偏振≤{{ row.usableMaxBeatError }} ms
          </template>
        </el-table-column>
        <el-table-column prop="note" label="说明" min-width="200" show-overflow-tooltip />
        <el-table-column label="最后修改" width="170">
          <template #default="{ row }">{{ new Date(row.updatedAt).toLocaleString('zh-CN') }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="640px">
      <el-alert
        v-if="formError"
        :title="formError"
        type="error"
        :closable="false"
        style="margin-bottom: 10px"
      />
      <el-form :model="form" label-width="130px">
        <el-form-item label="版本名称" required>
          <el-input v-model="form.name" placeholder="如 2026-12 收紧版" />
        </el-form-item>
        <el-form-item label="生效日期" required>
          <el-date-picker
            v-model="form.effectiveDate"
            type="date"
            value-format="YYYY-MM-DD"
            :clearable="false"
          />
        </el-form-item>
        <el-divider content-position="left">合格阈值（全部满足才判合格）</el-divider>
        <el-form-item label="日差上限 s/d">
          <el-input-number v-model="form.maxAbsRate" :min="0" :max="99" :step="0.5" :precision="1" />
          <span class="hint">实测 |日差| ≤ 该值</span>
        </el-form-item>
        <el-form-item label="摆幅下限 °">
          <el-input-number v-model="form.minAmplitude" :min="0" :max="400" :step="5" />
          <span class="hint">实测摆幅 ≥ 该值</span>
        </el-form-item>
        <el-form-item label="偏振上限 ms">
          <el-input-number v-model="form.maxBeatError" :min="0" :max="9.9" :step="0.1" :precision="2" />
          <span class="hint">实测偏振 ≤ 该值</span>
        </el-form-item>
        <el-divider content-position="left">可用（需再调）阈值</el-divider>
        <el-form-item label="日差上限 s/d">
          <el-input-number v-model="form.usableMaxAbsRate" :min="0" :max="99" :step="0.5" :precision="1" />
        </el-form-item>
        <el-form-item label="偏振上限 ms">
          <el-input-number v-model="form.usableMaxBeatError" :min="0" :max="9.9" :step="0.1" :precision="2" />
        </el-form-item>
        <el-form-item label="版本说明">
          <el-input v-model="form.note" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">提交</el-button>
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
.hint {
  margin-left: 10px;
  color: #9099a4;
  font-size: 12px;
}
</style>
