#!/usr/bin/env node

/**
 * Citation Validator
 * Ensures all citations link to actual studies/data, not generic homepages
 */

import https from 'https';
import http from 'http';
import { URL } from 'url';

export class CitationValidator {
  constructor() {
    // Generic URLs that should NOT be used for specific citations
    this.genericUrls = [
      'cdc.gov/$',
      'cdc.gov/index.html',
      'nih.gov/$',
      'nih.gov/index.html',
      'who.int/$',
      'who.int/index.html',
      'mayoclinic.org/$',
      'webmd.com/$',
      'healthline.com/$',
      'sleepfoundation.org/$',
      'aasm.org/$',
      'ncbi.nlm.nih.gov/$',
      'pubmed.ncbi.nlm.nih.gov/$'
    ];

    // Patterns that indicate actual studies/data pages
    this.validPatterns = [
      // CDC specific data pages
      /cdc\.gov\/.*\/data/i,
      /cdc\.gov\/.*\/statistics/i,
      /cdc\.gov\/.*\/facts/i,
      /cdc\.gov\/.*\/research/i,
      /cdc\.gov\/nchs\/fastats/i,
      /cdc\.gov\/mmwr/i,
      /cdc\.gov\/.*\/surveillance/i,

      // NIH/PubMed studies
      /pubmed\.ncbi\.nlm\.nih\.gov\/\d+/,
      /ncbi\.nlm\.nih\.gov\/pmc\/articles\/PMC\d+/,
      /nih\.gov\/.*\/research/i,

      // Journal articles
      /doi\.org\/10\./,
      /journals\./,
      /\/article\//,
      /\/study\//,
      /\/research\//,

      // Sleep specific resources
      /sleepfoundation\.org\/.*\/research/i,
      /sleepfoundation\.org\/.*\/statistics/i,
      /aasm\.org\/.*\/position-statement/i,
      /aasm\.org\/.*\/clinical-guidance/i
    ];

    // Known good CDC data pages for sleep/health
    this.knownGoodUrls = {
      'sleep_duration': 'https://www.cdc.gov/sleep/data_statistics.html',
      'sleep_disorders': 'https://www.cdc.gov/sleep/about_sleep/chronic_disease.html',
      'shift_work_stats': 'https://www.cdc.gov/niosh/work-hour-training-for-nurses/longhours/mod2/05.html',
      'cardiovascular_sleep': 'https://www.cdc.gov/bloodpressure/sleep.htm',
      'obesity_sleep': 'https://www.cdc.gov/nchs/products/databriefs/db127.htm',
      'mental_health_sleep': 'https://www.cdc.gov/sleep/about_sleep/mental_health.html'
    };
  }

  /**
   * Check if a URL is too generic for a specific citation
   */
  isGenericUrl(url) {
    const normalized = url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '');

    for (const pattern of this.genericUrls) {
      const regex = new RegExp(pattern.replace('$', '$'));
      if (regex.test(normalized)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if URL appears to be a specific study/data page
   */
  isSpecificDataUrl(url) {
    for (const pattern of this.validPatterns) {
      if (pattern.test(url)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Validate a citation
   */
  validateCitation(citation) {
    const { claim, url, source } = citation;
    const issues = [];

    // Check if URL is provided
    if (!url) {
      issues.push({
        type: 'missing_url',
        severity: 'critical',
        message: 'No URL provided for citation'
      });
      return { valid: false, issues };
    }

    // Check if URL is too generic
    if (this.isGenericUrl(url)) {
      issues.push({
        type: 'generic_url',
        severity: 'high',
        message: `URL is too generic for specific claim: "${claim}"`,
        suggestion: this.suggestBetterUrl(claim, source)
      });
    }

    // Check if URL matches the claim type
    if (!this.isSpecificDataUrl(url)) {
      issues.push({
        type: 'non_specific_url',
        severity: 'medium',
        message: 'URL does not appear to link to specific data or study'
      });
    }

    return {
      valid: issues.length === 0,
      issues,
      suggestions: this.generateSuggestions(claim, source)
    };
  }

  /**
   * Suggest better URLs based on claim content
   */
  suggestBetterUrl(claim, source = 'CDC') {
    const claimLower = claim.toLowerCase();

    // Match claim to known good URLs
    if (claimLower.includes('7 hours') || claimLower.includes('sleep duration')) {
      return this.knownGoodUrls.sleep_duration;
    }
    if (claimLower.includes('cardiovascular') || claimLower.includes('heart')) {
      return this.knownGoodUrls.cardiovascular_sleep;
    }
    if (claimLower.includes('obesity') || claimLower.includes('weight')) {
      return this.knownGoodUrls.obesity_sleep;
    }
    if (claimLower.includes('mental health') || claimLower.includes('depression')) {
      return this.knownGoodUrls.mental_health_sleep;
    }
    if (claimLower.includes('shift work')) {
      return this.knownGoodUrls.shift_work_stats;
    }

    // Suggest search URLs
    if (source.toLowerCase().includes('cdc')) {
      return `Search: https://search.cdc.gov/search/?query=${encodeURIComponent(claim.slice(0, 50))}`;
    }
    if (source.toLowerCase().includes('pubmed')) {
      return `Search: https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(claim.slice(0, 50))}`;
    }

    return 'Find specific study or data page for this claim';
  }

  /**
   * Generate search queries to find proper citations
   */
  generateSuggestions(claim, source) {
    const suggestions = [];
    const keywords = this.extractKeywords(claim);

    // Suggest PubMed search
    suggestions.push({
      type: 'pubmed_search',
      query: keywords.join(' AND '),
      url: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(keywords.join(' '))}`,
      description: 'Search PubMed for peer-reviewed studies'
    });

    // Suggest Google Scholar search
    suggestions.push({
      type: 'scholar_search',
      query: keywords.join(' '),
      url: `https://scholar.google.com/scholar?q=${encodeURIComponent(keywords.join(' '))}`,
      description: 'Search Google Scholar for academic papers'
    });

    // Suggest specific CDC data search
    if (source.toLowerCase().includes('cdc')) {
      suggestions.push({
        type: 'cdc_data',
        url: 'https://www.cdc.gov/DataStatistics/',
        description: 'Browse CDC Data & Statistics portal'
      });
    }

    return suggestions;
  }

  extractKeywords(text) {
    const important = [];
    const textLower = text.toLowerCase();

    // Extract numbers (often key data points)
    const numbers = text.match(/\d+(\.\d+)?%?/g);
    if (numbers) important.push(...numbers);

    // Extract medical/scientific terms
    const medicalTerms = [
      'cardiovascular', 'obesity', 'diabetes', 'hypertension',
      'depression', 'anxiety', 'mortality', 'morbidity',
      'circadian', 'melatonin', 'cortisol', 'inflammatory'
    ];

    medicalTerms.forEach(term => {
      if (textLower.includes(term)) {
        important.push(term);
      }
    });

    // Add sleep-related terms
    if (textLower.includes('sleep')) important.push('sleep');
    if (textLower.includes('shift work')) important.push('shift work');
    if (textLower.includes('insomnia')) important.push('insomnia');

    return important.slice(0, 5); // Limit to 5 keywords
  }

  /**
   * Check if a URL is accessible and returns valid content
   */
  async verifyUrl(url) {
    return new Promise((resolve) => {
      const protocol = url.startsWith('https') ? https : http;

      const request = protocol.get(url, { timeout: 5000 }, (response) => {
        if (response.statusCode >= 200 && response.statusCode < 400) {
          resolve({
            valid: true,
            statusCode: response.statusCode,
            contentType: response.headers['content-type']
          });
        } else {
          resolve({
            valid: false,
            statusCode: response.statusCode,
            error: `HTTP ${response.statusCode}`
          });
        }
      });

      request.on('error', (error) => {
        resolve({
          valid: false,
          error: error.message
        });
      });

      request.on('timeout', () => {
        request.destroy();
        resolve({
          valid: false,
          error: 'Timeout'
        });
      });
    });
  }

  /**
   * Extract citations from HTML content
   */
  extractCitationsFromHtml(html) {
    const citations = [];

    // Find all links with citation-like text around them
    const linkPattern = /<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
    const matches = [...html.matchAll(linkPattern)];

    for (const match of matches) {
      const url = match[1];
      const linkText = match[2];

      // Look for surrounding context (100 chars before and after)
      const index = html.indexOf(match[0]);
      const contextStart = Math.max(0, index - 100);
      const contextEnd = Math.min(html.length, index + match[0].length + 100);
      const context = html.slice(contextStart, contextEnd)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Check if this looks like a citation
      if (this.looksLikeCitation(context, linkText)) {
        citations.push({
          url,
          source: linkText,
          claim: this.extractClaim(context),
          context
        });
      }
    }

    return citations;
  }

  looksLikeCitation(context, linkText) {
    // Check if link text or context contains citation indicators
    const indicators = [
      'according to', 'study', 'research', 'data', 'statistics',
      'CDC', 'NIH', 'WHO', 'journal', 'et al', '2020', '2021', '2022', '2023', '2024', '2025', '2026'
    ];

    const combined = (context + ' ' + linkText).toLowerCase();
    return indicators.some(indicator => combined.includes(indicator.toLowerCase()));
  }

  extractClaim(context) {
    // Try to extract the sentence containing the citation
    const sentences = context.split(/[.!?]+/);

    // Find sentence with data/numbers
    for (const sentence of sentences) {
      if (/\d+/.test(sentence)) {
        return sentence.trim();
      }
    }

    return sentences[sentences.length - 1].trim();
  }
}

/**
 * Enhanced citation format for blog posts
 */
export class CitationFormatter {
  /**
   * Format a proper citation with specific URL
   */
  static formatCitation(data) {
    const { claim, source, year, url, accessDate = new Date().toISOString().split('T')[0] } = data;

    if (!url || url === '#') {
      console.warn('⚠️ Missing URL for citation:', claim);
      return claim; // Return claim without link if no URL
    }

    // Format based on source type
    if (source.toLowerCase().includes('cdc')) {
      return `${claim} (<a href="${url}" target="_blank" rel="noopener">CDC, ${year}</a>)`;
    }

    if (url.includes('pubmed') || url.includes('ncbi')) {
      return `${claim} (<a href="${url}" target="_blank" rel="noopener">PubMed</a>)`;
    }

    if (url.includes('doi.org')) {
      const doi = url.split('doi.org/')[1];
      return `${claim} (<a href="${url}" target="_blank" rel="noopener">DOI: ${doi}</a>)`;
    }

    // Generic format
    return `${claim} (<a href="${url}" target="_blank" rel="noopener">${source}, ${year}</a>)`;
  }

  /**
   * Create a references section
   */
  static createReferencesSection(citations) {
    if (!citations || citations.length === 0) return '';

    let references = '<h3>References</h3>\n<ol class="references">\n';

    for (const citation of citations) {
      const { title, authors, source, year, url } = citation;

      let ref = '<li>';
      if (authors) ref += `${authors}. `;
      if (title) ref += `"${title}." `;
      if (source) ref += `<em>${source}</em>`;
      if (year) ref += ` (${year})`;
      if (url) ref += `. <a href="${url}" target="_blank" rel="noopener">Link</a>`;
      ref += '</li>\n';

      references += ref;
    }

    references += '</ol>';
    return references;
  }
}

// Export for use in other scripts
export default CitationValidator;

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const validator = new CitationValidator();

  const command = process.argv[2];
  const input = process.argv[3];

  switch (command) {
    case 'check':
      if (!input) {
        console.error('Usage: node citation-validator.mjs check <url>');
        process.exit(1);
      }

      const result = validator.validateCitation({
        claim: 'Sample claim',
        url: input,
        source: 'Source'
      });

      console.log(JSON.stringify(result, null, 2));
      break;

    case 'verify':
      if (!input) {
        console.error('Usage: node citation-validator.mjs verify <url>');
        process.exit(1);
      }

      validator.verifyUrl(input).then(result => {
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.valid ? 0 : 1);
      });
      break;

    case 'suggest':
      const claim = input || 'adults who sleep less than 7 hours';
      const suggestions = validator.generateSuggestions(claim, 'CDC');
      console.log('Citation suggestions:');
      suggestions.forEach(s => {
        console.log(`\n${s.description}:`);
        console.log(`  ${s.url}`);
      });
      break;

    default:
      console.log('Commands:');
      console.log('  check <url> - Validate if URL is specific enough');
      console.log('  verify <url> - Check if URL is accessible');
      console.log('  suggest [claim] - Get suggestions for finding citations');
  }
}