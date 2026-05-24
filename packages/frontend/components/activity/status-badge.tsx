import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { BridgeOrderStatus } from '@/hooks/use-bridge-activity';

const STATUS_STYLES: Record<BridgeOrderStatus, string> = {
  QUEUED: 'bg-secondary text-foreground ring-1 ring-border',
  PARTIAL: 'bg-secondary text-foreground ring-1 ring-border',
  MATCHED: 'bg-secondary text-foreground ring-1 ring-border',
  COMPLETED: 'bg-foreground text-background ring-1 ring-foreground',
  FAILED: 'bg-secondary text-foreground ring-1 ring-foreground/40',
  EXPIRED: 'bg-secondary text-muted-foreground ring-1 ring-border',
};

export function StatusBadge({ status }: { status: BridgeOrderStatus }) {
  const t = useTranslations('activity.status');
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        STATUS_STYLES[status]
      )}
    >
      {t(status)}
    </span>
  );
}
