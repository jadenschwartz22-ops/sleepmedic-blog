#!/usr/bin/env node

/**
 * Advanced Content Validator
 * Ensures uniqueness, quality, and relevance of blog posts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Semantic similarity checking with multiple algorithms
 */
export class SemanticValidator {
  constructor() {
    this.existingContent = this.loadExistingContent();
  }

  loadExistingContent() {
    const indexPath = path.join(__dirname, '..', 'blog', 'posts-index.json');
    if (!fs.existsSync(indexPath)) return [];

    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return index.map(post => ({
      title: post.title,
      date: post.date,
      excerpt: post.excerpt,
      tags: post.tags
    }));
  }

  /**
   * Calculate semantic fingerprint of title
   */
  getTitleFingerprint(title) {
    // Extract key concepts
    const concepts = this.extractConcepts(title);
    const structure = this.analyzeStructure(title);
    const theme = this.identifyTheme(title);

    return {
      concepts,
      structure,
      theme,
      wordCount: title.split(' ').length,
      hasColon: title.includes(':'),
      hasQuestion: title.includes('?'),
      startsWith: title.split(' ')[0].toLowerCase()
    };
  }

  extractConcepts(text) {
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during', 'how', 'what', 'when', 'where', 'why', 'you', 'your', 'can', 'use', 'need', 'know']);

    return text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(' ')
      .filter(word => word.length > 3 && !stopWords.has(word))
      .sort();
  }

  analyzeStructure(title) {
    const patterns = {
      howTo: /^how to/i,
      numberList: /^\d+\s+/,
      question: /\?$/,
      colonSplit: /:/,
      mythBusting: /myth/i,
      guide: /guide$/i,
      tips: /tips?$/i,
      versus: /\bvs\b|\bversus\b/i
    };

    const structure = [];
    for (const [name, pattern] of Object.entries(patterns)) {
      if (pattern.test(title)) {
        structure.push(name);
      }
    }
    return structure;
  }

  identifyTheme(title) {
    const themes = {
      science: ['study', 'research', 'evidence', 'science', 'data', 'proven'],
      practical: ['tips', 'guide', 'how', 'steps', 'tactics', 'strategies'],
      mythbusting: ['myth', 'truth', 'really', 'actually', 'fact'],
      warning: ['danger', 'risk', 'avoid', 'mistake', 'problem', 'effect'],
      comparison: ['versus', 'vs', 'better', 'best', 'compare'],
      time: ['night', 'morning', 'day', 'schedule', 'routine', 'habit']
    };

    const titleLower = title.toLowerCase();
    const detectedThemes = [];

    for (const [theme, keywords] of Object.entries(themes)) {
      if (keywords.some(keyword => titleLower.includes(keyword))) {
        detectedThemes.push(theme);
      }
    }

    return detectedThemes;
  }

  /**
   * Check if title is too similar to existing ones
   */
  validateTitle(proposedTitle) {
    const fingerprint = this.getTitleFingerprint(proposedTitle);
    const issues = [];

    for (const existing of this.existingContent) {
      const existingFingerprint = this.getTitleFingerprint(existing.title);

      // Check concept overlap
      const conceptOverlap = this.calculateOverlap(
        fingerprint.concepts,
        existingFingerprint.concepts
      );

      // Check structural similarity
      const structuralMatch = this.calculateOverlap(
        fingerprint.structure,
        existingFingerprint.structure
      );

      // Check theme overlap
      const themeMatch = this.calculateOverlap(
        fingerprint.theme,
        existingFingerprint.theme
      );

      // Calculate overall similarity
      const similarity = (conceptOverlap * 0.6) + (structuralMatch * 0.2) + (themeMatch * 0.2);

      if (similarity > 0.65) {
        issues.push({
          type: 'duplicate',
          similarity: Math.round(similarity * 100),
          existingTitle: existing.title,
          details: {
            conceptOverlap: Math.round(conceptOverlap * 100),
            structuralMatch: Math.round(structuralMatch * 100),
            themeMatch: Math.round(themeMatch * 100)
          }
        });
      }

      // Check for exact phrase matches
      if (this.hasExactPhraseMatch(proposedTitle, existing.title)) {
        issues.push({
          type: 'phrase_duplicate',
          existingTitle: existing.title,
          phrase: this.findMatchingPhrase(proposedTitle, existing.title)
        });
      }
    }

    // Check for repetitive patterns
    const recentTitles = this.existingContent.slice(-5).map(p => p.title);
    if (this.detectRepetitivePattern(proposedTitle, recentTitles)) {
      issues.push({
        type: 'repetitive_pattern',
        pattern: fingerprint.startsWith
      });
    }

    return {
      valid: issues.length === 0,
      issues,
      suggestions: this.generateSuggestions(fingerprint, issues)
    };
  }

  calculateOverlap(set1, set2) {
    if (set1.length === 0 || set2.length === 0) return 0;

    const intersection = set1.filter(item => set2.includes(item));
    const union = [...new Set([...set1, ...set2])];

    return intersection.length / union.length;
  }

  hasExactPhraseMatch(title1, title2, minPhraseLength = 4) {
    const words1 = title1.toLowerCase().split(' ');
    const words2 = title2.toLowerCase().split(' ');

    for (let len = minPhraseLength; len <= Math.min(words1.length, words2.length); len++) {
      for (let i = 0; i <= words1.length - len; i++) {
        const phrase1 = words1.slice(i, i + len).join(' ');
        if (title2.toLowerCase().includes(phrase1)) {
          return true;
        }
      }
    }
    return false;
  }

  findMatchingPhrase(title1, title2) {
    const words1 = title1.toLowerCase().split(' ');
    const words2 = title2.toLowerCase().split(' ');
    let longestMatch = '';

    for (let len = 3; len <= Math.min(words1.length, words2.length); len++) {
      for (let i = 0; i <= words1.length - len; i++) {
        const phrase = words1.slice(i, i + len).join(' ');
        if (title2.toLowerCase().includes(phrase) && phrase.length > longestMatch.length) {
          longestMatch = phrase;
        }
      }
    }
    return longestMatch;
  }

  detectRepetitivePattern(proposedTitle, recentTitles) {
    const firstWord = proposedTitle.split(' ')[0].toLowerCase();
    const recentFirstWords = recentTitles.map(t => t.split(' ')[0].toLowerCase());

    // Check if same starting word appears too often
    const frequency = recentFirstWords.filter(w => w === firstWord).length;
    return frequency >= 2; // Same start word in 2 of last 5 posts
  }

  generateSuggestions(fingerprint, issues) {
    const suggestions = [];

    if (issues.some(i => i.type === 'duplicate')) {
      suggestions.push('Try a different angle or perspective on the topic');
      suggestions.push('Use more specific or unique terminology');
      suggestions.push('Consider a different title structure (question, how-to, list)');
    }

    if (issues.some(i => i.type === 'repetitive_pattern')) {
      const alternativeStarts = [
        'Master', 'Transform', 'Optimize', 'Discover', 'Unlock',
        'The Science of', 'Why', 'When', 'Essential', 'Proven'
      ];
      suggestions.push(`Try starting with: ${alternativeStarts.join(', ')}`);
    }

    return suggestions;
  }
}

/**
 * Image validator and selector
 */
export class ImageValidator {
  constructor() {
    this.usedImageHashes = this.loadUsedImages();
  }

  loadUsedImages() {
    const historyPath = path.join(__dirname, '..', '.image-history.json');
    if (fs.existsSync(historyPath)) {
      return JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    }
    return [];
  }

  saveImageHistory(imageData) {
    const historyPath = path.join(__dirname, '..', '.image-history.json');
    this.usedImageHashes.push(imageData);
    // Keep only last 50 images
    if (this.usedImageHashes.length > 50) {
      this.usedImageHashes = this.usedImageHashes.slice(-50);
    }
    fs.writeFileSync(historyPath, JSON.stringify(this.usedImageHashes, null, 2));
  }

  /**
   * Generate smart search terms based on title and content
   */
  generateImageSearchTerms(title, topic) {
    const concepts = this.extractImageConcepts(title, topic);

    // Create multiple search variations
    const searches = [
      concepts.primary.join(' '),
      concepts.mood.join(' '),
      concepts.setting.join(' '),
      `${concepts.primary[0]} ${concepts.mood[0]}`,
      `${concepts.setting[0]} ${concepts.primary[1] || concepts.primary[0]}`
    ];

    // Remove duplicates and empty strings
    return [...new Set(searches.filter(s => s && s.trim()))];
  }

  extractImageConcepts(title, topic) {
    const titleLower = title.toLowerCase();
    const topicLower = topic.toLowerCase();

    const concepts = {
      primary: [],
      mood: [],
      setting: []
    };

    // Time-based concepts
    if (titleLower.includes('night') || titleLower.includes('nighttime')) {
      concepts.primary.push('night');
      concepts.setting.push('moon', 'stars');
    } else if (titleLower.includes('morning')) {
      concepts.primary.push('sunrise');
      concepts.setting.push('morning', 'dawn');
    }

    // Activity concepts
    if (titleLower.includes('sleep')) {
      concepts.primary.push('sleep', 'bedroom');
      concepts.mood.push('peaceful', 'rest');
    }
    if (titleLower.includes('schedule') || titleLower.includes('routine')) {
      concepts.primary.push('calendar', 'planner');
      concepts.setting.push('organized', 'desk');
    }
    if (titleLower.includes('habit')) {
      concepts.primary.push('routine', 'daily');
    }

    // Mood concepts
    if (titleLower.includes('chaos')) {
      concepts.mood.push('calm', 'organized');
    }
    if (titleLower.includes('protect')) {
      concepts.mood.push('safe', 'secure');
    }

    // Work concepts
    if (topicLower.includes('shift') || titleLower.includes('shift')) {
      concepts.primary.push('worker', 'night shift');
      concepts.setting.push('industrial', 'workplace');
    }

    // Default fallbacks
    if (concepts.primary.length === 0) {
      concepts.primary.push('sleep', 'rest');
    }
    if (concepts.mood.length === 0) {
      concepts.mood.push('peaceful', 'calm');
    }
    if (concepts.setting.length === 0) {
      concepts.setting.push('bedroom', 'night');
    }

    return concepts;
  }

  /**
   * Validate image URL and check it's not a duplicate
   */
  async validateImage(imageUrl, imageId) {
    // Check if we've used this image before
    if (this.usedImageHashes.some(img => img.id === imageId)) {
      return {
        valid: false,
        reason: 'Image already used in previous post'
      };
    }

    // Verify image is accessible
    const isAccessible = await this.checkImageAccessible(imageUrl);
    if (!isAccessible) {
      return {
        valid: false,
        reason: 'Image URL not accessible'
      };
    }

    return { valid: true };
  }

  checkImageAccessible(url) {
    return new Promise((resolve) => {
      https.get(url, (res) => {
        resolve(res.statusCode === 200);
      }).on('error', () => {
        resolve(false);
      });
    });
  }
}

/**
 * Main validation orchestrator
 */
export class ContentValidator {
  constructor() {
    this.semantic = new SemanticValidator();
    this.image = new ImageValidator();
  }

  /**
   * Validate complete blog post before publishing
   */
  async validatePost(postData) {
    const results = {
      valid: true,
      errors: [],
      warnings: [],
      suggestions: []
    };

    // Validate title
    const titleValidation = this.semantic.validateTitle(postData.title);
    if (!titleValidation.valid) {
      results.valid = false;
      results.errors.push(...titleValidation.issues.map(i => ({
        type: 'title',
        message: `Title too similar (${i.similarity}%) to: "${i.existingTitle}"`
      })));
      results.suggestions.push(...titleValidation.suggestions);
    }

    // Validate image
    if (postData.imageUrl) {
      const imageValidation = await this.image.validateImage(
        postData.imageUrl,
        postData.imageId
      );
      if (!imageValidation.valid) {
        results.valid = false;
        results.errors.push({
          type: 'image',
          message: imageValidation.reason
        });
      }
    }

    // Check content quality
    if (postData.content) {
      const qualityCheck = this.checkContentQuality(postData.content);
      if (qualityCheck.warnings.length > 0) {
        results.warnings.push(...qualityCheck.warnings);
      }
    }

    return results;
  }

  checkContentQuality(content) {
    const warnings = [];

    // Check for minimum length
    const wordCount = content.split(/\s+/).length;
    if (wordCount < 500) {
      warnings.push(`Content too short: ${wordCount} words (minimum 500)`);
    }

    // Check for excessive repetition
    const sentences = content.split(/[.!?]+/);
    const uniqueSentences = new Set(sentences.map(s => s.trim().toLowerCase()));
    if (uniqueSentences.size < sentences.length * 0.95) {
      warnings.push('Content contains repetitive sentences');
    }

    return { warnings };
  }

  /**
   * Generate alternative title if current one fails
   */
  generateAlternativeTitle(originalTitle, issues) {
    const alternatives = [];

    // Different title structures
    const structures = [
      (topic) => `The Hidden Truth About ${topic}`,
      (topic) => `Why ${topic} Matters More Than You Think`,
      (topic) => `Transform Your ${topic}: A Science-Based Approach`,
      (topic) => `${topic}: What Research Really Shows`,
      (topic) => `Master ${topic} with These Proven Strategies`,
      (topic) => `The Complete Guide to ${topic}`,
      (topic) => `${topic} Decoded: Essential Knowledge for Shift Workers`
    ];

    // Extract core topic from original title
    const coreTopic = this.extractCoreTopic(originalTitle);

    // Generate alternatives using different structures
    for (const structure of structures) {
      const alt = structure(coreTopic);
      const validation = this.semantic.validateTitle(alt);
      if (validation.valid) {
        alternatives.push(alt);
      }
      if (alternatives.length >= 3) break;
    }

    return alternatives;
  }

  extractCoreTopic(title) {
    // Remove common prefixes and suffixes
    let topic = title
      .replace(/^(How to|Why|When|What|The)\s+/i, '')
      .replace(/:\s*.*$/, '')
      .replace(/\s+(Guide|Tips|Strategies|Tactics)$/i, '');

    // Extract main concept
    const concepts = this.semantic.extractConcepts(topic);
    return concepts.slice(0, 2).join(' ') || 'Sleep Health';
  }
}

// Export for use in other scripts
export default ContentValidator;

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const validator = new ContentValidator();

  const command = process.argv[2];
  const input = process.argv[3];

  if (!command) {
    console.log('Usage: node advanced-content-validator.mjs <command> <input>');
    console.log('Commands:');
    console.log('  check-title "Title to check"');
    console.log('  suggest-image "Title of post"');
    console.log('  validate-post <path-to-post.json>');
    process.exit(1);
  }

  switch (command) {
    case 'check-title':
      const titleResult = validator.semantic.validateTitle(input);
      console.log(JSON.stringify(titleResult, null, 2));
      process.exit(titleResult.valid ? 0 : 1);
      break;

    case 'suggest-image':
      const terms = validator.image.generateImageSearchTerms(input, '');
      console.log('Suggested search terms:');
      terms.forEach(term => console.log(`  - ${term}`));
      break;

    case 'validate-post':
      const postData = JSON.parse(fs.readFileSync(input, 'utf8'));
      validator.validatePost(postData).then(result => {
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.valid ? 0 : 1);
      });
      break;
  }
}