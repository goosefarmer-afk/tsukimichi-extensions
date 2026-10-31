import type { Segment } from "@tsukimichi/common";

export interface VideoServer {
  name: string;
  type: string;
  serverId: string;
}

export interface MapperServer {
  sub: { url: string } | null;
  dub: { url: string } | null;
}

interface Track {
  file: string;
  kind: string;
  label: string | null;
  default?: boolean;
}

export interface MegaPlaySourcesResponse {
  enc: string | null;
  sources: unknown;
  tracks: MegaPlayTrack[] | null;
  intro: Segment | null;
  outro: Segment | null;
}

interface MegaPlayTrack {
  file: string;
  label: string;
}

export interface SourcesResponse {
  tracks: Track[] | null;
  sources: unknown;
  intro: Segment | null;
  outro: Segment | null;
}

export function deserializeSources(sources: unknown): string {
  if (sources && typeof sources === "object" && !Array.isArray(sources)) {
    const obj = sources as { file?: unknown };
    if (typeof obj.file === "string") return obj.file;
  }

  if (Array.isArray(sources)) {
    const first = sources[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const obj = first as { file?: unknown };
      if (typeof obj.file === "string") return obj.file;
    }
    if (typeof first === "string") return first;
  }

  if (typeof sources === "string") return sources;

  throw new Error("No valid m3u8 found in sources");
}

export function deserializeMegaPlaySources(sources: unknown): string | null {
  try {
    return deserializeSources(sources);
  } catch {
    return null;
  }
}
