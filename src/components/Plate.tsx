/**
 * Page and section headings.
 *
 * Type on a ground and a rule under it — nothing else. The previous version
 * put a plotted ornament beside every title and set the note beneath it in an
 * italic serif, and between them they turned each screen into a museum label:
 * the mark read as a bullet, and the italic made a live count read as
 * commentary on the page rather than part of it.
 *
 * The `motif` prop is still accepted and ignored, so the dozen pages passing
 * one did not all need editing to say the same thing they already said.
 */
export function PageHead({
  title,
  annot,
  right,
}: {
  title: string;
  annot?: React.ReactNode;
  /** Ignored. Kept so existing callers still typecheck. */
  motif?: string;
  right?: React.ReactNode;
}) {
  return (
    <header className="mb-7">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b-[3px] border-edge-strong pb-2">
        <h1>{title}</h1>
        {right ? <div className="pb-1">{right}</div> : null}
      </div>
      {annot ? <p className="annot mt-2 text-[13px]">{annot}</p> : null}
    </header>
  );
}

export function SectionHead({
  title,
  annot,
  no,
  right,
}: {
  title: string;
  annot?: React.ReactNode;
  no?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="plate justify-between">
        <div className="flex items-baseline gap-2.5">
          {no ? <span className="plate-no">{no}</span> : null}
          <h2>{title}</h2>
        </div>
        {right}
      </div>
      {annot ? <p className="annot mt-1.5 text-[12px]">{annot}</p> : null}
    </div>
  );
}
