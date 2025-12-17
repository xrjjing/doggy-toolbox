/**
 * M35: 二维码生成器工具
 */
(function(global) {
    'use strict';

    const M35Utils = {
        // 生成二维码
        generate(text, options = {}) {
            if (!text) {
                return { error: '请输入内容' };
            }

            const {
                size = 256,
                errorCorrectionLevel = 'M', // L, M, Q, H
                margin = 4,
                darkColor = '#000000',
                lightColor = '#ffffff'
            } = options;

            try {
                // 使用 qrcode-generator 库
                const typeNumber = 0; // 自动检测
                const qr = qrcode(typeNumber, errorCorrectionLevel);
                qr.addData(text);
                qr.make();

                // 生成 canvas
                const moduleCount = qr.getModuleCount();
                const cellSize = Math.floor((size - margin * 2) / moduleCount);
                const actualSize = cellSize * moduleCount + margin * 2;

                const canvas = document.createElement('canvas');
                canvas.width = actualSize;
                canvas.height = actualSize;
                const ctx = canvas.getContext('2d');

                // 背景
                ctx.fillStyle = lightColor;
                ctx.fillRect(0, 0, actualSize, actualSize);

                // 绘制模块
                ctx.fillStyle = darkColor;
                for (let row = 0; row < moduleCount; row++) {
                    for (let col = 0; col < moduleCount; col++) {
                        if (qr.isDark(row, col)) {
                            ctx.fillRect(
                                margin + col * cellSize,
                                margin + row * cellSize,
                                cellSize,
                                cellSize
                            );
                        }
                    }
                }

                return {
                    canvas,
                    dataUrl: canvas.toDataURL('image/png'),
                    size: actualSize,
                    moduleCount
                };
            } catch (e) {
                return { error: '生成失败: ' + e.message };
            }
        },

        // 下载二维码
        download(dataUrl, filename = 'qrcode.png') {
            const link = document.createElement('a');
            link.href = dataUrl;
            link.download = filename;
            link.click();
        },

        // 复制到剪贴板
        async copyToClipboard(canvas) {
            try {
                const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                await navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': blob })
                ]);
                return { success: true };
            } catch (e) {
                return { error: '复制失败: ' + e.message };
            }
        },

        // 获取文本字节长度（用于显示容量信息）
        getByteLength(text) {
            return new Blob([text]).size;
        },

        // 获取容量限制信息
        getCapacityInfo(errorCorrectionLevel = 'M') {
            // 最大容量（字符数，取决于纠错级别和数据类型）
            const capacities = {
                'L': { numeric: 7089, alphanumeric: 4296, byte: 2953 },
                'M': { numeric: 5596, alphanumeric: 3391, byte: 2331 },
                'Q': { numeric: 3993, alphanumeric: 2420, byte: 1663 },
                'H': { numeric: 3057, alphanumeric: 1852, byte: 1273 }
            };
            return capacities[errorCorrectionLevel] || capacities['M'];
        }
    };

    // 导出
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = M35Utils;
    } else {
        global.M35Utils = M35Utils;
    }
})(typeof window !== 'undefined' ? window : this);
