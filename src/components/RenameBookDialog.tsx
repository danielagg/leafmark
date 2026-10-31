import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Book } from '@/types';
import { bookTitle, MAX_TITLE_LENGTH, validateTitle } from '@/lib/book-title';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export default function RenameBookDialog({
  book,
  onSave,
  onClose,
}: {
  book: Book;
  onSave: (title: string) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(() => bookTitle(book));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef(document.activeElement as HTMLElement | null);
  const savingLock = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (savingLock.current) return;
    savingLock.current = true;
    setSaving(true);
    setError('');
    try {
      await onSave(validateTitle(title));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The title could not be saved. Try again.');
    } finally {
      savingLock.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !savingLock.current) onClose();
      }}
    >
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          input.current?.select();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          trigger.current?.focus();
        }}
      >
        <div className="space-y-2">
          <DialogTitle>Rename book</DialogTitle>
          <DialogDescription>Give this book a title that’s easy to find.</DialogDescription>
        </div>
        <form
          className="space-y-5"
          onSubmit={submit}
          aria-busy={saving}
        >
          <div className="space-y-2">
            <Label htmlFor="book-title">Title</Label>
            <Input
              ref={input}
              id="book-title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setError('');
              }}
              maxLength={MAX_TITLE_LENGTH}
              required
              disabled={saving}
              aria-invalid={!!error}
              aria-describedby={error ? 'book-title-error' : undefined}
            />
            {error && (
              <p
                id="book-title-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {error}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2.5">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving || !title.trim()}
            >
              {saving ? 'Saving…' : 'Save title'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
