"use client";

import type { ChangeEvent, RefObject } from "react";
import { Camera, FolderOpen, Images } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

interface ImageSourceButtonsProps {
    openSource: (key: "camera" | "album" | "file") => void;
    isAnalyzing: boolean;
    /** 是否有可用相机；false 时自动隐藏拍照入口，只保留相册和文件 */
    hasCamera: boolean | null;
}

/** 触屏设备（手机、平板）的拍照、相册、文件三个独立入口；用 CSS 媒体查询判断，不依赖渲染时的状态 */
export function ImageSourceButtons({ openSource, isAnalyzing, hasCamera }: ImageSourceButtonsProps) {
    const { t } = useLanguage();
    const sources = [
        { key: "camera" as const, icon: Camera, label: t.upload.camera, desc: t.upload.cameraDesc },
        { key: "album" as const, icon: Images, label: t.upload.album, desc: t.upload.albumDesc },
        { key: "file" as const, icon: FolderOpen, label: t.upload.file, desc: t.upload.fileDesc },
    ].filter((source) => source.key !== "camera" || hasCamera !== false);

    return (
        <div className={cn("hidden gap-2 pointer-coarse:grid", sources.length === 3 ? "grid-cols-3" : "grid-cols-2")} data-testid="image-sources">
            {sources.map((source) => (
                <Button
                    key={source.key}
                    type="button"
                    variant="outline"
                    onClick={() => openSource(source.key)}
                    disabled={isAnalyzing}
                    className="flex h-auto flex-col gap-1 py-3"
                    aria-description={source.desc}
                >
                    <source.icon className="h-6 w-6" />
                    <span className="text-sm font-medium">{source.label}</span>
                </Button>
            ))}
        </div>
    );
}

interface HiddenFileInputsProps {
    cameraInput: RefObject<HTMLInputElement | null>;
    albumInput: RefObject<HTMLInputElement | null>;
    fileInput: RefObject<HTMLInputElement | null>;
    handlePicked: (event: ChangeEvent<HTMLInputElement>) => void;
    /** 无摄像头时不再保留带 capture 的隐藏输入，彻底关闭拍照路径 */
    showCamera: boolean;
}

/** 隐藏的文件选择器始终存在，桌面端「从文件选择」也可用 */
export function HiddenFileInputs({ cameraInput, albumInput, fileInput, handlePicked, showCamera }: HiddenFileInputsProps) {
    return (
        <>
            {showCamera && (
                <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePicked} data-testid="camera-input" />
            )}
            <input ref={albumInput} type="file" accept="image/*" multiple className="hidden" onChange={handlePicked} data-testid="album-input" />
            <input ref={fileInput} type="file" multiple className="hidden" onChange={handlePicked} data-testid="file-input" />
        </>
    );
}
