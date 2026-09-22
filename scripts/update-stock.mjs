#!/usr/bin/env node
// Runs in the "Update stock from JTL-FFN" GitHub Action on a schedule.
// Pulls current warehouse stock from the JTL-Fulfillment Network Merchant API
// and writes it into products.json for the website to display.

import { readFile, writeFile } from 'node:fs/promises';

const { JTL_CLIENT_ID, JTL_CLIENT_SECRET, JTL_REFRESH_TOKEN } = process.env;
if (!JTL_CLIENT_ID || !JTL_CLIENT_SECRET || !JTL_REFRESH_TOKEN) {
  console.error('Missing JTL_CLIENT_ID / JTL_CLIENT_SECRET / JTL_REFRESH_TOKEN env vars.');
  process.exit(1);
}

// Map our internal product ids to the SKU ("jfsku") JTL-FFN uses for each article.
// Find these under fulfillment.jtl-software.com -> Artikel, or via scripts/list-stocks.mjs.
const SKU_MAP = {
  'p-warntafel': 'REPLACE_WITH_JFSKU',
  'p-scheinwerfer': 'REPLACE_WITH_JFSKU',
  'p-handpumpe': 'REPLACE_WITH_JFSKU',
  'p-druckluft': 'REPLACE_WITH_JFSKU',
  'p-oelspritze': 'REPLACE_WITH_JFSKU',
};

async function getAccessToken() {
  const basic = Buffer.from(`${JTL_CLIENT_ID}:${JTL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://oauth2.api.jtl-software.com/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: JTL_REFRESH_TOKEN,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Token refresh failed: ${JSON.stringify(body)}`);
  if (body.refresh_token && body.refresh_token !== JTL_REFRESH_TOKEN) {
    console.warn('⚠ JTL issued a NEW refresh_token. Update the JTL_REFRESH_TOKEN GitHub secret, or future runs will fail once the old one expires.');
    console.warn('New refresh_token:', body.refresh_token);
  }
  return body.access_token;
}

async function fetchStocks(accessToken) {
  const res = await fetch('https://ffn2.api.jtl-software.com/api/v1/merchant/stocks?$top=200', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Stocks fetch failed: ${JSON.stringify(body)}`);
  return body.items ?? [];
}

function availableUnits(item) {
  const total = item.stockLevel ?? 0;
  const reserved = item.stockLevelReserved ?? 0;
  const blocked = item.stockLevelBlocked ?? 0;
  return Math.max(0, Math.floor(total - reserved - blocked));
}

const accessToken = await getAccessToken();
const stocks = await fetchStocks(accessToken);
const byJfsku = new Map(stocks.map((item) => [item.jfsku, item]));

const productsPath = new URL('../products.json', import.meta.url);
const data = JSON.parse(await readFile(productsPath, 'utf8'));

let changed = false;
for (const [productId, jfsku] of Object.entries(SKU_MAP)) {
  if (jfsku === 'REPLACE_WITH_JFSKU') {
    console.warn(`⚠ Skipping ${productId}: no JTL SKU configured yet in SKU_MAP.`);
    continue;
  }
  const stockItem = byJfsku.get(jfsku);
  if (!stockItem) {
    console.warn(`⚠ No stock entry found for ${productId} (jfsku ${jfsku}).`);
    continue;
  }
  const stock = availableUnits(stockItem);
  if (data.products[productId] && data.products[productId].stock !== stock) {
    data.products[productId].stock = stock;
    changed = true;
  }
}

if (changed) {
  data.stockLastChecked = new Date().toISOString().slice(0, 10);
  await writeFile(productsPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log('products.json updated.');
} else {
  console.log('No stock changes.');
}
