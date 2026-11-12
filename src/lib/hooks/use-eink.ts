"use client";

import { useSyncExternalStore } from "react";
import { isEinkDevice } from "@/lib/eink";

const subscribeNothing = () => () => undefined;

/**
 * 当前是否在墨水屏设备上运行。User-Agent 在客户端可用，服务端渲染时按 false，
 * 避免水合后主题和界面开关出现不一致。
 */
export function useEinkDevice(): boolean {
    return useSyncExternalStore(subscribeNothing, isEinkDevice, () => false);
}
