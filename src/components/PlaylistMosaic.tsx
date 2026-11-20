"use client";

interface PlaylistMosaicProps {
  coverUrls: string[];
  className?: string;
  lazy?: boolean;
}

/**
 * Adaptive 1/2/3/4-tile artwork mosaic for playlists without empty gray grid cells.
 */
export function PlaylistMosaic({
  coverUrls,
  className = "h-20 w-20 rounded-2xl",
  lazy = false,
}: PlaylistMosaicProps) {
  const uniqueCovers = coverUrls.filter((src) => typeof src === "string" && src.trim().length > 0).slice(0, 4);
  const loadingAttr = lazy ? "lazy" : undefined;

  if (uniqueCovers.length === 0) {
    return (
      <div className={`shrink-0 overflow-hidden bg-black/15 dark:bg-black/30 flex items-center justify-center ${className}`}>
        <img
          src="/icons/icon.svg"
          alt=""
          width={80}
          height={80}
          loading={loadingAttr}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  if (uniqueCovers.length === 1) {
    return (
      <div className={`shrink-0 overflow-hidden bg-black/15 dark:bg-black/30 ${className}`}>
        <img
          src={uniqueCovers[0]}
          alt=""
          width={160}
          height={160}
          loading={loadingAttr}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src = "/covers/track-01.jpg";
          }}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  if (uniqueCovers.length === 2) {
    return (
      <div className={`grid grid-cols-2 gap-0.5 shrink-0 overflow-hidden bg-black/15 dark:bg-black/30 ${className}`}>
        {uniqueCovers.map((src, i) => (
          <img
            key={`${src}-${i}`}
            src={src}
            alt=""
            width={104}
            height={160}
            loading={loadingAttr}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = "/covers/track-02.jpg";
            }}
            className="h-full w-full object-cover"
          />
        ))}
      </div>
    );
  }

  if (uniqueCovers.length === 3) {
    return (
      <div className={`grid grid-cols-2 grid-rows-2 gap-0.5 shrink-0 overflow-hidden bg-black/15 dark:bg-black/30 ${className}`}>
        <img
          src={uniqueCovers[0]}
          alt=""
          width={104}
          height={160}
          loading={loadingAttr}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src = "/covers/track-01.jpg";
          }}
          className="row-span-2 h-full w-full object-cover"
        />
        <img
          src={uniqueCovers[1]}
          alt=""
          width={80}
          height={80}
          loading={loadingAttr}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src = "/covers/track-02.jpg";
          }}
          className="h-full w-full object-cover"
        />
        <img
          src={uniqueCovers[2]}
          alt=""
          width={80}
          height={80}
          loading={loadingAttr}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src = "/covers/track-03.jpg";
          }}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  return (
    <div className={`grid grid-cols-2 grid-rows-2 gap-0.5 shrink-0 overflow-hidden bg-black/15 dark:bg-black/30 ${className}`}>
      {uniqueCovers.map((src, i) => (
        <img
          key={`${src}-${i}`}
          src={src}
          alt=""
          width={80}
          height={80}
          loading={loadingAttr}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src = `/covers/track-0${(i % 5) + 1}.jpg`;
          }}
          className="h-full w-full object-cover"
        />
      ))}
    </div>
  );
}
