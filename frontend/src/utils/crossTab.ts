/**
 * 跨页签数据变更通知：标准或测试在任意页签被修改后，其余页签重新拉取数据，
 * 保证重算结论与放行状态一致。优先用 BroadcastChannel，不支持时回退 localStorage 事件。
 */
export type DataChannelName = 'standards' | 'tests';

const PREFIX = 'gbclockrepair:sync:';

let channel: BroadcastChannel | undefined;
if (typeof BroadcastChannel !== 'undefined') {
  channel = new BroadcastChannel('gbclockrepair:sync');
}

type Unsubscribe = () => void;

export function subscribeDataChange(handler: (name: DataChannelName) => void): Unsubscribe {
  const onChannel = (event: MessageEvent<DataChannelName>) => handler(event.data);
  const onStorage = (event: StorageEvent) => {
    if (event.key && event.key.startsWith(PREFIX)) {
      handler(event.key.slice(PREFIX.length) as DataChannelName);
    }
  };
  channel?.addEventListener('message', onChannel);
  window.addEventListener('storage', onStorage);
  return () => {
    channel?.removeEventListener('message', onChannel);
    window.removeEventListener('storage', onStorage);
  };
}

/** 通知其他页签（本页签不触发 storage 事件，也不应收到自己发的广播） */
export function broadcastDataChange(name: DataChannelName): void {
  channel?.postMessage(name);
  try {
    window.localStorage.setItem(PREFIX + name, String(Date.now()));
  } catch {
    /* localStorage 不可用时忽略，BroadcastChannel 仍生效 */
  }
}
