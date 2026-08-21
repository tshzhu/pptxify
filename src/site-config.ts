const FALLBACK_REPOSITORY_URL = 'https://github.com/tshzhu/pptxify';

function repositoryUrlFromPagesLocation(): string | null {
  if (typeof window === 'undefined' || !window.location.hostname.endsWith('.github.io')) {
    return null;
  }

  const owner = window.location.hostname.slice(0, -'.github.io'.length);
  const repository = window.location.pathname.split('/').filter(Boolean)[0];
  return owner && repository ? `https://github.com/${owner}/${repository}` : null;
}

export const GITHUB_REPOSITORY_URL =
  import.meta.env.VITE_GITHUB_REPOSITORY_URL || repositoryUrlFromPagesLocation() || FALLBACK_REPOSITORY_URL;
