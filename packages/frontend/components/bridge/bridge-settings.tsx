'use client';

import { useEffect, useRef, useState } from 'react';
import { Settings, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

interface BridgeSettingsProps {
  deadlineMinutes: string;
  onDeadlineChange: (value: string) => void;
}

export function BridgeSettings({ deadlineMinutes, onDeadlineChange }: BridgeSettingsProps) {
  const t = useTranslations('bridge.settings');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative flex items-center justify-end mb-2">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen((v) => !v)}
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
        aria-label={t('title')}
        aria-expanded={open}
      >
        <Settings className="h-4 w-4" />
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-20 w-72 rounded-2xl border border-border bg-card p-4 shadow-[0_8px_24px_-8px_rgba(17,17,17,0.16)]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-foreground">{t('title')}</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label={t('title')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-3">
            <Field
              id="bridge-deadline"
              label={t('swapExpiration')}
              hint={t('swapExpirationHint')}
              suffix={t('minutes')}
            >
              <input
                id="bridge-deadline"
                type="number"
                inputMode="numeric"
                min={1}
                value={deadlineMinutes}
                onChange={(e) => onDeadlineChange(e.target.value)}
                className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
            </Field>

            <Field
              id="bridge-incentive"
              label={t('incentiveFee')}
              hint={t('incentiveFeeHint')}
              suffix="USDC"
              suffixMuted
            >
              <input
                id="bridge-incentive"
                type="text"
                placeholder={t('comingSoon')}
                value=""
                disabled
                readOnly
                className="flex-1 rounded-lg border border-border bg-secondary/40 px-3 py-1.5 text-sm text-muted-foreground placeholder:text-muted-foreground cursor-not-allowed focus:outline-none"
              />
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  suffix,
  suffixMuted,
  children,
}: {
  id: string;
  label: string;
  hint: string;
  suffix: string;
  suffixMuted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-muted-foreground mb-1">
        {label}
      </label>
      <div className="flex items-center gap-2">
        {children}
        <span
          className={
            suffixMuted ? 'text-xs text-muted-foreground/60' : 'text-xs text-muted-foreground'
          }
        >
          {suffix}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground/80">{hint}</p>
    </div>
  );
}
