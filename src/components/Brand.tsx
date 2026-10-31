import { Leaf } from 'lucide-react';

export default function Brand() {
  return (
    <a
      className="inline-flex items-center gap-[11px] text-2xl font-medium tracking-[-.9px] no-underline max-[520px]:text-[22px]"
      href="./"
      aria-label="Leafmark home"
    >
      <span className="grid place-items-center text-primary">
        <Leaf
          size={23}
          strokeWidth={1.7}
          aria-hidden="true"
        />
      </span>
      Leafmark
    </a>
  );
}
