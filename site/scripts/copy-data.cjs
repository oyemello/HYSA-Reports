#!/usr/bin/env node
const { mkdirSync, copyFileSync, readdirSync, statSync } = require('fs');
const { join } = require('path');

const sourceRoot = join(__dirname, '../../data');
const targetRoot = join(__dirname, '../dist/data');

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const stat = statSync(srcPath);
    if (stat.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

try {
  copyDir(sourceRoot, targetRoot);
  console.log(`[copy-data] Copied data artifacts from ${sourceRoot} to ${targetRoot}`);
} catch (error) {
  console.warn('[copy-data] Skipped copying data directory:', error.message);
}
