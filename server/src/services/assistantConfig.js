import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_ASSISTANT_MODEL = 'gpt-4.1-mini';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ASSISTANT_LOCAL_CONFIG_PATH = path.resolve(
  __dirname,
  '../../.assistant.local.json'
);

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readLocalAssistantConfig() {
  if (!fs.existsSync(ASSISTANT_LOCAL_CONFIG_PATH)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(ASSISTANT_LOCAL_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.error(
      '[assistant] local config error:',
      error?.message || error
    );
    return {};
  }
}

export function getAssistantConfig() {
  const localConfig = readLocalAssistantConfig();
  const envApiKey = cleanString(process.env.OPENAI_API_KEY);
  const envModel = cleanString(process.env.OPENAI_ASSISTANT_MODEL);
  const fileApiKey = cleanString(localConfig.apiKey);
  const fileModel = cleanString(localConfig.model);

  const apiKey = envApiKey || fileApiKey;

  const model = envModel || fileModel || DEFAULT_ASSISTANT_MODEL;

  return {
    apiKey,
    model,
    configured: Boolean(apiKey),
    source: envApiKey || envModel ? 'env' : 'local-file',
  };
}
