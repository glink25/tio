/** Shared workspace configuration. Keys are Base64 obscured, not encrypted. */
export interface AssistantApiConfig {
  id: string;
  name: string;
  apiType: 'open-ai-compatible' | 'google-ai-studio';
  apiUrl: string;
  model: string;
  apiKey: string;
  contextWindow?: number;
  maxTokens?: number;
  imageInput?: boolean;
  customParams?: Record<string, unknown>;
}
export interface AssistantSettings {
  configs: AssistantApiConfig[];
  defaultConfigId?: string;
  extraPrompt?: string;
}
export function validateAssistant(value: unknown): asserts value is AssistantSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid assistant settings');
  const settings = value as AssistantSettings;
  if (!Array.isArray(settings.configs)) throw new Error('Invalid assistant configurations');
  const ids = new Set<string>();
  for (const config of settings.configs) {
    if (
      !config ||
      !['id', 'name', 'apiUrl', 'apiKey', 'model'].every(
        (k) => typeof config[k as keyof AssistantApiConfig] === 'string',
      ) ||
      !config.id ||
      ids.has(config.id) ||
      !['open-ai-compatible', 'google-ai-studio'].includes(config.apiType)
    )
      throw new Error('Invalid assistant configuration');
    if (!config.name.trim() || !config.model.trim())
      throw new Error('AI configuration name and model are required');
    const endpoint = new URL(config.apiUrl);
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password)
      throw new Error('Invalid AI endpoint');
    ids.add(config.id);
    if (
      config.apiKey &&
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(config.apiKey)
    )
      throw new Error('Invalid encoded API key');
    for (const key of ['maxTokens', 'contextWindow'] as const)
      if (config[key] !== undefined && (!Number.isSafeInteger(config[key]) || config[key]! <= 0))
        throw new Error('Invalid token limit');
    if (config.imageInput !== undefined && typeof config.imageInput !== 'boolean')
      throw new Error('Invalid image input setting');
    if (
      config.customParams !== undefined &&
      (!config.customParams ||
        typeof config.customParams !== 'object' ||
        Array.isArray(config.customParams))
    )
      throw new Error('Invalid custom parameters');
  }
  if (settings.defaultConfigId !== undefined && !ids.has(settings.defaultConfigId))
    throw new Error('Invalid default AI configuration');
  if (settings.extraPrompt !== undefined && typeof settings.extraPrompt !== 'string')
    throw new Error('Invalid assistant prompt');
}
