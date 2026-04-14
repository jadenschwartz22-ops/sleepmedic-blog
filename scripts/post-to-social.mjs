/**
 * Post new blog notification to Twitter/X.
 * Reads POST_TITLE, POST_FILENAME, POST_EXCERPT from env (set by workflow).
 */

import chalk from 'chalk';
import { TwitterApi } from 'twitter-api-v2';

const { TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET,
        POST_TITLE, POST_FILENAME, POST_EXCERPT } = process.env;

const missing = ['TWITTER_API_KEY', 'TWITTER_API_SECRET', 'TWITTER_ACCESS_TOKEN', 'TWITTER_ACCESS_SECRET']
  .filter(k => !process.env[k]);

if (missing.length) {
  console.log(chalk.yellow(`Skipping Twitter post -- missing: ${missing.join(', ')}`));
  process.exit(0);
}

if (!POST_FILENAME) {
  console.log(chalk.yellow('Skipping Twitter post -- POST_FILENAME not set'));
  process.exit(0);
}

const url = `https://sleepmedic.co/blog/posts/${POST_FILENAME}`;
const excerpt = POST_EXCERPT || POST_TITLE || 'New post on SleepMedic';
const tweet = `${excerpt}\n\n${url}`;

const client = new TwitterApi({
  appKey: TWITTER_API_KEY,
  appSecret: TWITTER_API_SECRET,
  accessToken: TWITTER_ACCESS_TOKEN,
  accessSecret: TWITTER_ACCESS_SECRET,
}).readWrite;

try {
  const { data } = await client.v2.tweet(tweet);
  console.log(chalk.green(`Tweet posted: https://x.com/i/status/${data.id}`));
} catch (err) {
  console.error(chalk.red(`Twitter post failed: ${err.message}`));
  process.exit(1);
}
