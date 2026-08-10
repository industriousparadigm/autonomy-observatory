'use client';

/**
 * A single modal, mounted once per page, that any FilePathButton on the page
 * can populate and open. Markdown is rendered to HTML server-side (see
 * lib/markdown.ts) and passed in as `renderedHtml` — this component only
 * ever injects a string that already went through the same-origin markdown
 * renderer, never arbitrary content of unknown origin.
 *
 * Built on the native <dialog> element rather than a hand-rolled overlay:
 * Escape-to-close and backdrop click-to-close come for free, and so does
 * focus handling.
 */

import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import type { FilePreview } from '@/lib/markdown';

const FileModalContext = createContext<((preview: FilePreview) => void) | null>(null);

export function useOpenFile(): (preview: FilePreview) => void {
  const open = useContext(FileModalContext);
  if (!open) throw new Error('useOpenFile must be used within a FileModalProvider');
  return open;
}

export function FileModalProvider({ children }: { children: ReactNode }) {
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const open = (p: FilePreview) => {
    setPreview(p);
    dialogRef.current?.showModal();
  };

  return (
    <FileModalContext.Provider value={open}>
      {children}
      <dialog ref={dialogRef} className="file-modal" onClose={() => setPreview(null)}>
        {preview ? (
          <>
            <div className="file-modal-head">
              <code className="file-modal-path">{preview.path}</code>
              <button type="button" className="file-modal-close" onClick={() => dialogRef.current?.close()} aria-label="Close">
                Close
              </button>
            </div>
            <div className="file-modal-body">
              {preview.renderedHtml !== null ? (
                <div className="markdown-body" dangerouslySetInnerHTML={{ __html: preview.renderedHtml }} />
              ) : preview.content !== null ? (
                <pre>{preview.content}</pre>
              ) : (
                <p className="files-preview">{preview.unavailableReason}</p>
              )}
            </div>
          </>
        ) : null}
      </dialog>
    </FileModalContext.Provider>
  );
}

export function FilePathButton({ preview, label }: { preview: FilePreview; label?: string }) {
  const open = useOpenFile();
  return (
    <button type="button" className="file-path-btn" onClick={() => open(preview)}>
      {label ?? preview.path}
    </button>
  );
}
