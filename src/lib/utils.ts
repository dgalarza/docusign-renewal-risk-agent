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

const ISO_CURRENCY_CODE_PATTERN = /^[A-Za-z]{3}$/;

/**
 * Extracted agreement data can carry sentinel strings (e.g. "not_extracted")
 * in a currency field instead of a real ISO 4217 code, which throws a
 * RangeError from Intl.NumberFormat if used directly. Falls back to USD for
 * anything that isn't a plausible 3-letter currency code.
 */
export function normalizeCurrencyCode(currency: string | null | undefined): string {
  if (currency && ISO_CURRENCY_CODE_PATTERN.test(currency)) {
    return currency.toUpperCase();
  }
  return 'USD';
}

export function docusignWorkflowUrl(workflowId: string) {
  return `https://apps-d.docusign.com/send/workflows/${encodeURIComponent(workflowId)}`;
}

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
