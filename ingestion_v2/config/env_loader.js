/**
 * PRAFLIX Ingestion Pipeline V2 — Dedicated Testing Environment Loader
 * A PRAVERSE Company
 *
 * Strict isolation rules:
 * - Reads ONLY the `FOR TESTING` section from `.env`.
 * - Validates that B2_BUCKET_NAME strictly equals 'praflix-testing' (case-insensitive).
 * - Verifies required credentials (B2_APPLICATION_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_ID, B2_ENDPOINT).
 * - Fails closed if production bucket ('praflix') or any inconsistent credentials are found.
 * - NEVER prints or logs secret credentials.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_ENV_PATH = path.resolve(__dirname, '../../.env');
const REQUIRED_TESTING_BUCKET = 'praflix-testing';

/**
 * Parses raw .env content and extracts only the 'FOR TESTING' section.
 * @param {string} content - Raw .env file string
 * @returns {Record<string, string>} Key-value map of testing configuration
 */
function parseTestingSection(content) {
  if (!content || typeof content !== 'string') {
    throw new Error('[EnvLoader Safety Violation] .env content is empty or invalid.');
  }

  const lines = content.split(/\r?\n/);
  let inTestingBlock = false;
  const config = {};

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Section delimiter detection
    if (/^#?\s*FOR\s+TESTING\b/i.test(trimmed) || /FOR\s+TESTING/i.test(trimmed)) {
      inTestingBlock = true;
      continue;
    }

    if (/^#?\s*FOR\s+(DATA|PRODUCTION|PROD)\b/i.test(trimmed) || /FOR\s+DATA/i.test(trimmed)) {
      inTestingBlock = false;
      continue;
    }

    if (inTestingBlock && trimmed && !trimmed.startsWith('#')) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        // Remove surrounding quotes if present
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (key) {
          config[key] = val;
        }
      }
    }
  }

  return config;
}

/**
 * Loads and validates testing configuration.
 * @param {string} [envFilePath] - Optional custom path for testing
 * @returns {Object} Validated testing configuration
 */
function loadTestingConfig(envFilePath = DEFAULT_ENV_PATH) {
  if (!fs.existsSync(envFilePath)) {
    throw new Error(`[EnvLoader Safety Violation] Configuration file not found at: ${envFilePath}`);
  }

  const content = fs.readFileSync(envFilePath, 'utf8');
  const rawConfig = parseTestingSection(content);

  // Validate presence of testing block
  if (Object.keys(rawConfig).length === 0) {
    throw new Error('[EnvLoader Safety Violation] No valid "FOR TESTING" block found in configuration.');
  }

  // 1. Bucket Name strict validation
  const bucketName = (rawConfig.B2_BUCKET_NAME || '').trim();
  if (!bucketName) {
    throw new Error('[EnvLoader Safety Violation] Missing B2_BUCKET_NAME in testing configuration.');
  }

  if (bucketName.toLowerCase() !== REQUIRED_TESTING_BUCKET) {
    throw new Error(
      `[EnvLoader Safety Violation] Unsafe bucket target: "${bucketName}". Expected strictly "${REQUIRED_TESTING_BUCKET}". Refusing execution to prevent production data corruption.`
    );
  }

  // 2. Reject explicit production names
  if (bucketName.toLowerCase() === 'praflix') {
    throw new Error('[EnvLoader Critical Violation] Production bucket "praflix" detected in testing context! Aborting.');
  }

  // 3. Required B2 credentials check
  const requiredKeys = ['B2_APPLICATION_KEY_ID', 'B2_APPLICATION_KEY', 'B2_BUCKET_ID', 'B2_ENDPOINT'];
  for (const key of requiredKeys) {
    if (!rawConfig[key] || !rawConfig[key].trim()) {
      throw new Error(`[EnvLoader Safety Violation] Missing required testing credential: ${key}`);
    }
  }

  // Telegram credentials (optional in testing, but preserved if present)
  // Read common telegram tokens from environment or .env if present
  let telegramBotToken = rawConfig.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
  let telegramChatId = rawConfig.TELEGRAM_CHAT_ID || rawConfig.TELEGRAM_CHANNEL_ID || process.env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHANNEL_ID || '';

  // Return strictly validated, sanitized configuration object
  return {
    environment: 'testing',
    b2: {
      keyId: rawConfig.B2_APPLICATION_KEY_ID.trim(),
      applicationKey: rawConfig.B2_APPLICATION_KEY.trim(),
      bucketId: rawConfig.B2_BUCKET_ID.trim(),
      bucketName: REQUIRED_TESTING_BUCKET,
      rawBucketName: bucketName,
      endpoint: rawConfig.B2_ENDPOINT.trim(),
      prefix: 'ingestion-v2/'
    },
    telegram: {
      botToken: telegramBotToken.trim(),
      chatId: telegramChatId.trim(),
      isConfigured: Boolean(telegramBotToken && telegramChatId)
    }
  };
}

module.exports = {
  loadTestingConfig,
  parseTestingSection,
  REQUIRED_TESTING_BUCKET
};
