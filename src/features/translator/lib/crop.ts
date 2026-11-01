export interface CropBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 规范化选区坐标：拖拽可能朝左上反向绘制，将负宽高转换为合法的左上角与正宽高。 */
export function normalizeRect(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number
): CropBounds {
  const left = Math.min(startX, currentX);
  const top = Math.min(startY, currentY);
  const width = Math.abs(currentX - startX);
  const height = Math.abs(currentY - startY);
  return { x: Math.round(left), y: Math.round(top), width: Math.round(width), height: Math.round(height) };
}

/** 纯函数：将屏幕 CSS 选区按缩放比映射到捕获图的物理像素范围并夹取。 */
export function scaleRectToImage(
  rect: CropBounds,
  viewW: number,
  viewH: number,
  imgW: number,
  imgH: number
): CropBounds | null {
  if (![rect.x, rect.y, rect.width, rect.height, viewW, viewH, imgW, imgH].every(Number.isFinite)
    || rect.width <= 0 || rect.height <= 0 || viewW <= 0 || viewH <= 0 || imgW <= 0 || imgH <= 0) return null;
  const scaleX = imgW / viewW;
  const scaleY = imgH / viewH;
  const x = Math.max(0, Math.round(rect.x * scaleX));
  const y = Math.max(0, Math.round(rect.y * scaleY));
  const width = Math.min(imgW - x, Math.round(rect.width * scaleX));
  const height = Math.min(imgH - y, Math.round(rect.height * scaleY));
  if (width < 4 || height < 4) return null;
  return { x, y, width, height };
}

/** Reuse the decoded frozen frame; invoke only after successful native release. */
export function cropDecodedImage(image: HTMLImageElement, rect: CropBounds): string {
  if (!image.complete || !image.naturalWidth) throw new Error("capture_image_not_ready");
  const canvas = document.createElement("canvas");
  canvas.width = rect.width;
  canvas.height = rect.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("capture_canvas_unavailable");
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  const data = canvas.toDataURL("image/png");
  return data.slice("data:image/png;base64,".length);
}
