import { useEffect, useRef, useState } from 'react';
import type { Book } from '@/types';
import { bookThumbnail } from '@/lib/book-thumbnails';
import { cn } from '@/lib/utils';

export default function BookCover({ book, large = false }: { book: Book; large?: boolean }) {
  const host = useRef<HTMLSpanElement>(null);
  const [thumbnail, setThumbnail] = useState(book.thumbnail);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    let disposed = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void bookThumbnail(book)
          .then((value) => {
            if (!disposed) setThumbnail(value);
          })
          .catch(() => {});
      },
      { rootMargin: '100px' },
    );
    if (host.current) observer.observe(host.current);
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [book.id, book.thumbnail]);

  return (
    <span
      ref={host}
      className={cn(
        'book-cover grid shrink-0 place-items-center overflow-hidden rounded-[3px] border bg-card text-[9px] font-semibold tracking-[.6px] text-[#7d7c6c]',
        large
          ? 'h-[90px] w-[67px] max-[760px]:h-[76px] max-[760px]:w-[55px] max-[520px]:h-[60px] max-[520px]:w-[43px]'
          : 'h-[60px] w-11 max-[520px]:row-span-2 max-[520px]:h-[51px] max-[520px]:w-[37px] max-[520px]:text-[8px]',
        !thumbnail && book.format === 'epub' && 'border-[#dbe4d5] bg-[#eff3eb] text-[#52735c]',
      )}
      aria-hidden="true"
      data-book-id={book.id}
    >
      {thumbnail && !broken ? (
        <img
          src={thumbnail}
          alt=""
          className="size-full object-contain"
          onError={() => setBroken(true)}
        />
      ) : (
        book.format.toUpperCase()
      )}
    </span>
  );
}
