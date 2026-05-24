import { createElement } from 'react';
import { getExplorerTxUrl } from '@/config/explorers';
import { shortHash } from '@/lib/format';

// renders a truncated tx hash as a clickable link to the chain explorer.
// falls back to plain truncated text when the chain is unknown.
export function txLink(chain: string, txHash: string) {
  const url = getExplorerTxUrl(chain, txHash);
  const label = shortHash(txHash);

  if (!url) {
    return createElement('span', { className: 'font-mono text-xs' }, label);
  }

  return createElement(
    'a',
    {
      href: url,
      target: '_blank',
      rel: 'noopener noreferrer',
      className: 'font-mono text-xs underline underline-offset-2 hover:text-foreground',
    },
    label
  );
}
