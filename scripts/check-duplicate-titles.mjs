#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Check if a proposed title is too similar to existing posts
 * Returns true if title is too similar (should be rejected)
 */
export function isTitleTooSimilar(proposedTitle, existingTitles) {
  const normalize = (title) => {
    return title.toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .replace(/\s+/g, ' ')     // Normalize spaces
      .trim()
      .split(' ')
      .filter(word => word.length > 3); // Only keep significant words
  };

  const proposedWords = new Set(normalize(proposedTitle));

  for (const existingTitle of existingTitles) {
    const existingWords = new Set(normalize(existingTitle));

    // Calculate Jaccard similarity (intersection / union)
    const intersection = new Set([...proposedWords].filter(x => existingWords.has(x)));
    const union = new Set([...proposedWords, ...existingWords]);

    const similarity = intersection.size / union.size;

    // If more than 70% similar, consider it a duplicate
    if (similarity > 0.7) {
      console.log(`⚠️  Title too similar to existing: "${existingTitle}"`);
      console.log(`   Similarity: ${(similarity * 100).toFixed(1)}%`);
      return true;
    }
  }

  return false;
}

/**
 * Get all existing post titles
 */
export function getExistingTitles() {
  const indexPath = path.join(__dirname, '..', 'blog', 'posts-index.json');

  if (!fs.existsSync(indexPath)) {
    console.warn('⚠️  posts-index.json not found');
    return [];
  }

  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  return index.map(post => post.title);
}

/**
 * Check if a title would be a duplicate
 */
export function checkForDuplicate(proposedTitle) {
  const existingTitles = getExistingTitles();

  if (isTitleTooSimilar(proposedTitle, existingTitles)) {
    return {
      isDuplicate: true,
      existingTitles: existingTitles
    };
  }

  return {
    isDuplicate: false,
    existingTitles: existingTitles
  };
}

// If run directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  const proposedTitle = process.argv[2];

  if (!proposedTitle) {
    console.error('Usage: node check-duplicate-titles.mjs "Proposed Title"');
    process.exit(1);
  }

  console.log(`\nChecking title: "${proposedTitle}"\n`);

  const result = checkForDuplicate(proposedTitle);

  if (result.isDuplicate) {
    console.log('❌ DUPLICATE: This title is too similar to an existing post');
    console.log('\nExisting titles:');
    result.existingTitles.forEach(title => console.log(`  - ${title}`));
    process.exit(1);
  } else {
    console.log('✅ UNIQUE: This title is sufficiently different');
    process.exit(0);
  }
}