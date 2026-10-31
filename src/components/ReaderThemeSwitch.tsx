import { ToggleGroup } from 'radix-ui';
import type { EpubTheme } from '@/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const themes = [
  { value: 'white', label: 'White', color: 'bg-white' },
  { value: 'sepia', label: 'Sepia', color: 'bg-[#e8d6b2]' },
  { value: 'black', label: 'Black', color: 'bg-black' },
] as const;

export default function ReaderThemeSwitch({
  value,
  onValueChange,
}: {
  value: EpubTheme;
  onValueChange: (theme: EpubTheme) => void;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(next) => {
        const selected = themes.find((theme) => theme.value === next);
        if (selected) onValueChange(selected.value);
      }}
      className="reader-theme-switch flex items-center gap-0.5 rounded-md border bg-background p-0.5 max-[600px]:gap-px max-[600px]:p-px"
      aria-label="Reading theme"
    >
      {themes.map((theme) => (
        <Button
          key={theme.value}
          asChild
          variant="ghost"
          size="icon"
          className="h-8 w-8 min-w-8 p-0 max-[600px]:h-[38px] max-[600px]:w-6 max-[600px]:min-w-6"
        >
          <ToggleGroup.Item
            value={theme.value}
            aria-label={theme.label}
            title={theme.label}
          >
            <span
              aria-hidden="true"
              className={cn(
                'size-4 rounded-full border border-[#9b9b92] transition-shadow',
                theme.color,
                value === theme.value && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
              )}
            />
          </ToggleGroup.Item>
        </Button>
      ))}
    </ToggleGroup.Root>
  );
}
