// SleepMedic A/B tag schema
// Every post gets classified against these dimensions so we can correlate
// style variables with engagement. Keep the enums tight — new values only
// when real data shows we need them.

export const SCHEMA = {
  energy: ['scientist', 'monk', 'warrior', 'princess', 'hybrid'],
  opening_vehicle: ['scene', 'claim', 'image', 'question', 'quote', 'data', 'confession', 'literary_ref'],
  closing_vehicle: ['question', 'imperative', 'reframe', 'quiet_stop', 'callback', 'self_aware', 'checklist'],
  length_bucket: ['flash', 'short', 'medium', 'long', 'epic'],  // <350, 350-600, 600-1000, 1000-1800, 1800+
  voice_intensity: ['0.5', '0.7', '1.0'],
  devices: [
    'anaphora', 'catalog', 'self_interrupt', 'braided_register',
    'extended_metaphor', 'literary_ref', 'first_person_scene',
    'list_structure', 'numbered_protocol', 'one_sentence_paragraph',
    'colon_reveal', 'em_dash_pivot'
  ],
  topic_cluster: [
    'circadian', 'hygiene', 'parenting', 'shift_work', 'philosophy',
    'biology', 'nutrition', 'environment', 'tech', 'supplements',
    'conditions', 'mental_health'
  ],
  hook_type: ['pain', 'curiosity', 'permission', 'challenge', 'mystery', 'validation'],
  cta_type: ['download', 'email', 'share', 'none'],
  format: ['Story-First', 'Science-First', 'Myth-Busting', 'Field Manual', 'Q&A', 'History/Philosophy Lens']
};

export const LENGTH_BUCKETS = [
  { name: 'flash',  max: 350 },
  { name: 'short',  max: 600 },
  { name: 'medium', max: 1000 },
  { name: 'long',   max: 1800 },
  { name: 'epic',   max: Infinity }
];

export function bucketForWordCount(n) {
  for (const b of LENGTH_BUCKETS) if (n < b.max) return b.name;
  return 'epic';
}

export function validate(tags) {
  const errors = [];
  for (const [key, value] of Object.entries(tags)) {
    if (!SCHEMA[key]) continue; // unknown keys ignored, not errored
    if (Array.isArray(value)) {
      for (const v of value) {
        if (!SCHEMA[key].includes(v)) errors.push(`${key}: invalid "${v}"`);
      }
    } else if (value != null && !SCHEMA[key].includes(String(value))) {
      errors.push(`${key}: invalid "${value}"`);
    }
  }
  return errors;
}

export const REQUIRED_FIELDS = [
  'energy', 'opening_vehicle', 'closing_vehicle',
  'length_bucket', 'voice_intensity', 'devices',
  'topic_cluster', 'hook_type'
];
