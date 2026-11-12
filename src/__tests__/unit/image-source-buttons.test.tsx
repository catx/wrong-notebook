import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { ReactNode, RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HiddenFileInputs, ImageSourceButtons } from "@/components/upload-zone/image-source-buttons";
import { LanguageProvider } from "@/contexts/LanguageContext";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});

const render = (node: ReactNode) => act(async () => root.render(<LanguageProvider>{node}</LanguageProvider>));

describe("图片入口无摄像头时自动隐藏拍照", () => {
    it("有摄像头时显示拍照、相册、文件三个入口", async () => {
        await render(<ImageSourceButtons openSource={vi.fn()} isAnalyzing={false} hasCamera={true} />);
        expect(container.querySelectorAll("button")).toHaveLength(3);
        expect(container.textContent).toContain("拍照");
    });

    it("无法判断时保持三个入口，不误伤有相机的设备", async () => {
        await render(<ImageSourceButtons openSource={vi.fn()} isAnalyzing={false} hasCamera={null} />);
        expect(container.querySelectorAll("button")).toHaveLength(3);
    });

    it("确认无摄像头时隐藏拍照，只保留相册和文件", async () => {
        await render(<ImageSourceButtons openSource={vi.fn()} isAnalyzing={false} hasCamera={false} />);
        expect(container.querySelectorAll("button")).toHaveLength(2);
        expect(container.textContent).not.toContain("拍照");
        expect(container.querySelector('[data-testid="image-sources"]')?.className).toContain("grid-cols-2");
    });

    it("无摄像头时不再保留带 capture 的隐藏输入", async () => {
        const refs = {
            cameraInput: { current: null } as RefObject<HTMLInputElement | null>,
            albumInput: { current: null } as RefObject<HTMLInputElement | null>,
            fileInput: { current: null } as RefObject<HTMLInputElement | null>,
        };
        await render(<HiddenFileInputs {...refs} handlePicked={vi.fn()} showCamera={false} />);
        expect(container.querySelector('[data-testid="camera-input"]')).toBeNull();
        expect(container.querySelector('[data-testid="album-input"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="file-input"]')).not.toBeNull();
    });
});
