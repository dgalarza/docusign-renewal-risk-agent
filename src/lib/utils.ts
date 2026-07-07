import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const DOCUSIGN_UTM_PARAMS = {
  utm_campaign: 'AWA_FY27Q2',
  utm_medium: 'influencer-program',
  utm_source: 'Damian',
};

export function withDocusignUtmParams(href: string) {
  try {
    const url = new URL(href);

    if (!url.hostname.toLowerCase().includes('docusign.com')) {
      return href;
    }

    for (const [key, value] of Object.entries(DOCUSIGN_UTM_PARAMS)) {
      url.searchParams.set(key, value);
    }

    return url.toString();
  } catch {
    return href;
  }
}
