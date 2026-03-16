require('dotenv').config();

// Small helper module to check GitHub issue state.
// Exports: isGitHubIssueClosed(issueUrl)

let octokit = null;
async function getOctokit() {
  if (octokit) return octokit;
  try {
    const mod = await import('@octokit/rest');
    const Octokit = mod.Octokit || (mod.default && mod.default.Octokit) || mod.default;
    if (!Octokit) throw new Error('Octokit export not found');
    const opts = {};
    if (process.env.GITHUB_TOKEN) opts.auth = process.env.GITHUB_TOKEN;
    octokit = new Octokit(opts);
    return octokit;
  } catch (err) {
    console.error('Failed to load @octokit/rest dynamically in modules/github.js:', err && err.message ? err.message : err);
    throw err;
  }
}

function parseGitHubIssue(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2], issue_number: Number(match[3]) };
}

async function isGitHubIssueClosed(issueUrl) {
  const parsed = parseGitHubIssue(issueUrl);
  if (!parsed) return null;
  try {
    const oct = await getOctokit();
    const result = await oct.rest.issues.get(parsed);
    return result && result.data && result.data.state === 'closed';
  } catch (err) {
    console.error('GitHub API error for URL', issueUrl, err && err.message ? err.message : err);
    return null;
  }
}

module.exports = {
  isGitHubIssueClosed,
  parseGitHubIssue,
  // exported mostly for tests/debugging
  getOctokit
};
