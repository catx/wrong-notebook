package com.margrop.wrongnotebook;

import android.app.Activity;
import android.app.AlertDialog;
import android.view.View;

/**
 * 墨水屏设备的原生界面调整：关闭窗口和对话框动画，隐藏会周期性重绘的状态栏。
 *
 * 墨水屏刷新一次整屏的功耗远高于 LCD，动画和状态栏时钟的持续重绘既费电又会留下残影；
 * 只在 eink 构建风格中生效，手机版和平板版不受影响。
 */
final class Eink {
    private Eink() {
    }

    /** 在 Activity 的 onCreate 中调用 */
    static void apply(Activity activity) {
        if (!BuildConfig.EINK) return;
        activity.getWindow().setWindowAnimations(0);
        enterImmersive(activity);
    }

    /** 隐藏状态栏和导航栏；用户从屏幕边缘滑动时临时显示，随后自动恢复 */
    @SuppressWarnings("deprecation")
    static void enterImmersive(Activity activity) {
        if (!BuildConfig.EINK) return;
        activity.getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    /** 关闭系统对话框的淡入淡出动画 */
    static void disableDialogAnimation(AlertDialog dialog) {
        if (!BuildConfig.EINK) return;
        if (dialog.getWindow() != null) dialog.getWindow().setWindowAnimations(0);
    }

    /** 打开另一个 Activity 时关闭切换动画 */
    static void overrideTransition(Activity activity) {
        if (BuildConfig.EINK) activity.overridePendingTransition(0, 0);
    }
}
