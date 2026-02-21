import type { AppConfig } from '../../types.js';

export function getAuthHeaders(config: AppConfig): Record<string, string> {
  return {
    'X-API-Key': config.apiKey,
  };
}
