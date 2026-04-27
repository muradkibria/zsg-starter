import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, EmptyState } from "@/components/ui/error-state";
import { Film, Image as ImageIcon, Upload } from "lucide-react";

interface MediaAsset {
  id: string;
  filename: string;
  file_type: string;
  file_size_bytes: number | null;
  duration_seconds: number | null;
  fileUrl: string;
  created: string;
}

function formatBytes(b: number | null) {
  if (!b) return "";
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export function Media() {
  const { data: assets = [], isLoading, isError, error, refetch } = useQuery<MediaAsset[]>({
    queryKey: ["media"],
    queryFn: () => api.get("/media"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {isLoading ? "Loading…" : `${assets.length} asset${assets.length !== 1 ? "s" : ""}`}
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-video rounded-lg" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          title="Couldn't load media library"
          error={error}
          onRetry={() => refetch()}
        />
      ) : assets.length === 0 ? (
        <EmptyState
          title="No media yet"
          message="Upload media via the Colorlight dashboard — it will appear here automatically."
          icon={<Upload className="h-5 w-5" />}
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {assets.map((asset) => {
            const isVideo = asset.file_type === "video" || asset.file_type === "mp4";
            return (
              <Card key={asset.id} className="overflow-hidden group relative">
                <div className="aspect-video bg-muted flex items-center justify-center overflow-hidden">
                  {asset.fileUrl ? (
                    <img
                      src={asset.fileUrl}
                      alt={asset.filename}
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : isVideo ? (
                    <Film className="h-10 w-10 text-muted-foreground/50" />
                  ) : (
                    <ImageIcon className="h-10 w-10 text-muted-foreground/50" />
                  )}
                </div>
                <CardContent className="p-2 space-y-0.5">
                  <div className="flex items-center gap-1">
                    {isVideo
                      ? <Film className="h-3 w-3 text-muted-foreground shrink-0" />
                      : <ImageIcon className="h-3 w-3 text-muted-foreground shrink-0" />}
                    <p className="text-xs font-medium truncate flex-1" title={asset.filename}>
                      {asset.filename}
                    </p>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{formatBytes(asset.file_size_bytes)}</span>
                    {asset.duration_seconds ? <span>{asset.duration_seconds}s</span> : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
