/**
 * PRAFLIX Ingestion Pipeline V2 — Backblaze B2 Testing Client
 * A PRAVERSE Company
 *
 * Safety & Isolation Guarantees:
 * 1. Strict Target Enforcement: Only allows writes to `praflix-testing`.
 * 2. Prefix Enforcement: All uploaded objects must begin with `ingestion-v2/`.
 * 3. Zero Destruction: No automated delete operations; preserves all staging runs.
 * 4. Zero Secrets Leakage: Authorization tokens and keys are never logged or exposed.
 * 5. Dependency-Free: Built with standard Node.js fetch and crypto.
 */

const crypto = require('crypto');
const { loadTestingConfig, REQUIRED_TESTING_BUCKET } = require('../config/env_loader');

class B2TestingClient {
  /**
   * @param {Object} [configOverride] - Optional injected testing config (for unit tests / mocks)
   * @param {Function} [fetchFn] - Custom fetch function for mocking
   */
  constructor(configOverride = null, fetchFn = global.fetch) {
    this.config = configOverride || loadTestingConfig().b2;
    this.fetch = fetchFn || global.fetch;

    // Hard safety assertions at instantiation
    if (!this.config.bucketName || this.config.bucketName.toLowerCase() !== REQUIRED_TESTING_BUCKET) {
      throw new Error(
        `[B2Client Fatal Violation] Refusing to instantiate client: bucket "${this.config.bucketName}" is NOT "${REQUIRED_TESTING_BUCKET}"!`
      );
    }

    if (this.config.bucketName.toLowerCase() === 'praflix') {
      throw new Error('[B2Client Fatal Violation] Production bucket "praflix" blocked in testing client!');
    }

    this.apiUrl = null;
    this.downloadUrl = null;
    this.authToken = null;
    this.tokenExpiresAt = 0;
    this.verifiedBucketId = null;
  }

  /**
   * Validates that an object key begins strictly with the allowed testing prefix
   * @param {string} key
   */
  assertTestingPrefix(key) {
    if (!key || typeof key !== 'string') {
      throw new Error('[B2Client Safety Violation] Object key must be a non-empty string.');
    }
    const normalizedKey = key.replace(/^\/+/, '');
    if (!normalizedKey.startsWith('ingestion-v2/')) {
      throw new Error(
        `[B2Client Safety Violation] Attempted write outside testing prefix: "${key}". Key MUST begin with "ingestion-v2/".`
      );
    }
    return normalizedKey;
  }

  /**
   * Authorize account with Backblaze B2 REST API
   * @returns {Promise<{ accountId: string, apiUrl: string }>}
   */
  async authorize() {
    // Reuse token if still valid (valid for 24h, refresh if older than 20h)
    if (this.authToken && Date.now() < this.tokenExpiresAt - 4 * 60 * 60 * 1000) {
      return { apiUrl: this.apiUrl, downloadUrl: this.downloadUrl };
    }

    const authHeader = 'Basic ' + Buffer.from(`${this.config.keyId}:${this.config.applicationKey}`).toString('base64');
    const authEndpoint = 'https://api.backblazeb2.com/b2api/v2/b2_authorize_account';

    const res = await this.fetch(authEndpoint, {
      method: 'GET',
      headers: {
        'Authorization': authHeader
      }
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`[B2Client Auth Failed] HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    this.apiUrl = data.apiUrl;
    this.downloadUrl = data.downloadUrl;
    this.authToken = data.authorizationToken;
    this.tokenExpiresAt = Date.now() + 24 * 60 * 60 * 1000;

    // Check allowed bucket permissions if scoped to an application key
    if (data.allowed && data.allowed.bucketName) {
      if (data.allowed.bucketName.toLowerCase() !== REQUIRED_TESTING_BUCKET) {
        throw new Error(
          `[B2Client Scope Error] Injected key is scoped to "${data.allowed.bucketName}", but testing requires "${REQUIRED_TESTING_BUCKET}".`
        );
      }
      this.verifiedBucketId = data.allowed.bucketId;
    } else {
      this.verifiedBucketId = this.config.bucketId;
    }

    return {
      accountId: data.accountId,
      apiUrl: this.apiUrl,
      verifiedBucketName: REQUIRED_TESTING_BUCKET
    };
  }

  /**
   * Gets an upload URL for the testing bucket
   * @private
   */
  async getUploadUrl() {
    await this.authorize();
    const bucketId = this.verifiedBucketId || this.config.bucketId;

    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
        }
        const res = await this.fetch(`${this.apiUrl}/b2api/v2/b2_get_upload_url`, {
          method: 'POST',
          headers: {
            'Authorization': this.authToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ bucketId }),
          signal: AbortSignal.timeout(15000)
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`[B2Client GetUploadUrl Failed] HTTP ${res.status}: ${errText.slice(0, 200)}`);
        }

        return await res.json();
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  /**
   * Uploads a JSON object into praflix-testing/ingestion-v2/...
   * @param {string} key - S3/B2 file path starting with 'ingestion-v2/'
   * @param {any} data - Object to serialize to JSON
   * @param {Record<string, string>} [customHeaders] - Additional metadata headers
   * @returns {Promise<{ fileId: string, fileName: string, contentLength: number }>}
   */
  async uploadJson(key, data, customHeaders = {}) {
    const verifiedKey = this.assertTestingPrefix(key);
    const jsonStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    const buffer = Buffer.from(jsonStr, 'utf8');
    const sha1 = crypto.createHash('sha1').update(buffer).digest('hex');

    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
        }
        const uploadInfo = await this.getUploadUrl();

        const headers = {
          'Authorization': uploadInfo.authorizationToken,
          'X-Bz-File-Name': encodeURIComponent(verifiedKey).replace(/%2F/g, '/'),
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': String(buffer.length),
          'X-Bz-Content-Sha1': sha1,
          ...customHeaders
        };

        const res = await this.fetch(uploadInfo.uploadUrl, {
          method: 'POST',
          headers: headers,
          body: buffer,
          signal: AbortSignal.timeout(20000)
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`[B2Client Upload Failed] HTTP ${res.status} for key "${verifiedKey}": ${errText.slice(0, 200)}`);
        }

        const result = await res.json();
        return {
          fileId: result.fileId,
          fileName: result.fileName,
          contentLength: result.contentLength,
          uploadTimestamp: result.uploadTimestamp || Date.now()
        };
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  /**
   * Downloads a JSON object by fileName
   * @param {string} key
   * @returns {Promise<any>}
   */
  async downloadJson(key) {
    const verifiedKey = this.assertTestingPrefix(key);
    await this.authorize();

    const url = `${this.downloadUrl}/file/${REQUIRED_TESTING_BUCKET}/${encodeURI(verifiedKey)}`;
    let lastErr = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        }
        const res = await this.fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': this.authToken
          }
        });

        if (!res.ok) {
          if (res.status === 404) {
            return null;
          }
          throw new Error(`[B2Client Download Failed] HTTP ${res.status} for key "${verifiedKey}"`);
        }

        return await res.json();
      } catch (err) {
        lastErr = err;
      }
    }

    throw lastErr;
  }

  /**
   * Lists objects under a prefix within ingestion-v2/
   * @param {string} prefix
   * @param {number} [maxFileCount=100]
   * @returns {Promise<Array<{ fileId: string, fileName: string, contentLength: number }>>}
   */
  async listObjects(prefix = 'ingestion-v2/', maxFileCount = 100) {
    this.assertTestingPrefix(prefix);
    await this.authorize();
    const bucketId = this.verifiedBucketId || this.config.bucketId;

    const res = await this.fetch(`${this.apiUrl}/b2api/v2/b2_list_file_names`, {
      method: 'POST',
      headers: {
        'Authorization': this.authToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        bucketId: bucketId,
        prefix: prefix,
        maxFileCount: Math.min(maxFileCount, 1000)
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`[B2Client List Failed] HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    return data.files || [];
  }
}

module.exports = {
  B2TestingClient
};
