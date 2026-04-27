import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Upload, Trash2, Film, Image as ImageIcon } from "lucide-react";
import { useAuthStore } from "@/lib/auth";

interface MediaAsset {
  id: string;
  filename: string;
  originalName: string;
  s3Url: string;
  fileType: "image" | "video";
  fileSizeBytes: number | null;
  durationSeconds: number | null;
  createdAt: string;
}

function formatBytes(b: number | null) {
  if (!b) return "";
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export function Media() {
  const qc = useQueryClient();
  const token = useAuthStore((s) => s.token);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data: assets = [], isLoading } = useQuery<MediaAsset[]>({
    queryKey: ["media"],
    queryFn: () => api.get("/media"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/media/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["media"] }),
  });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api.upload("/media", form);
      qc.invalidateQueries({ queryKey: ["media"] });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{assets.length} asset{assets.length !== 1 ? "s" : ""}</p>
        <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
          <Upload className="h-3.5 w-3.5 mr-1" />
          {uploading ? "Uploading…" : "Upload"}
        </Button>
        <input ref={fileRef} type="file" accept="image/*,video/mp4" className="hidden" onChange={handleUpload} />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="aspect-video rounded-lg" />)}
        </div>
      ) : assets.length === 0 ? (
        <div className="border-2 border-dashed rounded-lg flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <Upload className="h-8 w-8 opacity-40" />
          <p className="text-sm">No media yet — upload your first ad</p>
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>Choose file</Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {assets.map((asset) => (
            <Card key={asset.id} className="overflow-hidden group relative">
              <div className="aspect-video bg-muted flex items-center justify-center">
                {asset.fileType === "image" ? (
                  <img src={asset.s3Url} alt={asset.originalName} className="w-full h-full object-cover" />
                ) : (
                  <Film className="h-10 w-10 text-muted-foreground/50" />
                )}
              </div>
              <CardContent className="p-2 space-y-0.5">
                <div className="flex items-center gap-1">
                  {asset.fileType === "image" ? <ImageIcon className="h-3 w-3 text-muted-foreground" /> : <Film className="h-3 w-3 text-muted-foreground" />}
                  <p className="text-xs font-medium truncate flex-1" title={asset.originalName}>{asset.originalName}</p>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{formatBytes(asset.fileSizeBytes)}</span>
                  <button
                    onClick={() => deleteMutation.mutate(asset.id)}
                    className="text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
