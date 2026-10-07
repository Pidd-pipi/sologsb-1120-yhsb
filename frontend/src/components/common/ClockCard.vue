<script setup lang="ts">
import type { Clock } from '../../types/clock';
import StateBadge from './StateBadge.vue';

defineProps<{
  item: Clock;
  /** 底部附加说明（工序进度等） */
  footer?: string;
  /** 按现行标准重算后的放行状态及判定依据 */
  release?: {
    label: string;
    type: 'success' | 'danger' | 'warning' | 'info';
    reason: string;
  };
}>();

const emit = defineEmits<{
  (e: 'open', id: string): void;
}>();
</script>

<template>
  <el-card class="clock-card" shadow="hover" @click="emit('open', item.id)">
    <div class="row">
      <strong>{{ item.clockNo }}</strong>
      <StateBadge :grade="item.conditionGrade" />
      <el-tag size="small" effect="plain">{{ item.kind }}</el-tag>
    </div>
    <el-tooltip v-if="release" :content="release.reason" placement="top" :show-after="200">
      <el-tag :type="release.type" size="small" effect="dark" class="release-tag">
        放行：{{ release.label }}
      </el-tag>
    </el-tooltip>
    <div class="line">机芯型号：{{ item.caliber }}</div>
    <div class="line">{{ item.origin }} · {{ item.maker }} · {{ item.yearMade }}</div>
    <div class="line">钟壳：{{ item.caseMaterial }} · 尺寸 {{ item.size }} mm</div>
    <div class="line">盘面：{{ item.dialMark }}</div>
    <div class="line">存放：{{ item.storagePos }}</div>
    <div v-if="footer" class="line footer">{{ footer }}</div>
    <div v-if="release" class="line reason">判定依据：{{ release.reason }}</div>
  </el-card>
</template>

<style scoped>
.clock-card {
  cursor: pointer;
  height: 100%;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.release-tag {
  margin-bottom: 6px;
}
.line {
  font-size: 13px;
  color: #5b6470;
  line-height: 1.7;
}
.footer {
  margin-top: 6px;
  color: #2f3a46;
  font-weight: 600;
}
.reason {
  margin-top: 4px;
  color: #8a6d1c;
  font-size: 12px;
  line-height: 1.5;
}
</style>
