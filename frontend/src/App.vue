<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { readDbVersion } from './utils/db';
import { subscribeDataChange } from './utils/crossTab';
import { useStandardStore } from './stores/standardStore';
import { useStepStore } from './stores/stepStore';

const route = useRoute();
const router = useRouter();

const activeMenu = computed(() => {
  if (route.path.startsWith('/clocks')) return '/clocks';
  if (route.path.startsWith('/steps')) return '/steps/new';
  if (route.path.startsWith('/parts')) return '/parts';
  if (route.path.startsWith('/tests')) return '/tests';
  if (route.path.startsWith('/standards')) return '/standards';
  return '/clocks';
});

const version = readDbVersion();

function onSelect(index: string) {
  if (index === '/tests') {
    void router.push('/tests/');
    return;
  }
  void router.push(index);
}

// 其他页签修改标准/测试后，本页签重拉数据，放行状态与判定依据随之重算
const standardStore = useStandardStore();
const stepStore = useStepStore();
let unsubscribe: (() => void) | undefined;
onMounted(() => {
  unsubscribe = subscribeDataChange((name) => {
    if (name === 'standards') void standardStore.load();
    if (name === 'tests') void stepStore.load();
  });
});
onUnmounted(() => unsubscribe?.());
</script>

<template>
  <el-container class="app">
    <el-header class="app-header">
      <div class="brand">古钟表维修工序档案</div>
      <el-menu :default-active="activeMenu" mode="horizontal" class="menu" @select="onSelect">
        <el-menu-item index="/clocks">钟表台账</el-menu-item>
        <el-menu-item index="/steps/new">工序录入</el-menu-item>
        <el-menu-item index="/parts">零件清单</el-menu-item>
        <el-menu-item index="/tests">走时测试</el-menu-item>
        <el-menu-item index="/standards">合格标准</el-menu-item>
      </el-menu>
      <el-tag size="small" effect="plain">本地结构版本 v{{ version }}</el-tag>
    </el-header>
    <el-main class="app-main">
      <router-view />
    </el-main>
  </el-container>
</template>

<style scoped>
.app {
  min-height: 100vh;
  background: #f6f8fa;
}
.app-header {
  display: flex;
  align-items: center;
  gap: 18px;
  background: #2f3a46;
  color: #f4f6f8;
  height: 60px;
}
.brand {
  font-size: 18px;
  font-weight: 700;
  white-space: nowrap;
}
.menu {
  flex: 1;
  border-bottom: none;
  background: transparent;
}
:deep(.menu .el-menu-item) {
  color: #d6dde5;
}
:deep(.menu .el-menu-item.is-active) {
  color: #ffffff;
  border-bottom-color: #e7c56b;
}
.app-main {
  padding: 18px 22px 40px;
}
</style>
