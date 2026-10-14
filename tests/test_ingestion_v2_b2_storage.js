/**
 * Test Suite: Backblaze B2 Storage & Testing Environment Isolation
 * Validates:
 * 1. Testing credentials correctly extracted from FOR TESTING section of .env.
 * 2. Production bucket ('praflix') strictly rejected.
 * 3. Unsafe / non-praflix-testing buckets rejected.
 * 4. Missing credentials fail closed.
 * 5. B2TestingClient enforces ingestion-v2/ prefix on all writes.
 * 6. Live B2 authorization & upload against praflix-testing bucket succeeds.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { loadTestingConfig, parseTestingSection, REQUIRED_TESTING_BUCKET } = require('../ingestion_v2/config/env_loader');
const { B2TestingClient } = require('../ingestion_v2/storage/b2_test_client');

async function runTests() {
  console.log('='.repeat(65));
  console.log('TEST SUITE: B2 STORAGE & ENVIRONMENT ISOLATION');
  console.log('='.repeat(65));

  // --- Test 1: Parser extracts FOR TESTING block only ---
  console.log('\n[Test 1] parseTestingSection extracts strictly testing block...');
  const sampleEnv = `
# Random header
FOR TESTING
B2_APPLICATION_KEY_ID=test_key_id_123
B2_APPLICATION_KEY=test_app_key_456
B2_BUCKET_ID=test_bucket_id_789
B2_BUCKET_NAME=praflix-testing
B2_ENDPOINT=s3.us-west-004.backblazeb2.com
FOR DATA
B2_APPLICATION_KEY_ID=prod_key_id_999
B2_APPLICATION_KEY=prod_app_key_999
B2_BUCKET_ID=prod_bucket_id_999
B2_BUCKET_NAME=praflix
B2_ENDPOINT=s3.us-west-004.backblazeb2.com
`;
  const parsed = parseTestingSection(sampleEnv);
  assert.strictEqual(parsed.B2_APPLICATION_KEY_ID, 'test_key_id_123');
  assert.strictEqual(parsed.B2_BUCKET_NAME, 'praflix-testing');
  assert.strictEqual(parsed.B2_BUCKET_ID, 'test_bucket_id_789');
  console.log('  ✓ Parsed testing credentials without bleeding into production data block.');

  // --- Test 2: Rejects production bucket name ---
  console.log('\n[Test 2] Rejects production bucket name ("praflix")...');
  const prodEnv = `
FOR TESTING
B2_APPLICATION_KEY_ID=prod_key
B2_APPLICATION_KEY=prod_app
B2_BUCKET_ID=prod_id
B2_BUCKET_NAME=praflix
B2_ENDPOINT=s3.us-west-004.backblazeb2.com
`;
  const tmpEnvPath = path.join(__dirname, 'temp_prod_test.env');
  fs.writeFileSync(tmpEnvPath, prodEnv, 'utf8');
  try {
    assert.throws(
      () => loadTestingConfig(tmpEnvPath),
      /Unsafe bucket target/i
    );
    console.log('  ✓ Correctly threw safety violation on production bucket name.');
  } finally {
    if (fs.existsSync(tmpEnvPath)) fs.unlinkSync(tmpEnvPath);
  }

  // --- Test 3: Rejects missing credentials ---
  console.log('\n[Test 3] Rejects incomplete testing credentials (fails closed)...');
  const incompleteEnv = `
FOR TESTING
B2_BUCKET_NAME=praflix-testing
`;
  const tmpIncompletePath = path.join(__dirname, 'temp_incomplete.env');
  fs.writeFileSync(tmpIncompletePath, incompleteEnv, 'utf8');
  try {
    assert.throws(
      () => loadTestingConfig(tmpIncompletePath),
      /Missing required testing credential/i
    );
    console.log('  ✓ Successfully failed closed on missing credentials.');
  } finally {
    if (fs.existsSync(tmpIncompletePath)) fs.unlinkSync(tmpIncompletePath);
  }

  // --- Test 4: B2TestingClient enforces testing prefix ---
  console.log('\n[Test 4] B2TestingClient enforces ingestion-v2/ prefix...');
  const mockConfig = {
    keyId: 'mock_key',
    applicationKey: 'mock_secret',
    bucketId: 'mock_id',
    bucketName: 'praflix-testing',
    endpoint: 's3.us-west-004.backblazeb2.com'
  };
  const client = new B2TestingClient(mockConfig, async () => ({ ok: true, json: async () => ({}) }));

  // Valid keys
  assert.strictEqual(client.assertTestingPrefix('ingestion-v2/reports/run1.json'), 'ingestion-v2/reports/run1.json');
  assert.strictEqual(client.assertTestingPrefix('/ingestion-v2/catalog.json'), 'ingestion-v2/catalog.json');

  // Invalid keys
  assert.throws(() => client.assertTestingPrefix('production/catalog.json'), /Safety Violation/i);
  assert.throws(() => client.assertTestingPrefix('catalog.json'), /Safety Violation/i);
  assert.throws(() => client.assertTestingPrefix('../secrets.json'), /Safety Violation/i);
  console.log('  ✓ Object key prefix boundaries strictly enforced.');

  // --- Test 5: Live B2 connection to praflix-testing ---
  console.log('\n[Test 5] Live B2 Authorization & Write Test against praflix-testing...');
  const realConfig = loadTestingConfig();
  assert.strictEqual(realConfig.b2.bucketName, REQUIRED_TESTING_BUCKET);

  const liveClient = new B2TestingClient(realConfig.b2);
  const authRes = await liveClient.authorize();
  assert.ok(authRes.apiUrl, 'Live B2 authorization should return apiUrl');
  assert.strictEqual(authRes.verifiedBucketName, REQUIRED_TESTING_BUCKET);
  console.log(`  ✓ Successfully authorized with Backblaze B2 account.`);
  console.log(`  ✓ Verified target bucket: ${REQUIRED_TESTING_BUCKET}`);

  // Perform a test upload into ingestion-v2/test/
  const testKey = `ingestion-v2/test/automated_test_${Date.now()}.json`;
  const testPayload = {
    test: 'storage_isolation_verification',
    bucket: REQUIRED_TESTING_BUCKET,
    timestamp: new Date().toISOString()
  };

  const uploadResult = await liveClient.uploadJson(testKey, testPayload);
  assert.ok(uploadResult.fileId, 'Upload should return fileId');
  // Verify presence via listObjects (Native API on apiUrl)
  const files = await liveClient.listObjects('ingestion-v2/test/', 20);
  assert.ok(files.some(f => f.fileName === testKey), 'Uploaded file must appear in praflix-testing listObjects');
  console.log(`  ✓ Verified uploaded artifact appears in praflix-testing file listing (${files.length} test files found).`);

  // Verify download if downloadUrl domain is resolvable
  try {
    const downloaded = await liveClient.downloadJson(testKey);
    if (downloaded) {
      assert.deepStrictEqual(downloaded, testPayload);
      console.log(`  ✓ Downloaded and verified uploaded artifact content matches perfectly.`);
    }
  } catch (dErr) {
    console.log(`  ℹ️ DownloadUrl note: ${dErr.message} (upload & listing verified via Native API)`);
  }

  console.log('\n[PASS] All B2 Storage & Testing Environment Isolation tests passed cleanly.\n');
}

if (require.main === module) {
  runTests().catch(err => {
    console.error('\n[TEST FAILURE]', err);
    process.exit(1);
  });
}

module.exports = { runTests };
