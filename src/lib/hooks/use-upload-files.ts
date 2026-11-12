"use client";

import { useCallback, useState, useEffect, useRef, useSyncExternalStore } from "react";
import type { ChangeEvent } from "react";
import { useDropzone } from "react-dropzone";
import { useLanguage } from "@/contexts/LanguageContext";
import { getAndroidAppBridge } from "@/lib/android-app";
import type { AndroidAppBridge } from "@/lib/android-app";
import { toast } from "@/lib/feedback";
import { useIsClient } from "@/lib/hooks/use-is-client";
import { frontendLogger } from "@/lib/frontend-logger";

/**
 * 拖拽区与「从文件选择」接受的类型：image/* 加常见扩展名。部分系统不认识 HEIC/HEIF 的 MIME（报告为空或 octet-stream），
 * 按扩展名放行，选择后再按文件头识别真实格式。
 */
export const IMAGE_ACCEPT = { "image/*": [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".heic", ".heif"] };

// 添加 CaptureController 类型声明
declare global {
    interface CaptureController {
        setFocusBehavior(behavior: 'no-focus-change' | 'focus-capturing-application'): void;
    }

    interface Window {
        CaptureController: {
            new(): CaptureController;
        };
    }
}

/**
 * 安卓 App 报告是否有可用相机。早期 App 没有 hasCamera 接口时返回 null（不确定，保持原来的拍照入口）。
 * 原生接口异常时也按不确定处理，不误伤有相机的设备。
 */
export function bridgeCameraAvailability(bridge: AndroidAppBridge | null): boolean | null {
    if (!bridge || typeof bridge.hasCamera !== "function") return null;
    try {
        return bridge.hasCamera();
    } catch {
        return null;
    }
}

/** 从原生 Bridge 读取相机能力；接口不存在或出错时返回 null */
function readBridgeCameraAvailability(): boolean | null {
    return bridgeCameraAvailability(getAndroidAppBridge());
}

const subscribeNothing = () => () => undefined;

/**
 * 检测是否有摄像头：安卓 App 用原生接口判断（WebView 的设备枚举不代表原生相机能力）；
 * 普通浏览器只在提供 mediaDevices 时判断（HTTP 页面和部分 WebView 不提供，此时不阻止拍照）。
 * 不请求权限，只读取设备种类。返回 null 表示无法判断。
 *
 * Bridge 的结果用 useSyncExternalStore 读取：服务端渲染按 null，水合后再更新，
 * 避免直接在水合时隐藏拍照入口造成 DOM 不一致；浏览器枚举仍在 effect 中异步更新。
 */
export function useCameraAvailability(): boolean | null {
    const bridgeCamera = useSyncExternalStore(subscribeNothing, readBridgeCameraAvailability, () => null);
    const [browserCamera, setBrowserCamera] = useState<boolean | null>(null);
    useEffect(() => {
        if (getAndroidAppBridge()) return;
        if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
        let cancelled = false;
        navigator.mediaDevices.enumerateDevices()
            .then((devices) => {
                if (!cancelled) setBrowserCamera(devices.some((device) => device.kind === "videoinput"));
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, []);
    return bridgeCamera !== null ? bridgeCamera : browserCamera;
}

/**
 * 判断浏览器是否支持通过按钮读取剪贴板（需要安全上下文）。
 */
export function isClipboardReadSupported(isClient: boolean): boolean {
    return isClient &&
        typeof navigator !== 'undefined' &&
        !!navigator.clipboard &&
        typeof navigator.clipboard.read === 'function';
}

/**
 * 判断浏览器是否支持屏幕截图（getDisplayMedia）。
 */
export function isScreenshotSupported(isClient: boolean): boolean {
    return isClient &&
        typeof navigator !== 'undefined' &&
        'mediaDevices' in navigator &&
        'getDisplayMedia' in navigator.mediaDevices;
}

/**
 * 从粘贴事件中提取第一个图片文件；输入框中粘贴或内容不是图片时返回 null。
 */
export function extractImageFromPasteEvent(event: ClipboardEvent): File | null {
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || ["INPUT", "TEXTAREA"].includes(target.tagName))) {
        return null;
    }

    const items = Array.from(event.clipboardData?.items ?? []);
    const imageItem = items.find((item) => item.kind === "file" && item.type.startsWith("image/"));
    return imageItem?.getAsFile() ?? null;
}

/**
 * 将剪贴板中的图片 Blob 转为 File：带名字的 File 直接使用，其余按类型生成文件名。
 */
export function clipboardImageToFile(blob: Blob): File {
    const type = blob.type || "image/png";
    const ext = type.split("/")[1] || "png";
    return blob instanceof File && blob.name
        ? blob
        : new File([blob], `clipboard-${Date.now()}.${ext}`, { type });
}

interface UploadZoneProps {
    onImageSelect: (file: File) => void;  // 改为传递 File 对象
    isAnalyzing: boolean;
}

export function useUploadZone({ onImageSelect, isAnalyzing }: UploadZoneProps) {
    const { t } = useLanguage();
    const [isScreenshotting, setIsScreenshotting] = useState(false);
    // 确保只在客户端渲染屏幕截图功能
    const isClient = useIsClient();

    useEffect(() => {
        // 请求通知权限
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }, []);

    const onDrop = useCallback(
        (acceptedFiles: File[]) => {
            const file = acceptedFiles[0];
            if (file) {
                // 直接传递 File 对象，让父组件处理压缩
                onImageSelect(file);
            }
        },
        [onImageSelect]
    );

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: IMAGE_ACCEPT,
        maxFiles: 1,
        disabled: isAnalyzing,
    });

    // 拍照、相册、文件三个独立入口：拍照用 capture 直接打开相机；相册只限图片；文件不限类型，作为相册中找不到照片时的兜底
    const hasCamera = useCameraAvailability();
    const cameraInput = useRef<HTMLInputElement>(null);
    const albumInput = useRef<HTMLInputElement>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const handlePicked = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        // 清空以便再次选择同一文件（如重拍后选同名照片）也能触发
        event.target.value = "";
        if (file) onImageSelect(file);
    };
    const openSource = (key: "camera" | "album" | "file") => {
        if (key === "camera" && hasCamera === false) {
            toast.warning(t.upload.noCamera);
            return;
        }
        ({ camera: cameraInput, album: albumInput, file: fileInput })[key].current?.click();
    };
    // 将剪贴板中的图片 Blob 转为 File 并交给父组件
    const selectClipboardImage = useCallback(
        (blob: Blob) => {
            onImageSelect(clipboardImageToFile(blob));
        },
        [onImageSelect]
    );

    // 监听 Ctrl/Cmd+V 粘贴图片
    useEffect(() => {
        const handlePaste = (event: ClipboardEvent) => {
            if (isAnalyzing) return;

            // 在输入框中粘贴时不拦截
            const file = extractImageFromPasteEvent(event);
            if (!file) return;

            event.preventDefault();
            selectClipboardImage(file);
        };

        window.addEventListener("paste", handlePaste);
        return () => window.removeEventListener("paste", handlePaste);
    }, [isAnalyzing, selectClipboardImage]);

    // 点击按钮读取剪贴板图片
    const handleClipboardRead = async () => {
        if (!isClipboardReadSupported(isClient)) {
            toast.warning(t.upload.pasteNotSupported);
            return;
        }

        try {
            const clipboardItems = await navigator.clipboard.read();
            for (const item of clipboardItems) {
                const imageType = item.types.find((type) => type.startsWith("image/"));
                if (imageType) {
                    const blob = await item.getType(imageType);
                    selectClipboardImage(blob);
                    return;
                }
            }
            toast.warning(t.upload.pasteNoImage);
        } catch (error) {
            frontendLogger.warn('[UploadZone]', 'Clipboard read failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            if (error instanceof Error && error.name === 'NotAllowedError') {
                toast.warning(t.upload.pastePermissionDenied);
            } else {
                toast.error(t.upload.pasteFailed);
            }
        }
    };

    // 屏幕截图功能
    const handleScreenshot = async () => {
        if (!isScreenshotSupported(isClient)) {
            toast.warning(t.upload.screenshotNotSupported);
            return;
        }

        setIsScreenshotting(true);

        try {
            // 创建 CaptureController 来控制焦点行为
            let controller: CaptureController | undefined;
            if ('CaptureController' in window) {
                controller = new window.CaptureController();
            }

            // 请求屏幕共享权限，优先当前标签页
            const displayMediaOptions: DisplayMediaStreamOptions & {
                preferCurrentTab?: boolean;
                controller?: CaptureController;
            } = {
                video: true,
                audio: false,
                preferCurrentTab: false,  // 优先显示"此标签页"选项
            };

            if (controller) {
                displayMediaOptions.controller = controller;
            }

            const stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);

            // 获取视频轨道并检查捕获类型
            const [videoTrack] = stream.getVideoTracks();
            const settings = videoTrack.getSettings();
            const displaySurface = settings.displaySurface;  // 'browser' 表示标签页

            // 如果是标签页或窗口，设置不切换焦点
            if (controller && (displaySurface === 'browser' || displaySurface === 'window')) {
                try {
                    controller.setFocusBehavior('no-focus-change');  // 关键：不切换焦点到选中标签页
                    frontendLogger.info('[UploadZone]', 'Screenshot focus behavior set to no-change', undefined, { sendToBackend: false });
                } catch (e) {
                    frontendLogger.warn('[UploadZone]', 'Unable to set screenshot focus behavior', { error: e });
                }
            }

            // 创建视频元素
            const video = document.createElement('video');
            video.srcObject = stream;
            video.muted = true;
            video.autoplay = true;
            video.playsInline = true;

            // 等待视频准备并播放
            await new Promise<void>((resolve, reject) => {
                video.onloadedmetadata = () => {
                    video.play().then(() => {
                        resolve();
                    }).catch(reject);
                };
                video.onerror = reject;
            });

            // 等待一帧渲染（确保稳定）
            await new Promise(resolve => setTimeout(resolve, 500));

            // 检查视频尺寸
            if (video.videoWidth === 0 || video.videoHeight === 0) {
                throw new Error('视频没有有效尺寸');
            }

            // 创建canvas并捕获
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                throw new Error('无法获取canvas上下文');
            }

            // 绘制视频帧
            ctx.drawImage(video, 0, 0);

            // 停止屏幕共享
            stream.getTracks().forEach(track => track.stop());

            // 转换为blob并创建文件
            canvas.toBlob((blob) => {
                if (blob) {
                    const file = new File([blob], `screenshot-${Date.now()}.png`, {
                        type: 'image/png'
                    });
                    onImageSelect(file);
                    frontendLogger.info('[UploadZone]', 'Screenshot captured', undefined, { sendToBackend: false });
                } else {
                    toast.error('截图转换失败');
                }
            }, 'image/png', 1.0);

        } catch (error) {
            frontendLogger.error('[UploadZone]', 'Screenshot failed', { error });
            if (error instanceof Error) {
                if (error.name === 'NotAllowedError') {
                    toast.warning(t.upload.screenshotPermissionDenied);
                } else {
                    toast.error(`${t.upload.screenshotFailed}: ${error.message}`);
                }
            }
        } finally {
            setIsScreenshotting(false);
        }
    };

    return {
        t,
        isClient,
        isAnalyzing,
        isDragActive,
        isScreenshotting,
        hasCamera,
        getRootProps,
        getInputProps,
        cameraInput,
        albumInput,
        fileInput,
        handlePicked,
        openSource,
        handleClipboardRead,
        handleScreenshot,
    };
}
