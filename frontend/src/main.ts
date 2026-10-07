import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import 'element-plus/dist/index.css';
import App from './App.vue';
import router from './router';
import { ensureSeedData, markDbVersion } from './utils/db';
import { useStandardStore } from './stores/standardStore';

async function bootstrap() {
  // 先完成 IndexedDB 迁移与示范数据灌入，再挂载应用，避免首屏空态抖动
  await ensureSeedData();
  markDbVersion();

  const app = createApp(App);
  const pinia = createPinia();
  app.use(pinia);
  app.use(router);
  app.use(ElementPlus, { locale: zhCn });
  // 标准版本在所有页面（台账/详情/走时单）都参与重算，挂载前统一加载
  await useStandardStore(pinia).load();
  app.mount('#app');
}

void bootstrap();
