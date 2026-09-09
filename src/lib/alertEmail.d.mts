/** The listings in one saved-search alert email. */
export function blocksFromEmail(html: string | null | undefined): {
  blocks: Array<{
    title: string | null;
    price: string | null;
    wasPrice: string | null;
    size: string | null;
    condition: string | null;
    url: string | null;
    image: string | null;
  }>;
  note: string;
};

/** Whether a message parses to any listings at all. */
export function looksLikeAlert(html: string | null | undefined): boolean;
