// npm run update-yt
// Updates YouTube video descriptions according to description generated by from json data.

// ===========================================================
// HOW TO SETUP GOOGLE OAuth2 CREDENTIALS
// ===========================================================
// 1. Go to https://console.developers.google.com/
// 2. Click on the dropdown on the top left. Create a new project / select an existing project.
// 3. Enable YouTube Data API v3 in this project by going to APIs & Services > Enable APIs and Services > Search for 'YouTube Data API v3' > Click Enable.
// 4. Go to Credentials > Create Credentials > OAuth client ID. Here you might be asked to CONFIGURE CONSENT SCREEN. (If not, skip to step 5). Click on this button
//    and fill in the required fields. (User type: 'External', App name, User support email, Developer contact information as required)
//    Scopes: Add 'https://www.googleapis.com/auth/youtube'. On the summary page, scroll below to "Test Users" and add your email address. (This must be a Google account
//    which has write access to the Coding Train YouTube channel.)
// 5. Go to Credentials > Create Credentials > OAuth client ID > Application type: Desktop app > Create. Here, click on "DOWNLOAD JSON" to download the credentials file.
//    Save this file as `google-credentials/client_secret.json` in this repo.
// ===========================================================
//
//
// ===========================================================
// RUNNING THE SCRIPT
// ===========================================================
// 1. Run `npm run update-yt`
// 2. If running the script for the first time, you will be asked to visit a URL to authenticate the app. Open this URL in your browser,
//    and login with the Google account which has write access to the Coding Train YouTube channel. You will be asked to grant permissions to the app.
//    After granting permissions, you will be redirected to a localhost page. Copy the `code` query param from the URL and paste it in the terminal.
//    This will store the auth token and a refresh token in `google-credentials/credentials.json`, which will be used for subsequent runs.
// 3. For updating the description of a video, it is required to first generate the descriptions using the `yt-desc` script.
// ===========================================================

import fs from 'fs';
import { createInterface } from 'readline';
import { google, youtube_v3 } from 'googleapis';
import inquirer from 'inquirer';

const SCOPES = ['https://www.googleapis.com/auth/youtube'];
const TOKEN_DIR = 'google-credentials/';
const TOKEN_PATH = TOKEN_DIR + 'credentials.json';
const OAuth2 = google.auth.OAuth2;

/**
 * Create an OAuth2 client with the given credentials.
 *
 * @param {Object} credentials The authorization client credentials.
 */
async function authorize(credentials) {
  const clientSecret = credentials.installed.client_secret;
  const clientId = credentials.installed.client_id;
  const redirectUrl = credentials.installed.redirect_uris[0];
  const oauth2Client = new OAuth2(clientId, clientSecret, redirectUrl);

  // Check if we have previously stored a token.
  try {
    const token = await fs.promises.readFile(TOKEN_PATH);
    oauth2Client.credentials = JSON.parse(token);
  } catch (err) {
    await getNewToken(oauth2Client);
  }

  return oauth2Client;
}

/**
 * Get and store new token after prompting for user authorization.
 *
 * @param {google.auth.OAuth2} oauth2Client The OAuth2 client to get token for.
 */
async function getNewToken(oauth2Client) {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES
  });
  console.log('Authorize this app by visiting this url: ', authUrl);
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((res, rej) => {
    rl.question('Enter the code from that page here: ', function (code) {
      rl.close();
      oauth2Client.getToken(code, function (err, token) {
        if (err) {
          console.log('Error while trying to retrieve access token', err);
          return rej();
        }
        oauth2Client.credentials = token;
        storeToken(token, res);
      });
    });
  });
}

function storeToken(token, callback) {
  try {
    fs.mkdirSync(TOKEN_DIR);
  } catch (err) {
    if (err.code != 'EEXIST') {
      throw err;
    }
  }
  fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
    if (err) throw err;
    console.log('Token stored to ' + TOKEN_PATH);
    callback();
  });
}

/**
 * Updates the description of a YouTube video.
 * @param {string} videoId youtube video id
 * @param {string} newDescription new description to update
 * @param {youtube_v3.Youtube} service youtube service
 */
async function updateYTDesc(videoId, newDescription, service) {
  // YouTube Data API v3:
  // videos.update
  // ⚠️ Quota impact: A call to this method has a quota cost of 50 units.

  try {
    const res = await service.videos.list({
      part: ['snippet'],
      id: videoId
    });
    const video = res.data.items[0];

    // diff old and new description
    const oldDescription = video.snippet.description;
    if (oldDescription === newDescription) {
      console.log('Description is already up to date.');
      return;
    }

    const res2 = await service.videos.update({
      part: ['snippet'],
      requestBody: {
        id: videoId,
        snippet: {
          title: video.snippet.title,
          description: newDescription,
          categoryId: video.snippet.categoryId
        }
      }
    });

    console.log('Updated video description.');
  } catch (err) {
    console.error('The API returned an error: ' + err);
  }
}

// Load client secrets from a local file.
async function main() {
  let content;
  try {
    content = await fs.promises.readFile(
      'google-credentials/client_secret.json'
    );
  } catch (err) {
    console.log('Error loading client secret file: ' + err);
    return;
  }
  const auth = await authorize(JSON.parse(content));

  const service = google.youtube({
    version: 'v3',
    auth
  });

  if (
    !fs.existsSync('_descriptions') ||
    fs.readdirSync('_descriptions').length === 0
  ) {
    console.log(
      'No generated descriptions available. Try generating them first by using the yt-desc script.'
    );
    return;
  }

  const videoIds = fs
    .readdirSync('_descriptions')
    .filter((f) => !f.endsWith('json'))
    .map((f) => f.split('.')[0].split('_').slice(1).join('_'));
  const metadata = JSON.parse(
    fs.readFileSync('_descriptions/metadata.json', 'utf8')
  );

  const videos = metadata.videos.filter((x) => videoIds.includes(x.videoId));
  const tracks = metadata.tracks
    .map((track) => {
      track.videos = videos.filter(
        (video) => video.canonicalTrack === track.slug
      );
      return track;
    })
    .filter((track) => track.videos.length > 0);
  const challengeVideos = videos.filter((video) =>
    video.canonicalURL.startsWith('challenges')
  );
  if (challengeVideos.length > 0) {
    tracks.push({
      slug: 'challenges',
      title: 'Coding Challenges',
      videos: challengeVideos
    });
  }

  const { trackSlug } = await inquirer.prompt([
    {
      type: 'list',
      name: 'trackSlug',
      message: 'Select a track to update:',
      choices: tracks.map((track) => ({
        name: track.title,
        value: track.slug
      }))
    }
  ]);
  const track = tracks.find((x) => x.slug === trackSlug);
  const { videoId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'videoId',
      message: 'Select a video to update:',
      choices: track.videos.map((video) => ({
        name: video.title + ' (' + video.videoId + ')',
        value: video.videoId
      }))
    }
  ]);
  const video = track.videos.find((video) => video.videoId === videoId);

  console.log(
    'Updating description for video...',
    video.title,
    `(${video.videoId})`
  );

  let newDescription = fs.readFileSync(
    `_descriptions/${video.slug}_${video.videoId}.txt`,
    'utf8'
  );

  updateYTDesc(video.videoId, newDescription, service);
}

main();
