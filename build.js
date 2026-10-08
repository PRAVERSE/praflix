#!/usr/bin/env node
/**
 * PRAFLIX — A PRAVERSE Company
 * Production Build Script (Node.js) for Cloudflare Pages / Workers
 * 
 * Creates a strictly compliant `dist` directory with all assets < 25 MiB.
 */

const fs = require('fs');
const path = require('path');

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MiB
const MAX_FILE_COUNT = 20000;

const BASE_DIR = __dirname;
const DIST_DIR = path.join(BASE_DIR, 'dist');
const DATA_DIR = path.join(BASE_DIR, 'data');
const ASSETS_DIR = path.join(BASE_DIR, 'assets');
const POSTERS_SRC_DIR = path.join(ASSETS_DIR, 'posters');

function linkOrCopy(src, dst) {
  if (fs.existsSync(dst)) {
    const sStat = fs.statSync(src);
    const dStat = fs.statSync(dst);
    if (sStat.size === dStat.size) return;
    fs.unlinkSync(dst);
  }
  try {
    fs.linkSync(src, dst);
  } catch (err) {
    fs.copyFileSync(src, dst);
  }
}

function main() {
  console.log('='.repeat(70));
  console.log('PRAFLIX PRODUCTION BUILD (Node.js) FOR CLOUDFLARE PAGES / WORKERS');
  console.log('A PRAVERSE Company');
  console.log('='.repeat(70));
  const t0 = Date.now();

  const masterCatalogPath = path.join(DATA_DIR, 'catalog.json');
  if (!fs.existsSync(masterCatalogPath)) {
    throw new Error(`Master catalog not found at ${masterCatalogPath}`);
  }

  const masterRecords = JSON.parse(fs.readFileSync(masterCatalogPath, 'utf8'));
  const totalRecords = masterRecords.length;
  console.log(`[1/6] Validated master catalog: ${totalRecords.toLocaleString()} canonical records.`);

  const distAssetsDir = path.join(DIST_DIR, 'assets');
  const distPostersDir = path.join(distAssetsDir, 'posters');
  const distDataDir = path.join(DIST_DIR, 'data');

  fs.mkdirSync(distPostersDir, { recursive: true });
  fs.mkdirSync(distDataDir, { recursive: true });
  console.log(`[2/6] Prepared target output structure at: ${DIST_DIR}`);

  const runtimeFiles = ['index.html', 'styles.css', 'app.js'];
  for (const rf of runtimeFiles) {
    const src = path.join(BASE_DIR, rf);
    const dst = path.join(DIST_DIR, rf);
    fs.copyFileSync(src, dst);
  }
  console.log(`[3/6] Installed core frontend runtime assets (${runtimeFiles.length} files).`);

  console.log('[4/6] Partitioning catalog into Cloudflare-compliant static chunks (<25 MiB)...');
  const numChunks = 4;
  const chunkSize = Math.ceil(totalRecords / numChunks);
  const manifestChunks = [];
  const chunkMetadata = [];

  for (let i = 0; i < numChunks; i++) {
    const startIdx = i * chunkSize;
    const endIdx = Math.min(totalRecords, (i + 1) * chunkSize);
    const chunk = masterRecords.slice(startIdx, endIdx);
    const chunkNum = i + 1;

    const jsonFilename = `catalog-chunk-${chunkNum}.json`;
    const jsonPath = path.join(distDataDir, jsonFilename);
    const rootJsonPath = path.join(DATA_DIR, jsonFilename);
    const jsonStr = JSON.stringify(chunk);
    fs.writeFileSync(jsonPath, jsonStr, 'utf8');
    fs.writeFileSync(rootJsonPath, jsonStr, 'utf8');

    const jsFilename = `catalog_chunk_${chunkNum}.js`;
    const jsPath = path.join(distDataDir, jsFilename);
    const rootJsPath = path.join(DATA_DIR, jsFilename);
    const jsContent = `window.PRAFLIX_DATA = (window.PRAFLIX_DATA || []).concat(${jsonStr});\n`;
    fs.writeFileSync(jsPath, jsContent, 'utf8');
    fs.writeFileSync(rootJsPath, jsContent, 'utf8');

    const jsonSize = fs.statSync(jsonPath).size;
    const jsSize = fs.statSync(jsPath).size;

    manifestChunks.push(`data/${jsonFilename}`);
    chunkMetadata.push({
      chunk: chunkNum,
      recordCount: chunk.length,
      startCanonicalId: chunk[0] ? chunk[0].canonicalId : null,
      endCanonicalId: chunk[chunk.length - 1] ? chunk[chunk.length - 1].canonicalId : null,
      jsonFile: `data/${jsonFilename}`,
      jsFile: `data/${jsFilename}`,
      jsonSizeBytes: jsonSize,
      jsSizeBytes: jsSize
    });

    console.log(`  - ${jsonFilename}: ${(jsonSize / (1024 * 1024)).toFixed(2)} MiB (${chunk.length.toLocaleString()} records)`);
  }

  const manifestData = {
    catalog: 'PRAFLIX Master Cinema & Web Series Catalog',
    publisher: 'A PRAVERSE Company',
    version: '2026.10.02',
    totalRecords,
    chunkCount: numChunks,
    maxFileLimitBytes: MAX_FILE_BYTES,
    chunks: manifestChunks,
    chunkMetadata
  };
  const manifestStr = JSON.stringify(manifestData, null, 2);
  fs.writeFileSync(path.join(distDataDir, 'catalog-manifest.json'), manifestStr, 'utf8');
  fs.writeFileSync(path.join(DATA_DIR, 'catalog-manifest.json'), manifestStr, 'utf8');

  // Copy supplementary data files if present (poster index, valid IDs, downloads)
  const supplementaryFiles = ['poster-valid-ids.js', 'poster-index.json', 'downloads.json'];
  for (const sf of supplementaryFiles) {
    const src = path.join(DATA_DIR, sf);
    const dst = path.join(distDataDir, sf);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
    }
  }

  // Minified monolithic catalog.json (22.79 MiB, < 25 MiB)
  const minCatalogPath = path.join(distDataDir, 'catalog.json');
  fs.writeFileSync(minCatalogPath, JSON.stringify(masterRecords), 'utf8');
  console.log(`  - catalog.json: ${(fs.statSync(minCatalogPath).size / (1024 * 1024)).toFixed(2)} MiB (single minified file)`);

  console.log('[5/6] Syncing poster artwork library...');
  const posterFiles = fs.readdirSync(POSTERS_SRC_DIR);
  for (const pf of posterFiles) {
    const src = path.join(POSTERS_SRC_DIR, pf);
    const dst = path.join(distPostersDir, pf);
    linkOrCopy(src, dst);
  }
  console.log(`  Synced ${posterFiles.length.toLocaleString()} poster files into dist/assets/posters/`);

  console.log('[6/6] Configuring Cloudflare edge performance _headers (SPA handled via wrangler.jsonc)...');
  const distRedirectsPath = path.join(DIST_DIR, '_redirects');
  if (fs.existsSync(distRedirectsPath)) {
    fs.unlinkSync(distRedirectsPath);
  }
  const headers = `/assets/posters/*
  Cache-Control: public, max-age=31536000, immutable
/data/*
  Cache-Control: public, max-age=86400, stale-while-revalidate=604800
  Access-Control-Allow-Origin: *
`;
  fs.writeFileSync(path.join(DIST_DIR, '_headers'), headers, 'utf8');

  // Audit
  console.log('\n' + '='.repeat(70));
  console.log('CLOUDFLARE PAGES & WORKERS ASSET AUDIT');
  console.log('='.repeat(70));

  let totalFiles = 0;
  let totalBytes = 0;
  let largestFile = { name: '', size: 0 };
  const oversizedFiles = [];

  function scanDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const fullPath = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        scanDir(fullPath);
      } else {
        totalFiles++;
        const size = fs.statSync(fullPath).size;
        totalBytes += size;
        if (size > largestFile.size) {
          largestFile = { name: path.relative(DIST_DIR, fullPath).replace(/\\/g, '/'), size };
        }
        if (size > MAX_FILE_BYTES) {
          oversizedFiles.push({ name: path.relative(DIST_DIR, fullPath).replace(/\\/g, '/'), size });
        }
      }
    }
  }

  scanDir(DIST_DIR);

  console.log(`Total Output Files: ${totalFiles.toLocaleString()} / ${MAX_FILE_COUNT.toLocaleString()} limit`);
  console.log(`Total Output Size:  ${(totalBytes / (1024 * 1024)).toFixed(2)} MiB`);
  console.log(`Largest Asset:      ${largestFile.name} (${(largestFile.size / (1024 * 1024)).toFixed(2)} MiB)`);
  console.log(`Size Limit:         ${(MAX_FILE_BYTES / (1024 * 1024)).toFixed(2)} MiB per individual asset`);

  if (oversizedFiles.length > 0) {
    console.error('\n[CRITICAL FAILURE] Oversized assets detected:');
    oversizedFiles.forEach(f => console.error(`  - ${f.name}: ${(f.size / (1024 * 1024)).toFixed(2)} MiB`));
    process.exit(1);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log('\n' + '='.repeat(70));
  console.log(`BUILD SUCCEEDED in ${elapsed}s!`);
  console.log('Status: 100% READY FOR CLOUDFLARE DEPLOYMENT');
  console.log(`Output Directory: ${DIST_DIR}`);
  console.log(`Every asset <= ${(largestFile.size / (1024 * 1024)).toFixed(2)} MiB (well below 25 MiB limit).`);
  console.log('='.repeat(70));
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error('\n[ERROR] Build aborted:', e);
    process.exit(1);
  }
}

module.exports = { main };
