#!/usr/bin/env node
// Собирает app/www — то, что попадёт внутрь приложения для App Store.
//
// Источник ровно один: dist/ — та же сборка клиента, которую отдаёт живой
// сервер (src/backend/server.js, express.static(distDir)). Брать что-то ещё
// значит показать в сторе не то приложение, которое работает у людей.
//
// Почему не server.url на живой домен: Apple читает такую обёртку как обёртку
// вокруг сайта и отклоняет по правилу 4.2 «минимальная функциональность».
// Внутрь кладём файлы.
//
// Запуск: node scripts/build-app-www.mjs
import { cp, rm, mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(root, 'dist');
const WWW = join(root, 'app/www');

if (!existsSync(DIST)) {
  console.error('[app-www] нет dist/ — сначала `npm run build` в корне проекта');
  process.exit(1);
}

const indexPath = join(DIST, 'index.html');
if (!existsSync(indexPath)) {
  console.error('[app-www] в dist/ нет index.html — сборка клиента не доведена до конца');
  process.exit(1);
}

// Сверяем, что index.html ссылается на существующие файлы сборки. Без этой
// проверки в приложение уезжает белый экран, а видно это только на устройстве.
const html = await readFile(indexPath, 'utf8');
const refs = [...html.matchAll(/(?:src|href)="\/?(assets\/[^"]+)"/g)].map((m) => m[1]);
if (!refs.length) {
  console.error('[app-www] index.html не ссылается ни на один файл из assets/ — похоже, это не сборка');
  process.exit(1);
}
const missing = refs.filter((r) => !existsSync(join(DIST, r)));
if (missing.length) {
  console.error('[app-www] в dist/ не хватает файлов, на которые ссылается index.html:');
  missing.forEach((m) => console.error('   ' + m));
  process.exit(1);
}

await rm(WWW, { recursive: true, force: true });
await mkdir(WWW, { recursive: true });
await cp(DIST, WWW, { recursive: true });

// ═══════════════════════════════════════════════════════════════════════════
// Чистка от российского продавца. В App Store продавец — Yupland Digital
// Solutions, LLC, документы приложение открывает с сервера: /terms-en и
// /privacy-en. Русские /terms и /privacy написаны от ИП с крымским адресом —
// внутри .ipa их быть не должно: файл распаковывается кем угодно.
const RU_DOCS = ['privacy.html', 'terms.html'];
for (const doc of RU_DOCS) {
  const p = join(WWW, doc);
  if (existsSync(p)) { await rm(p); console.log(`[app-www] выброшен ${doc} — документ российского продавца`); }
}

// Слово «оферта» — название именно того договора. В сторе подпись ссылки берётся
// из consent.termsLinkIos, но строка остаётся в сборке клиента — чистим и её.
const OFFER = [
  [/Договор публичной оферты/g, 'Условия использования'],
  [/публичной офертой/g, 'условиями использования'],
  [/публичной оферты/g, 'условий использования'],
  [/[Оо]ферт(ами|ам|ах|ой|ы|е|у|а)/g, (m, end) => {
    const map = { ами: 'условиями', ам: 'условиям', ах: 'условиях', ой: 'условиями', ы: 'условий', е: 'условиях', у: 'условия', а: 'условия' };
    const word = map[end];
    return m[0] === 'О' ? word.charAt(0).toUpperCase() + word.slice(1) : word;
  }],
  [/Public Offer/g, 'Terms of Use'],
];
const IE_TRACE = /Татауров|Tataurov|Tataurow|Севастопол|Sevastopol|920000802153|324920000019876|ОГРНИП|Лесхозная|[Оо]ферт|[Pp]ublic [Oo]ffer|(?:^|[^А-Яа-яЁё])ИП(?:[^А-Яа-яЁё]|$)/;
const TEXT = /\.(html|js|css|json|txt|svg|webmanifest)$/;

const traces = [];
async function sanitize(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) { await sanitize(p); continue; }
    if (!TEXT.test(entry.name)) continue;
    let text = await readFile(p, 'utf8');
    const before = text;
    for (const [from, to] of OFFER) text = text.replace(from, to);
    if (text !== before) await writeFile(p, text);
    text.split('\n').forEach((line, i) => {
      const hit = line.match(IE_TRACE);
      if (hit) traces.push(`  ${entry.name}:${i + 1} «${hit[0].trim()}» → ${line.trim().slice(0, 100)}`);
    });
  }
}
await sanitize(WWW);
if (traces.length) {
  console.error('[app-www] в сборке для стора остались следы российского продавца:\n' + traces.join('\n'));
  process.exit(1);
}

let bytes = 0;
let files = 0;
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) await walk(p);
    else { bytes += (await stat(p)).size; files++; }
  }
}
await walk(WWW);

console.log(`[app-www] собран из dist/: ${files} файлов, ${Math.round(bytes / 1024)} КБ`);
console.log(`[app-www] проверено ссылок на сборку: ${refs.length}`);
