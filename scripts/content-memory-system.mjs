#!/usr/bin/env node

/**
 * Content Memory System
 * Tracks all published content to prevent repetition.
 * Learns from what's been posted and ensures continuous novelty.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ContentMemory {
  constructor() {
    this.memoryPath = path.join(__dirname, '..', '.content-memory.json');
    this.memory = this.loadMemory();
  }

  loadMemory() {
    if (fs.existsSync(this.memoryPath)) {
      const raw = JSON.parse(fs.readFileSync(this.memoryPath, 'utf8'));
      // Convert phrases array back to Set (JSON serializes Set as array)
      raw.phrases = new Set(raw.phrases || []);
      return raw;
    }

    return {
      version: '2.0',
      posts: [],
      images: [],
      topics: [],
      phrases: new Set(),
      titlePatterns: [],
      contentThemes: [],
      lastUpdated: new Date().toISOString()
    };
  }

  saveMemory() {
    const memoryToSave = {
      ...this.memory,
      phrases: Array.from(this.memory.phrases || [])
    };
    fs.writeFileSync(this.memoryPath, JSON.stringify(memoryToSave, null, 2));
  }

  /** Record a published post to prevent future duplication */
  recordPost(postData) {
    const postRecord = {
      id: crypto.randomBytes(8).toString('hex'),
      date: postData.date || new Date().toISOString(),
      title: postData.title,
      titleFingerprint: this.createTitleFingerprint(postData.title),
      excerpt: postData.excerpt,
      keywords: this.extractKeywords(postData.title + ' ' + (postData.excerpt || '')),
      imageId: postData.imageId,
      imageHash: postData.imageHash,
      imageSearchTerms: postData.imageSearchTerms,
      contentThemes: this.extractThemes(postData.content || ''),
      wordCount: postData.content ? postData.content.split(/\s+/).length : 0
    };

    this.memory.posts.push(postRecord);

    if (postData.imageId) {
      this.memory.images.push({
        id: postData.imageId,
        hash: postData.imageHash,
        url: postData.imageUrl,
        usedIn: postRecord.id,
        date: postRecord.date
      });
    }

    if (postData.topic) {
      this.memory.topics.push({
        topic: postData.topic,
        usedIn: postRecord.id,
        date: postRecord.date
      });
    }

    // Track unique phrases (3+ words)
    const phrases = this.extractPhrases(postData.title);
    if (!(this.memory.phrases instanceof Set)) {
      this.memory.phrases = new Set(this.memory.phrases || []);
    }
    phrases.forEach(phrase => this.memory.phrases.add(phrase));

    // Track title pattern
    const pattern = this.extractTitlePattern(postData.title);
    this.memory.titlePatterns.push({
      pattern,
      example: postData.title,
      date: postRecord.date
    });

    this.memory.lastUpdated = new Date().toISOString();
    this.saveMemory();
    return postRecord.id;
  }

  createTitleFingerprint(title) {
    const normalized = title.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .sort()
      .join(' ');
    return crypto.createHash('sha256').update(normalized).digest('hex').substr(0, 16);
  }

  extractKeywords(text) {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
      'how', 'what', 'when', 'where', 'why', 'you', 'your', 'can', 'will',
      'just', 'should', 'now', 'use', 'need', 'know', 'get', 'make', 'see'
    ]);

    return text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 3 && !stopWords.has(word))
      .reduce((acc, word) => {
        acc[word] = (acc[word] || 0) + 1;
        return acc;
      }, {});
  }

  extractPhrases(text, minWords = 3, maxWords = 5) {
    const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
    const phrases = new Set();

    for (let len = minWords; len <= Math.min(maxWords, words.length); len++) {
      for (let i = 0; i <= words.length - len; i++) {
        const phrase = words.slice(i, i + len).join(' ');
        if (phrase.split(' ').some(w => w.length > 3)) {
          phrases.add(phrase);
        }
      }
    }
    return Array.from(phrases);
  }

  extractTitlePattern(title) {
    let pattern = title;
    pattern = pattern.replace(/\b\d+\b/g, '[NUMBER]');
    pattern = pattern.replace(/\b(shift worker|workers?|people|humans?)\b/gi, '[AUDIENCE]');
    pattern = pattern.replace(/\b(sleep|rest|nap)\b/gi, '[SLEEP]');
    pattern = pattern.replace(/\b(night|day|morning|evening|afternoon)\b/gi, '[TIME]');

    if (pattern.includes(':')) pattern = '[MAIN]: [SUBTITLE]';
    else if (pattern.includes('?')) pattern = '[QUESTION]';
    else if (/^(how|why|what|when|where)/i.test(pattern)) pattern = '[QUESTION_WORD] [TOPIC]';
    else if (/^(the|a)\s/i.test(pattern)) pattern = '[ARTICLE] [TOPIC]';

    return pattern;
  }

  extractThemes(content) {
    const themes = {
      scientific: ['study', 'research', 'evidence', 'data', 'experiment', 'finding'],
      practical: ['tip', 'strategy', 'technique', 'method', 'approach', 'tactic'],
      medical: ['health', 'disease', 'condition', 'symptom', 'treatment', 'therapy'],
      lifestyle: ['habit', 'routine', 'lifestyle', 'behavior', 'practice', 'pattern'],
      warning: ['risk', 'danger', 'avoid', 'problem', 'issue', 'concern']
    };

    const contentLower = content.toLowerCase();
    const detectedThemes = [];

    for (const [theme, keywords] of Object.entries(themes)) {
      const count = keywords.filter(keyword => contentLower.includes(keyword)).length;
      if (count > 0) detectedThemes.push({ theme, strength: count });
    }

    return detectedThemes.sort((a, b) => b.strength - a.strength);
  }

  /** Check if a proposed title is too similar to existing content */
  checkTitleNovelty(proposedTitle) {
    const fingerprint = this.createTitleFingerprint(proposedTitle);
    const keywords = this.extractKeywords(proposedTitle);
    const phrases = this.extractPhrases(proposedTitle);
    const pattern = this.extractTitlePattern(proposedTitle);
    const issues = [];

    if (this.memory.posts.some(p => p.titleFingerprint === fingerprint)) {
      issues.push({ severity: 'critical', type: 'exact_duplicate', message: 'This exact title concept already exists' });
    }

    const existingPhrases = this.memory.phrases instanceof Set ? this.memory.phrases : new Set(this.memory.phrases || []);
    const repeatedPhrases = phrases.filter(p => existingPhrases.has(p));
    if (repeatedPhrases.length > 0) {
      issues.push({ severity: 'high', type: 'phrase_repetition', message: `Repeated phrases: ${repeatedPhrases.join(', ')}`, phrases: repeatedPhrases });
    }

    const keywordSaturation = this.calculateKeywordSaturation(keywords);
    if (keywordSaturation > 0.7) {
      issues.push({ severity: 'medium', type: 'keyword_saturation', message: 'Too many repeated keywords', saturation: Math.round(keywordSaturation * 100) });
    }

    const recentPatterns = this.memory.titlePatterns.slice(-10).map(p => p.pattern);
    if (recentPatterns.filter(p => p === pattern).length >= 2) {
      issues.push({ severity: 'medium', type: 'pattern_repetition', message: 'This title structure used too recently', pattern });
    }

    return {
      novel: issues.length === 0,
      issues,
      noveltyScore: this.calculateNoveltyScore(proposedTitle)
    };
  }

  calculateKeywordSaturation(keywords) {
    let totalKeywords = 0;
    let repeatedKeywords = 0;

    for (const [keyword, count] of Object.entries(keywords)) {
      totalKeywords += count;
      const occurrences = this.memory.posts.filter(p => p.keywords && p.keywords[keyword]).length;
      if (occurrences > 2) repeatedKeywords += count;
    }

    return totalKeywords > 0 ? repeatedKeywords / totalKeywords : 0;
  }

  calculateNoveltyScore(title) {
    let score = 100;
    const keywords = this.extractKeywords(title);
    const phrases = this.extractPhrases(title);
    const pattern = this.extractTitlePattern(title);

    score -= this.calculateKeywordSaturation(keywords) * 30;

    const existingPhrases = this.memory.phrases instanceof Set ? this.memory.phrases : new Set(this.memory.phrases || []);
    score -= phrases.filter(p => existingPhrases.has(p)).length * 10;

    const recentPatterns = this.memory.titlePatterns.slice(-10).map(p => p.pattern);
    score -= recentPatterns.filter(p => p === pattern).length * 15;

    const uniqueWords = Object.keys(keywords).filter(word =>
      !this.memory.posts.some(p => p.keywords && p.keywords[word])
    );
    score += Math.min(uniqueWords.length * 5, 20);

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  checkImageNovelty(imageId, imageHash) {
    const issues = [];
    if (this.memory.images.some(img => img.id === imageId)) {
      issues.push({ severity: 'critical', type: 'image_reuse', message: 'This exact image has been used before' });
    }
    if (imageHash && this.memory.images.some(img => img.hash === imageHash)) {
      issues.push({ severity: 'critical', type: 'image_duplicate', message: 'This image content has been used before' });
    }
    return { novel: issues.length === 0, issues };
  }

  getUnusedTopics(allTopics) {
    const recentTopics = this.memory.topics.slice(-20).map(t => t.topic);
    return allTopics.filter(topic => !recentTopics.includes(topic));
  }

  /** Scan existing blog posts and build memory */
  async rebuildMemoryFromExistingPosts() {
    console.log('Rebuilding memory from existing posts...');
    const postsDir = path.join(__dirname, '..', 'blog', 'posts');
    const posts = fs.readdirSync(postsDir).filter(f => f.endsWith('.html'));

    for (const postFile of posts) {
      const content = fs.readFileSync(path.join(postsDir, postFile), 'utf8');
      const titleMatch = content.match(/<h1[^>]*>([^<]+)<\/h1>/);
      const title = titleMatch ? titleMatch[1] : postFile;
      const dateMatch = postFile.match(/^(\d{4}-\d{2}-\d{2})/);
      const date = dateMatch ? dateMatch[1] : new Date().toISOString().split('T')[0];
      const excerptMatch = content.match(/<meta name="description" content="([^"]+)"/);
      const excerpt = excerptMatch ? excerptMatch[1] : '';

      this.recordPost({
        title,
        date,
        excerpt,
        content: content.replace(/<[^>]+>/g, ' '),
        imageId: postFile,
        topic: this.extractTopicFromTitle(title)
      });
    }

    console.log(`Rebuilt memory with ${posts.length} posts`);
  }

  extractTopicFromTitle(title) {
    return title.replace(/[:\-\u2013\u2014].*/g, '')
      .replace(/^\w+\s+(to|for|about|why|how|what|when)\s+/i, '')
      .trim();
  }
}

export default ContentMemory;

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const memory = new ContentMemory();
  const command = process.argv[2];

  switch (command) {
    case 'rebuild':
      memory.rebuildMemoryFromExistingPosts();
      break;
    case 'check-title': {
      const title = process.argv[3];
      if (!title) { console.error('Provide a title'); process.exit(1); }
      console.log(JSON.stringify(memory.checkTitleNovelty(title), null, 2));
      break;
    }
    case 'stats':
      console.log(`Memory Statistics:`);
      console.log(`  Posts tracked: ${memory.memory.posts.length}`);
      console.log(`  Images tracked: ${memory.memory.images.length}`);
      console.log(`  Topics used: ${memory.memory.topics.length}`);
      console.log(`  Unique phrases: ${memory.memory.phrases ? memory.memory.phrases.size || 0 : 0}`);
      console.log(`  Title patterns: ${memory.memory.titlePatterns.length}`);
      break;
    default:
      console.log('Commands: rebuild | check-title "Title" | stats');
  }
}
