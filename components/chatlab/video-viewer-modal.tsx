'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { downloadMedia } from '@/lib/downloadMedia';

// The viewer only needs these fields; ChatLabAttachment satisfies it.
interface ViewerVideo {
  viewUrl: string;
  downloadUrl?: string | null;
  contentType?: string;
  fileName?: string;
}

interface VideoViewerModalProps {
  videos: ViewerVideo[];
  startIndex: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Centered, dimmed-backdrop video player — the video sibling of
// ImageViewerModal. The player renders at natural size but is constrained to
// the viewport (max-w-[90vw] max-h-[85vh]); native controls handle
// play/pause/seek/volume/fullscreen. Download uses the presigned
// Content-Disposition:attachment URL when present. ←/→ move within the
// carousel's videos (keyed on the element so switching remounts the player
// and stops the previous clip).
export default function VideoViewerModal({ videos, startIndex, open, onOpenChange }: VideoViewerModalProps) {
  const [index, setIndex] = useState(startIndex);

  useEffect(() => {
    if (open) setIndex(startIndex);
  }, [open, startIndex]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setIndex((v) => Math.min(v + 1, videos.length - 1));
      if (e.key === 'ArrowLeft') setIndex((v) => Math.max(v - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, videos.length]);

  const current = videos[index];
  const multiple = videos.length > 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="w-fit max-w-[90vw] border-0 bg-transparent p-0 shadow-none sm:max-w-[90vw]"
      >
        <DialogTitle className="sr-only">Video attachment</DialogTitle>
        <div className="relative flex items-center justify-center">
          {current && (
            <video
              key={current.viewUrl}
              src={current.viewUrl}
              controls
              autoPlay
              playsInline
              className="max-h-[85vh] max-w-[90vw] rounded-lg"
            />
          )}

          <div className="absolute top-2 right-2 flex gap-2">
            {current && (
              <Button
                size="icon"
                variant="secondary"
                aria-label="Download video"
                onClick={() => void downloadMedia(current.downloadUrl || current.viewUrl, current.fileName)}
              >
                <Download className="size-4" />
              </Button>
            )}
            <Button size="icon" variant="secondary" aria-label="Close" onClick={() => onOpenChange(false)}>
              <X className="size-4" />
            </Button>
          </div>

          {multiple && (
            <>
              <Button
                size="icon"
                variant="secondary"
                className="absolute top-1/2 left-2 -translate-y-1/2"
                disabled={index === 0}
                aria-label="Previous video"
                onClick={() => setIndex((v) => Math.max(v - 1, 0))}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="secondary"
                className="absolute top-1/2 right-2 -translate-y-1/2"
                disabled={index === videos.length - 1}
                aria-label="Next video"
                onClick={() => setIndex((v) => Math.min(v + 1, videos.length - 1))}
              >
                <ChevronRight className="size-4" />
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
