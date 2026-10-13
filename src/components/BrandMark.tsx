// The RoadS mark: the gradient diamond with two white chevrons, then the name. One component so the NavBar and the
// public pages (login, cadastro, redefinir-senha) can never drift apart again.
export function BrandMark() {
  return (
    <div className="flex items-center gap-2.5">
      <div data-brand-mark className="relative flex h-[42px] w-[42px] shrink-0 items-center justify-center">
        <div className="absolute h-[30px] w-[30px] rotate-[45deg] rounded-[9px] bg-linear-to-br from-rs-brand to-rs-brand-text" />
        <svg width="27" height="21" viewBox="0 0 20 16" fill="none" className="relative" aria-hidden="true">
          <path d="M1 2 L8 8 L1 14" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M10 2 L17 8 L10 14" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </div>
      <span className="text-xl font-extrabold tracking-tight text-rs-text">RoadS</span>
    </div>
  );
}
