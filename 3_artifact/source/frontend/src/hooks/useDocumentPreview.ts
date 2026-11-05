"use client";

import { useEffect, useState } from "react";
import { DOCX_CONTENT_TYPE } from "@/components/documents/DocumentViewer";
import { documentsApi } from "@/lib/api/documents";
import type { Document } from "@/types";

export interface DocumentPreview {
  url: string | null;
  text: string | null;
  loading: boolean;
  error: string | null;
}

/** Loads the preview (object URL, plus text for text/markdown) of one customer document. */
export function useDocumentPreview(doc: Document): DocumentPreview {
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(null);
    if (doc.content_type.startsWith(DOCX_CONTENT_TYPE)) {
      setUrl(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    documentsApi
      .view(doc.id)
      .then(async ({ url: objectUrl, contentType }) => {
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setUrl(objectUrl);
        if (contentType.startsWith("text/plain") || contentType.startsWith("text/markdown")) {
          // Only existing fetch outside lib/api: reads the object URL created above.
          const body = await fetch(objectUrl).then((res) => res.text());
          if (!cancelled) setText(body);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load preview");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [doc.id, doc.content_type]);

  // Revoke the previous object URL whenever it changes or the consumer unmounts.
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  return { url, text, loading, error };
}
