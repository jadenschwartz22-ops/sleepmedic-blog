#!/usr/bin/env node

/**
 * Content Memory System
 * Tracks all published content to prevent ANY form of repetition
 * Learns from what's been posted and ensures continuous novelty
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
      return JSON.parse(fs.readFileSync(this.memoryPath, 'utf8'));
    }

    // Initialize memory system
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
    // Convert Set to Array for JSON
    const memoryToSave = {
      ...this.memory,
      phrases: Array.from(this.memory.phrases || [])
    };
    fs.writeFileSync(this.memoryPath, JSON.stringify(memoryToSave, null, 2));
  }

  /**
   * Record a published post to prevent future duplication
   */
  recordPost(postData) {
    const postRecord = {
      id: crypto.randomBytes(8).toString('hex'),
      date: postData.date || new Date().toISOString(),
      title: postData.title,
      titleFingerprint: this.createTitleFingerprint(postData.title),
      excerpt: postData.excerpt,
      keywords: this.extractKeywords(postData.title + ' ' + postData.excerpt),
      imageId: postData.imageId,
      imageHash: postData.imageHash,
      imageSearchTerms: postData.imageSearchTerms,
      contentThemes: this.extractThemes(postData.content || ''),
      wordCount: postData.content ? postData.content.split(/\s+/).length : 0
    };

    // Add to memory
    this.memory.posts.push(postRecord);

    // Track image
    if (postData.imageId) {
      this.memory.images.push({
        id: postData.imageId,
        hash: postData.imageHash,
        url: postData.imageUrl,
        usedIn: postRecord.id,
        date: postRecord.date
      });
    }

    // Track topic
    if (postData.topic) {
      this.memory.topics.push({
        topic: postData.topic,
        usedIn: postRecord.id,
        date: postRecord.date
      });
    }

    // Track unique phrases (3+ words)
    const phrases = this.extractPhrases(postData.title);
    phrases.forEach(phrase => {
      if (!this.memory.phrases) this.memory.phrases = new Set();
      this.memory.phrases.add(phrase);
    });

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

  /**
   * Create a unique fingerprint for a title
   */
  createTitleFingerprint(title) {
    const normalized = title.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .sort()
      .join(' ');

    return crypto.createHash('sha256').update(normalized).digest('hex').substr(0, 16);
  }

  /**
   * Extract important keywords from text
   */
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

  /**
   * Extract multi-word phrases
   */
  extractPhrases(text, minWords = 3, maxWords = 5) {
    const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
    const phrases = new Set();

    for (let len = minWords; len <= Math.min(maxWords, words.length); len++) {
      for (let i = 0; i <= words.length - len; i++) {
        const phrase = words.slice(i, i + len).join(' ');
        if (phrase.split(' ').some(w => w.length > 3)) { // At least one significant word
          phrases.add(phrase);
        }
      }
    }

    return Array.from(phrases);
  }

  /**
   * Extract title pattern (structure)
   */
  extractTitlePattern(title) {
    let pattern = title;

    // Replace specific words with placeholders
    pattern = pattern.replace(/\b\d+\b/g, '[NUMBER]');
    pattern = pattern.replace(/\b(shift worker|workers?|people|humans?)\b/gi, '[AUDIENCE]');
    pattern = pattern.replace(/\b(sleep|rest|nap)\b/gi, '[SLEEP]');
    pattern = pattern.replace(/\b(night|day|morning|evening|afternoon)\b/gi, '[TIME]');

    // Identify structure markers
    if (pattern.includes(':')) pattern = '[MAIN]: [SUBTITLE]';
    else if (pattern.includes('?')) pattern = '[QUESTION]';
    else if (/^(how|why|what|when|where)/i.test(pattern)) pattern = '[QUESTION_WORD] [TOPIC]';
    else if (/^(the|a)\s/i.test(pattern)) pattern = '[ARTICLE] [TOPIC]';

    return pattern;
  }

  /**
   * Extract content themes
   */
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
      if (count > 0) {
        detectedThemes.push({ theme, strength: count });
      }
    }

    return detectedThemes.sort((a, b) => b.strength - a.strength);
  }

  /**
   * Check if a proposed title is too similar to existing content
   */
  checkTitleNovelty(proposedTitle) {
    const fingerprint = this.createTitleFingerprint(proposedTitle);
    const keywords = this.extractKeywords(proposedTitle);
    const phrases = this.extractPhrases(proposedTitle);
    const pattern = this.extractTitlePattern(proposedTitle);

    const issues = [];

    // Check for exact fingerprint match
    if (this.memory.posts.some(p => p.titleFingerprint === fingerprint)) {
      issues.push({
        severity: 'critical',
        type: 'exact_duplicate',
        message: 'This exact title concept already exists'
      });
    }

    // Check for phrase repetition
    const existingPhrases = new Set(this.memory.phrases || []);
    const repeatedPhrases = phrases.filter(p => existingPhrases.has(p));
    if (repeatedPhrases.length > 0) {
      issues.push({
        severity: 'high',
        type: 'phrase_repetition',
        message: `Repeated phrases: ${repeatedPhrases.join(', ')}`,
        phrases: repeatedPhrases
      });
    }

    // Check keyword saturation
    const keywordSaturation = this.calculateKeywordSaturation(keywords);
    if (keywordSaturation > 0.7) {
      issues.push({
        severity: 'medium',
        type: 'keyword_saturation',
        message: 'Too many repeated keywords from existing posts',
        saturation: Math.round(keywordSaturation * 100)
      });
    }

    // Check pattern repetition
    const recentPatterns = this.memory.titlePatterns.slice(-10).map(p => p.pattern);
    if (recentPatterns.filter(p => p === pattern).length >= 2) {
      issues.push({
        severity: 'medium',
        type: 'pattern_repetition',
        message: 'This title structure has been used too recently',
        pattern
      });
    }

    return {
      novel: issues.length === 0,
      issues,
      noveltyScore: this.calculateNoveltyScore(proposedTitle)
    };
  }

  /**
   * Calculate how saturated keywords are
   */
  calculateKeywordSaturation(keywords) {
    let totalKeywords = 0;
    let repeatedKeywords = 0;

    for (const [keyword, count] of Object.entries(keywords)) {
      totalKeywords += count;

      // Check how often this keyword appears in existing posts
      const occurrences = this.memory.posts.filter(p =>
        p.keywords && p.keywords[keyword]
      ).length;

      if (occurrences > 2) {
        repeatedKeywords += count;
      }
    }

    return totalKeywords > 0 ? repeatedKeywords / totalKeywords : 0;
  }

  /**
   * Calculate overall novelty score (0-100)
   */
  calculateNoveltyScore(title) {
    let score = 100;

    const keywords = this.extractKeywords(title);
    const phrases = this.extractPhrases(title);
    const pattern = this.extractTitlePattern(title);

    // Penalize keyword repetition
    const keywordSaturation = this.calculateKeywordSaturation(keywords);
    score -= keywordSaturation * 30;

    // Penalize phrase repetition
    const existingPhrases = new Set(this.memory.phrases || []);
    const repeatedPhrases = phrases.filter(p => existingPhrases.has(p));
    score -= repeatedPhrases.length * 10;

    // Penalize pattern repetition
    const recentPatterns = this.memory.titlePatterns.slice(-10).map(p => p.pattern);
    const patternCount = recentPatterns.filter(p => p === pattern).length;
    score -= patternCount * 15;

    // Bonus for unique words
    const uniqueWords = Object.keys(keywords).filter(word =>
      !this.memory.posts.some(p => p.keywords && p.keywords[word])
    );
    score += Math.min(uniqueWords.length * 5, 20);

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Check if an image has been used before
   */
  checkImageNovelty(imageId, imageHash) {
    const issues = [];

    // Check by ID
    if (this.memory.images.some(img => img.id === imageId)) {
      issues.push({
        severity: 'critical',
        type: 'image_reuse',
        message: 'This exact image has been used before'
      });
    }

    // Check by hash (if provided)
    if (imageHash && this.memory.images.some(img => img.hash === imageHash)) {
      issues.push({
        severity: 'critical',
        type: 'image_duplicate',
        message: 'This image content has been used before'
      });
    }

    return {
      novel: issues.length === 0,
      issues
    };
  }

  /**
   * Get topics that haven't been used recently
   */
  getUnusedTopics(allTopics) {
    const recentTopics = this.memory.topics.slice(-20).map(t => t.topic);
    return allTopics.filter(topic => !recentTopics.includes(topic));
  }

  /**
   * Get title suggestions that would be novel
   */
  generateNovelTitleSuggestions(baseTopic) {
    const suggestions = [];

    // Patterns we haven't used much
    const underusedPatterns = [
      'The Unexpected Connection Between [TOPIC] and [BENEFIT]',
      'Why [EXPERTS] Are Rethinking [TOPIC]',
      '[NUMBER] [TOPIC] Mistakes You\'re Making Without Realizing',
      'The [TIME] Guide to [TOPIC]: What Works Now',
      '[TOPIC]: Separating Ancient Wisdom from Modern Science',
      'Beyond [COMMON_APPROACH]: A New Look at [TOPIC]'
    ];

    // Words we haven't used much
    const freshWords = this.getFreshVocabulary();

    for (const pattern of underusedPatterns) {
      const title = this.fillPattern(pattern, baseTopic, freshWords);
      const novelty = this.checkTitleNovelty(title);

      if (novelty.noveltyScore > 70) {
        suggestions.push({
          title,
          noveltyScore: novelty.noveltyScore,
          pattern
        });
      }

      if (suggestions.length >= 5) break;
    }

    return suggestions.sort((a, b) => b.noveltyScore - a.noveltyScore);
  }

  /**
   * Get vocabulary that hasn't been overused
   */
  getFreshVocabulary() {
    const allWords = {};

    // Count word usage across all posts
    this.memory.posts.forEach(post => {
      if (post.keywords) {
        for (const [word, count] of Object.entries(post.keywords)) {
          allWords[word] = (allWords[word] || 0) + count;
        }
      }
    });

    // Find underused words
    const fresh = [];
    const vocab = [
      'transform', 'optimize', 'essential', 'critical', 'overlooked',
      'surprising', 'powerful', 'practical', 'evidence-based', 'proven',
      'breakthrough', 'innovative', 'comprehensive', 'strategic', 'fundamental'
    ];

    for (const word of vocab) {
      if (!allWords[word] || allWords[word] < 2) {
        fresh.push(word);
      }
    }

    return fresh;
  }

  fillPattern(pattern, topic, freshWords) {
    let filled = pattern;

    const replacements = {
      '[TOPIC]': topic,
      '[BENEFIT]': 'Better Recovery',
      '[EXPERTS]': 'Sleep Scientists',
      '[NUMBER]': Math.floor(Math.random() * 5) + 3,
      '[TIME]': '2026',
      '[COMMON_APPROACH]': 'Basic Tips',
      '[AUDIENCE]': 'Shift Workers'
    };

    for (const [placeholder, value] of Object.entries(replacements)) {
      filled = filled.replace(placeholder, value);
    }

    return filled;
  }

  /**
   * Scan existing blog posts and build memory
   */
  async rebuildMemoryFromExistingPosts() {
    console.log('🔄 Rebuilding memory from existing posts...');

    const postsDir = path.join(__dirname, '..', 'blog', 'posts');
    const posts = fs.readdirSync(postsDir).filter(f => f.endsWith('.html'));

    for (const postFile of posts) {
      const content = fs.readFileSync(path.join(postsDir, postFile), 'utf8');

      // Extract title
      const titleMatch = content.match(/<h1[^>]*>([^<]+)<\/h1>/);
      const title = titleMatch ? titleMatch[1] : postFile;

      // Extract date from filename
      const dateMatch = postFile.match(/^(\d{4}-\d{2}-\d{2})/);
      const date = dateMatch ? dateMatch[1] : new Date().toISOString().split('T')[0];

      // Extract excerpt
      const excerptMatch = content.match(/<meta name="description" content="([^"]+)"/);
      const excerpt = excerptMatch ? excerptMatch[1] : '';

      // Record to memory
      this.recordPost({
        title,
        date,
        excerpt,
        content: content.replace(/<[^>]+>/g, ' '), // Strip HTML
        imageId: postFile, // Use filename as pseudo-ID
        topic: this.extractTopicFromTitle(title)
      });
    }

    console.log(`✅ Rebuilt memory with ${posts.length} posts`);
  }

  extractTopicFromTitle(title) {
    // Simple topic extraction
    return title.replace(/[:\-–—].*/g, '')
      .replace(/^\w+\s+(to|for|about|why|how|what|when)\s+/i, '')
      .trim();
  }
}

// Export for use in other scripts
export default ContentMemory;

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const memory = new ContentMemory();

  const command = process.argv[2];

  switch (command) {
    case 'rebuild':
      memory.rebuildMemoryFromExistingPosts();
      break;

    case 'check-title':
      const title = process.argv[3];
      if (!title) {
        console.error('Please provide a title to check');
        process.exit(1);
      }
      const result = memory.checkTitleNovelty(title);
      console.log(JSON.stringify(result, null, 2));
      break;

    case 'suggest':
      const topic = process.argv[3] || 'sleep health';
      const suggestions = memory.generateNovelTitleSuggestions(topic);
      console.log('Novel title suggestions:');
      suggestions.forEach(s => {
        console.log(`  ${s.title} (novelty: ${s.noveltyScore})`);
      });
      break;

    case 'stats':
      console.log(`Memory Statistics:`);
      console.log(`  Posts tracked: ${memory.memory.posts.length}`);
      console.log(`  Images tracked: ${memory.memory.images.length}`);
      console.log(`  Topics used: ${memory.memory.topics.length}`);
      console.log(`  Unique phrases: ${memory.memory.phrases ? memory.memory.phrases.length : 0}`);
      console.log(`  Title patterns: ${memory.memory.titlePatterns.length}`);
      break;

    default:
      console.log('Commands:');
      console.log('  rebuild - Rebuild memory from existing posts');
      console.log('  check-title "Title" - Check if title is novel');
      console.log('  suggest [topic] - Get novel title suggestions');
      console.log('  stats - Show memory statistics');
  }
}