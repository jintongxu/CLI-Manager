/** 翻译可用的对话模型选项，来自「设置 → 对话模型」中已启用的供应商与模型。 */
export interface TranslatorModelOption {
  providerId: string;
  providerName: string;
  modelId: string;
  isDefault: boolean;
}

/** 选择键用 `:::` 分隔，避免模型 ID 自身包含冒号时解析歧义。 */
const KEY_SEPARATOR = ":::";

export function translatorModelKey(providerId: string, modelId: string): string {
  return `${providerId}${KEY_SEPARATOR}${modelId}`;
}

export function parseTranslatorModelKey(key: string): { providerId: string; modelId: string } | null {
  const index = key.indexOf(KEY_SEPARATOR);
  if (index <= 0) return null;
  const providerId = key.slice(0, index);
  const modelId = key.slice(index + KEY_SEPARATOR.length);
  return providerId && modelId ? { providerId, modelId } : null;
}

/**
 * 解析实际生效的模型：选择仍有效就用选择，否则回退默认项（isDefault 优先，再退回第一项）。
 * 后端同样会校验启用状态，这里只负责界面与请求参数的一致性。
 */
export function resolveTranslatorModel(
  models: TranslatorModelOption[],
  selectedKey: string
): TranslatorModelOption | null {
  if (!models.length) return null;
  const parsed = parseTranslatorModelKey(selectedKey);
  if (parsed) {
    const selected = models.find(
      (model) => model.providerId === parsed.providerId && model.modelId === parsed.modelId
    );
    if (selected) return selected;
  }
  return models.find((model) => model.isDefault) ?? models[0];
}

export function translatorModelLabel(model: TranslatorModelOption): string {
  return `${model.providerName} · ${model.modelId}`;
}
