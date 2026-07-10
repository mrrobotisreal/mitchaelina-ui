'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// The viewer only needs these fields; ChatLabAttachment satisfies it.
interface ViewerAttachment {
  viewUrl: string;
  downloadUrl?: string | null;
}

interface ImageViewerModalProps {
  attachments: ViewerAttachment[];
  startIndex: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Centered, dimmed-backdrop image viewer. The image renders at natural size but
// is constrained to the viewport (max-w-[90vw] max-h-[85vh] + object-contain):
// huge images shrink to fit, small images are not upscaled. Download uses the
// presigned Content-Disposition:attachment URL so the browser saves the
// full-size original. ←/→ move within the carousel's images.
export default function ImageViewerModal({ attachments, startIndex, open, onOpenChange }: ImageViewerModalProps) {
  const [index, setIndex] = useState(startIndex);

  useEffect(() => {
    if (open) setIndex(startIndex);
  }, [open, startIndex]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setIndex((v) => Math.min(v + 1, attachments.length - 1));
      if (e.key === 'ArrowLeft') setIndex((v) => Math.max(v - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, attachments.length]);

  const current = attachments[index];
  const multiple = attachments.length > 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="w-fit max-w-[90vw] border-0 bg-transparent p-0 shadow-none sm:max-w-[90vw]"
      >
        <DialogTitle className="sr-only">Image attachment</DialogTitle>
        <div className="relative flex items-center justify-center">
          {current && (
            <img
              src={current.viewUrl}
              alt=""
              className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain"
            />
          )}

          <div className="absolute top-2 right-2 flex gap-2">
            {current?.downloadUrl && (
              <Button asChild size="icon" variant="secondary" aria-label="Download image">
                <a href={current.downloadUrl}>
                  <Download className="size-4" />
                </a>
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
                aria-label="Previous image"
                onClick={() => setIndex((v) => Math.max(v - 1, 0))}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="secondary"
                className="absolute top-1/2 right-2 -translate-y-1/2"
                disabled={index === attachments.length - 1}
                aria-label="Next image"
                onClick={() => setIndex((v) => Math.min(v + 1, attachments.length - 1))}
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
