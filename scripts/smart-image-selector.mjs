#!/usr/bin/env node

/**
 * Smart Image Selector
 * Ensures images actually match the blog topic
 */

export class SmartImageSelector {
  constructor() {
    // Topic-specific image mappings
    this.topicImageMap = {
      warrior: ['warrior', 'soldier', 'samurai', 'viking', 'spartan', 'military'],
      menstrual: ['woman sleeping', 'female health', 'wellness woman', 'feminine rest'],
      menopause: ['mature woman', 'middle age wellness', 'woman peaceful'],
      firefighter: ['firefighter', 'fire station', 'emergency responder', 'first responder'],
      military: ['military sleeping', 'soldier rest', 'barracks', 'field camp'],
      nurse: ['nurse', 'hospital', 'healthcare worker', 'medical professional'],
      pregnancy: ['pregnant woman', 'maternity', 'expecting mother', 'pregnancy wellness'],
      cold: ['ice bath', 'cold therapy', 'winter swimming', 'cold exposure'],
      breathing: ['meditation', 'yoga breathing', 'pranayama', 'mindful breathing'],
      supplement: ['pills vitamins', 'supplements', 'medicine bottles', 'natural remedies'],
      forest: ['forest bathing', 'nature therapy', 'woods peaceful', 'shinrin yoku'],
      danish: ['hygge', 'cozy bedroom', 'scandinavian interior', 'candles comfort'],
      japanese: ['japanese bedroom', 'tatami', 'minimalist zen', 'japanese interior'],
      altitude: ['mountain sleeping', 'high altitude', 'mountain hut', 'alpine rest'],
      shift: ['night shift', 'night worker', 'industrial night', '24 hour workplace'],
      baby: ['baby sleeping', 'infant rest', 'nursery', 'newborn peaceful'],
      adhd: ['busy mind', 'racing thoughts', 'mental chaos', 'overwhelmed person'],
      trauma: ['healing', 'recovery', 'therapy session', 'emotional support'],
      technology: ['sleep tracker', 'smart watch sleep', 'sleep app', 'bedroom technology'],
      noise: ['white noise', 'sound machine', 'quiet bedroom', 'noise cancelling'],
      weight: ['weighted blanket', 'pressure therapy', 'cozy heavy blanket'],
      acupressure: ['acupressure points', 'pressure point therapy', 'hand massage', 'reflexology'],
      magnesium: ['magnesium supplement', 'mineral supplement', 'natural sleep aid'],
      chronotype: ['night owl', 'early bird', 'circadian rhythm', 'body clock'],
      dreams: ['dreaming', 'surreal sleep', 'dream catcher', 'lucid dream'],
      temperature: ['bedroom temperature', 'cooling mattress', 'sleep temperature', 'thermostat'],
      hormones: ['endocrine system', 'hormone balance', 'biological clock', 'circadian biology'],
      meditation: ['meditation pose', 'mindfulness', 'zen meditation', 'calm mind'],
      polyphasic: ['multiple naps', 'biphasic sleep', 'siesta', 'power nap'],
      anxiety: ['anxious person', 'worry insomnia', 'racing mind night', 'stress relief'],
      recovery: ['athlete recovery', 'muscle recovery', 'sports recovery', 'rest day']
    };

    // Fallback generic sleep images if no specific match
    this.fallbackTerms = [
      'peaceful bedroom',
      'sleep wellness',
      'rest recovery',
      'night rest',
      'healthy sleep'
    ];
  }

  /**
   * Extract key concepts from title to find relevant images
   */
  getImageSearchTerms(title, topic) {
    const terms = [];
    const titleLower = title.toLowerCase();
    const topicLower = (topic || '').toLowerCase();

    // Check each mapping for matches
    for (const [key, searches] of Object.entries(this.topicImageMap)) {
      if (titleLower.includes(key) || topicLower.includes(key)) {
        // Add the most specific search term
        terms.push(searches[0]);
        // Also add a variation
        if (searches.length > 1) {
          terms.push(searches[1]);
        }
      }
    }

    // Extract specific concepts from title
    if (titleLower.includes('warrior')) {
      terms.push('warrior meditation', 'samurai rest');
    }
    if (titleLower.includes('military')) {
      terms.push('soldier sleeping', 'military barracks');
    }
    if (titleLower.includes('2-minute')) {
      terms.push('quick sleep technique', 'military technique');
    }
    if (titleLower.includes('box breathing')) {
      terms.push('box breathing technique', 'square breathing');
    }
    if (titleLower.includes('4-7-8')) {
      terms.push('breathing exercise', 'pranayama technique');
    }
    if (titleLower.includes('menstrual') || titleLower.includes('period')) {
      terms.push('woman resting', 'feminine wellness');
    }
    if (titleLower.includes('pregnancy') || titleLower.includes('pregnant')) {
      terms.push('pregnancy rest', 'maternity sleep');
    }
    if (titleLower.includes('menopause')) {
      terms.push('midlife wellness', 'mature woman rest');
    }
    if (titleLower.includes('danish') || titleLower.includes('hygge')) {
      terms.push('hygge cozy', 'danish comfort');
    }
    if (titleLower.includes('japanese') || titleLower.includes('forest bathing')) {
      terms.push('shinrin yoku', 'japanese nature');
    }
    if (titleLower.includes('firefighter') || titleLower.includes('first responder')) {
      terms.push('firefighter rest', 'emergency responder');
    }
    if (titleLower.includes('nurse') || titleLower.includes('icu')) {
      terms.push('nurse break', 'hospital rest room');
    }
    if (titleLower.includes('shift work')) {
      terms.push('night shift worker', 'graveyard shift');
    }
    if (titleLower.includes('altitude') || titleLower.includes('mountain')) {
      terms.push('mountain cabin', 'high altitude rest');
    }
    if (titleLower.includes('cold') || titleLower.includes('temperature')) {
      terms.push('cold therapy', 'temperature control');
    }
    if (titleLower.includes('weighted blanket')) {
      terms.push('weighted blanket cozy', 'pressure therapy blanket');
    }

    // If no specific matches, use intelligent fallbacks based on category
    if (terms.length === 0) {
      if (titleLower.includes('science') || titleLower.includes('study')) {
        terms.push('sleep research', 'sleep science lab');
      } else if (titleLower.includes('tool') || titleLower.includes('technique')) {
        terms.push('sleep technique', 'sleep method');
      } else if (titleLower.includes('special') || titleLower.includes('condition')) {
        terms.push('sleep health', 'sleep wellness');
      } else {
        // Use generic fallbacks
        terms.push(...this.fallbackTerms.slice(0, 2));
      }
    }

    // Ensure we have at least 3 search variations
    while (terms.length < 3) {
      terms.push(this.fallbackTerms[terms.length]);
    }

    // Remove duplicates and return
    return [...new Set(terms)].slice(0, 5);
  }

  /**
   * Score how well an image matches the topic
   */
  scoreImageRelevance(imageDescription, title, topic) {
    if (!imageDescription) return 0;

    let score = 0;
    const descLower = imageDescription.toLowerCase();
    const titleLower = title.toLowerCase();

    // Direct topic matches (highest score)
    const topicKeywords = this.extractTopicKeywords(title, topic);
    for (const keyword of topicKeywords) {
      if (descLower.includes(keyword.toLowerCase())) {
        score += 10;
      }
    }

    // Category matches (medium score)
    if (titleLower.includes('warrior') && descLower.includes('warrior')) score += 15;
    if (titleLower.includes('military') && descLower.includes('military')) score += 15;
    if (titleLower.includes('nurse') && descLower.includes('nurse')) score += 15;
    if (titleLower.includes('firefighter') && descLower.includes('fire')) score += 15;

    // Mood/atmosphere matches (lower score)
    if (descLower.includes('peaceful') || descLower.includes('calm')) score += 3;
    if (descLower.includes('rest') || descLower.includes('relax')) score += 3;

    // Penalize generic bedroom shots for specific topics
    if (descLower.includes('bedroom') && !titleLower.includes('bedroom')) {
      score -= 5;
    }

    return score;
  }

  extractTopicKeywords(title, topic) {
    const keywords = [];

    // Extract key nouns from title
    const importantWords = title.split(/\s+/).filter(word =>
      word.length > 4 &&
      !['about', 'through', 'without', 'during'].includes(word.toLowerCase())
    );

    keywords.push(...importantWords);

    // Add topic-specific keywords
    if (topic) {
      keywords.push(...topic.split(/\s+/).slice(0, 2));
    }

    return keywords;
  }

  /**
   * Generate enhanced search query for GPT image prompts
   */
  generateImagePrompt(title, topic) {
    const searches = this.getImageSearchTerms(title, topic);

    // Create a more specific prompt for image generation
    let prompt = `Blog cover image: ${searches[0]}`;

    // Add style guidance
    if (title.toLowerCase().includes('warrior')) {
      prompt += ', strong powerful aesthetic, dramatic lighting';
    } else if (title.toLowerCase().includes('science')) {
      prompt += ', clean modern scientific aesthetic';
    } else if (title.toLowerCase().includes('danish') || title.toLowerCase().includes('hygge')) {
      prompt += ', cozy warm Scandinavian aesthetic, soft lighting';
    } else if (title.toLowerCase().includes('japanese')) {
      prompt += ', minimalist zen aesthetic, natural elements';
    } else {
      prompt += ', professional wellness photography, calming atmosphere';
    }

    return {
      primary: searches[0],
      alternatives: searches.slice(1),
      fullPrompt: prompt,
      searchQueries: searches
    };
  }
}

// Export for use
export default SmartImageSelector;

// CLI test interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const selector = new SmartImageSelector();

  const testTitles = [
    'Sleep Like a Warrior: Ancient Wisdom and Modern Practice',
    'Menstrual Cycle Effects on Sleep Architecture',
    'The Firefighter Paradox: Sleep Between Calls',
    'Military 2-Minute Sleep Technique from WWII',
    'Danish Hygge for Better Sleep',
    'Weighted Blankets: Pressure Therapy Explained'
  ];

  console.log('Smart Image Search Terms:\n');
  for (const title of testTitles) {
    const terms = selector.getImageSearchTerms(title);
    const prompt = selector.generateImagePrompt(title);
    console.log(`Title: ${title}`);
    console.log(`  Primary: ${prompt.primary}`);
    console.log(`  Search terms: ${terms.join(', ')}`);
    console.log(`  Full prompt: ${prompt.fullPrompt}\n`);
  }
}