import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;
const IMAGE_IDEA = process.env.IMAGE_IDEA || 'sleep health';

if (!UNSPLASH_ACCESS_KEY) {
  console.error('Error: UNSPLASH_ACCESS_KEY environment variable is required');
  process.exit(1);
}

function searchUnsplash(query, count = 5) {
  return new Promise((resolve, reject) => {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`;

    const options = {
      headers: {
        'Authorization': `Client-ID ${UNSPLASH_ACCESS_KEY}`
      }
    };

    https.get(url, options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.results) {
            resolve(parsed.results);
          } else {
            reject(new Error('No results found'));
          }
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function main() {
  console.log(`Searching Unsplash for: "${IMAGE_IDEA}"`);

  try {
    const images = await searchUnsplash(IMAGE_IDEA, 5);

    if (images.length === 0) {
      console.error('No images found for query');
      process.exit(1);
    }

    const imageOptions = images.map(img => ({
      id: img.id,
      description: img.description || img.alt_description || 'No description',
      urls: {
        full: img.urls.full,
        regular: img.urls.regular,
        small: img.urls.small,
        thumb: img.urls.thumb,
        download: img.links.download_location
      },
      user: {
        name: img.user.name,
        username: img.user.username,
        links: {
          html: img.user.links.html
        }
      },
      links: {
        html: img.links.html,
        download: img.links.download_location
      }
    }));

    const tmpDir = path.join(__dirname, '..', 'tmp');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const outputPath = path.join(tmpDir, 'image-options.json');
    fs.writeFileSync(outputPath, JSON.stringify(imageOptions, null, 2));

    console.log(`Found ${imageOptions.length} images`);
    console.log(`Saved to: ${outputPath}`);

  } catch (error) {
    console.error('Error fetching images:', error.message);
    process.exit(1);
  }
}

main();
