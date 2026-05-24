'use client';

import { AlertCircle, Loader2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { BridgeStep } from '@/hooks/use-bridge';

interface BridgeStatusProps {
  step: BridgeStep;
  error: string | null;
  onDismiss: () => void;
}

export function BridgeStatus({ step, error, onDismiss }: BridgeStatusProps) {
  const t = useTranslations('bridge.status');

  if (step === 'idle' || step === 'done' || step === 'tracking') return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-3 rounded-xl border border-border bg-card p-4 text-sm"
    >
      {step === 'error' && (
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-destructive">{t('title')}</p>
            <p className="text-muted-foreground mt-1 text-xs break-all">{error}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={onDismiss}
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {step === 'checking' && <StepRow text={t('checking')} />}
      {step === 'approving' && <StepRow text={t('approving')} />}
      {step === 'submitting' && <StepRow text={t('submitting')} />}
    </div>
  );
}

function StepRow({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3">
      <Loader2 className="h-5 w-5 shrink-0 animate-spin text-accent" />
      <p className="text-muted-foreground">{text}</p>
    </div>
  );
}
