import { afterEach, describe, expect, it } from "vitest";
import { EINK_UA_PATTERN, einkScrollBehavior, isEinkDevice, isEinkUserAgent } from "@/lib/eink";

const EINK_UA = "Mozilla/5.0 (Linux; Android 8.1; Moaan-SR9) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/111.0.0.0 Safari/537.36 WrongNotebookAndroid/2026.11.12 (eink)";
const PHONE_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 WrongNotebookAndroid/2026.11.12 (phone)";
const originalUserAgent = Object.getOwnPropertyDescriptor(navigator, "userAgent");

function setUserAgent(value: string) {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value });
}

afterEach(() => {
    document.documentElement.classList.remove("eink");
    if (originalUserAgent) Object.defineProperty(navigator, "userAgent", originalUserAgent);
    else Reflect.deleteProperty(navigator, "userAgent");
});

describe("墨水屏识别", () => {
    it("只匹配墨水屏版 App 的 (eink) 标记", () => {
        expect(EINK_UA_PATTERN.test(EINK_UA)).toBe(true);
        expect(isEinkUserAgent(EINK_UA)).toBe(true);
        expect(isEinkUserAgent(PHONE_UA)).toBe(false);
        expect(isEinkUserAgent("Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0.0.0")).toBe(false);
    });

    it("按当前 User-Agent 或 eink 类判断，普通浏览器为 false", () => {
        setUserAgent(PHONE_UA);
        expect(isEinkDevice()).toBe(false);
        setUserAgent(EINK_UA);
        expect(isEinkDevice()).toBe(true);
    });

    it("首屏脚本加上 eink 类后也可识别（User-Agent 变化时仍保持）", () => {
        setUserAgent(PHONE_UA);
        document.documentElement.classList.add("eink");
        expect(isEinkDevice()).toBe(true);
    });

    it("墨水屏不做平滑滚动", () => {
        setUserAgent(PHONE_UA);
        expect(einkScrollBehavior()).toBe("smooth");
        setUserAgent(EINK_UA);
        expect(einkScrollBehavior()).toBe("auto");
    });
});
