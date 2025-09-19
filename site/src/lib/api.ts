import type { LatestData } from '../types';

const resolveDataUrl = () => {
  if (typeof window === 'undefined') {
    return 'data/latest.json';
  }
  const { origin, pathname } = window.location;
  const basePath = pathname.endsWith('/') ? pathname : pathname.slice(0, pathname.lastIndexOf('/') + 1);
  return new URL('data/latest.json', origin + basePath).toString();
};

export const fetchLatestData = async (): Promise<LatestData> => {
  const response = await fetch(resolveDataUrl(), {
    headers: {
      'Cache-Control': 'no-cache'
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch data (${response.status})`);
  }
  return response.json() as Promise<LatestData>;
};
