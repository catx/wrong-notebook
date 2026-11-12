/**
 * 墨水屏（E-ink）设备识别与界面辅助。
 *
 * 安卓墨水屏版 APK 的 User-Agent 末尾带有 `WrongNotebookAndroid/<版本> (eink)`，
 * 与手机版 `(phone)`、平板版 `(tablet)` 区分。网页据此在首屏就关闭动画、强制浅色主题，
 * 不需要等待原生 Bridge 注入。
 */

/** 墨水屏版 App 的 User-Agent 标记；首屏脚本也使用这段正则 */
export const EINK_UA_PATTERN = /WrongNotebookAndroid\/[^ ]+ \(eink\)/;

export function isEinkUserAgent(userAgent: string): boolean {
    return EINK_UA_PATTERN.test(userAgent);
}

/** 当前是否在墨水屏设备上运行；服务端渲染时返回 false */
export function isEinkDevice(): boolean {
    if (typeof navigator === "undefined") return false;
    if (isEinkUserAgent(navigator.userAgent)) return true;
    return typeof document !== "undefined" && document.documentElement.classList.contains("eink");
}

/** 滚动行为：墨水屏不做平滑滚动，避免连续重绘 */
export function einkScrollBehavior(): ScrollBehavior {
    return isEinkDevice() ? "auto" : "smooth";
}
