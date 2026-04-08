#!/usr/bin/env node
/**
 * fetch-collection.mjs
 * --------------------
 * Pulls Sam's Discogs collection and writes it to records/collection.json,
 * downloading cover images to records/covers/{releaseId}.jpg along the way.
 *
 * Reads the Discogs token from the DISCOGS_TOKEN environment variable.
 * Never commit the token. In CI, it comes from a GitHub Actions secret.
 *
 * Usage (locally, from repo root):
 *   DISCOGS_TOKEN=your_token_here node records/fetch-collection.mjs
 *
 * Rate limits: Discogs allows 60 authenticated requests/minute. This script
 * sleeps 1.1s between requests to stay well under that.
 */

import { writeFile, mkdir, readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USERNAME = 'QforQ';
const TOKEN = process.env.DISCOGS_TOKEN;
const USER_AGENT = 'SamHoustonDotMe/1.0 +https://samhouston.me';
const PER_PAGE = 100;
const REQUEST_DELAY_MS = 1100;   // ~54 req/min, under the 60/min limit
const COVERS_DIR = path.join(__dirname, 'covers');
const OUTPUT_FILE = path.join(__dirname, 'collection.json');

if (!TOKEN) {
  console.error('ERROR: DISCOGS_TOKEN env var is not set.');
  console.error('Get a token at https://www.discogs.com/settings/developers');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function discogsFetch(url) {
  const res = await fetch(url, {
    headers: {
      'Authorization': `Discogs token=${TOKEN}`,
      'User-Agent': USER_AGENT,
      'Accept': 'application/json'
    }
  });
  if (!res.ok) {
    throw new Error(`Discogs API ${res.status} ${res.statusText} for ${url}`);
  }
  return res.json();
}

async function fetchAllReleases() {
  const all = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const url = `https://api.discogs.com/users/${USERNAME}/collection/folders/0/releases?per_page=${PER_PAGE}&page=${page}&sort=added&sort_order=desc`;
    console.log(`Fetching page ${page}${totalPages > 1 ? ` of ${totalPages}` : ''}...`);
    const data = await discogsFetch(url);
    totalPages = data.pagination.pages;
    all.push(...data.releases);
    page++;
    if (page <= totalPages) await sleep(REQUEST_DELAY_MS);
  }

  console.log(`Fetched ${all.length} releases across ${totalPages} page(s).`);
  return all;
}

async function fileExists(p) {
  try { await access(p, constants.F_OK); return true; }
  catch { return false; }
}

async function downloadCover(url, releaseId) {
  if (!url) return null;
  // Discogs thumbs are .jpeg/.jpg/.png — just save as .jpg, browsers don't care
  const ext = url.match(/\.(jpeg|jpg|png|gif)(\?|$)/i)?.[1]?.toLowerCase() || 'jpg';
  const filename = `${releaseId}.${ext === 'jpeg' ? 'jpg' : ext}`;
  const filepath = path.join(COVERS_DIR, filename);
  const relPath = `covers/${filename}`;

  // Skip if already downloaded — huge speedup on subsequent runs
  if (await fileExists(filepath)) return relPath;

  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) {
      console.warn(`  ! cover ${releaseId} returned ${res.status}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(filepath, buf);
    return relPath;
  } catch (e) {
    console.warn(`  ! cover ${releaseId} failed: ${e.message}`);
    return null;
  }
}

/**
 * Discogs releases come back with basic_information nested. Flatten into the
 * shape our frontend expects (matches sample-collection.json).
 */
function transformRelease(release, localCoverPath) {
  const bi = release.basic_information || {};
  return {
    id: release.id,
    artist: (bi.artists?.[0]?.name || 'Unknown Artist').replace(/\s*\(\d+\)$/, ''), // Discogs appends (2) etc. to disambiguate artists
    title: bi.title || 'Untitled',
    year: bi.year || 0,
    genre: bi.genres || [],
    style: bi.styles || [],
    format: bi.formats?.[0]?.name || 'Unknown',
    label: bi.labels?.[0]?.name?.replace(/\s*\(\d+\)$/, '') || 'Unknown',
    thumb: localCoverPath || bi.thumb || '',
    discogsUrl: `https://www.discogs.com/release/${release.id}`,
    dateAdded: release.date_added || ''
  };
}

async function main() {
  await mkdir(COVERS_DIR, { recursive: true });

  const releases = await fetchAllReleases();
  const collection = [];

  console.log(`Downloading cover art...`);
  let coverIdx = 0;
  for (const release of releases) {
    coverIdx++;
    const bi = release.basic_information || {};
    // Prefer cover_image (larger, 600px) over thumb (150px) for the record-of-the-week hero.
    const coverUrl = bi.cover_image || bi.thumb;
    const localPath = await downloadCover(coverUrl, release.id);
    collection.push(transformRelease(release, localPath));
    // Only sleep when we actually hit the network (i.e. the file didn't already exist)
    // downloadCover returns early for cached files, so this is cheap on reruns.
    if (coverIdx % 10 === 0) console.log(`  ${coverIdx}/${releases.length}`);
  }

  await writeFile(OUTPUT_FILE, JSON.stringify(collection, null, 2) + '\n');
  console.log(`\nWrote ${collection.length} records to ${path.relative(process.cwd(), OUTPUT_FILE)}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
