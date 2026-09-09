import Link from 'next/link';
import VerifyRow from '@/components/VerifyRow';
import { verificationQueue } from '@/lib/queries';
import { VERIFY_AFTER_DAYS, STALE_AFTER_DAYS } from '@/lib/confidence.mjs';
import { PageHead } from '@/components/Plate';

export const dynamic = 'force-dynamic';

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const showAll = (Array.isArray(sp.all) ? sp.all[0] : sp.all) === '1';
  const queue = await verificationQueue(showAll);

  return (
    <div className="space-y-5">
      <PageHead
        title="Re-check queue"
        right={
          <Link href={showAll ? '/verify' : '/verify?all=1'} className="btn shrink-0">
            {showAll ? 'Show only due' : 'Show all manual entries'}
          </Link>
        }
      />

      {queue.length === 0 ? (
        <div className="rounded-xl border border-dashed border-edge p-12 text-center text-sm text-muted">
          {showAll ? (
            'No manual entries yet.'
          ) : (
            <>
              Nothing due. Every manual entry has been verified in the last {VERIFY_AFTER_DAYS}{' '}
              days.{' '}
              <Link href="/verify?all=1" className="text-accent hover:underline">
                Re-verify something anyway
              </Link>
              .
            </>
          )}
        </div>
      ) : (
        <>
          <p className="text-sm text-muted">
            {queue.length} {showAll ? 'manual entr' : 'due for re-check'}
            {showAll ? (queue.length === 1 ? 'y' : 'ies') : ''}
          </p>
          <ul className="space-y-2">
            {queue.map((l) => (
              <VerifyRow key={l.id} listing={l as never} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
