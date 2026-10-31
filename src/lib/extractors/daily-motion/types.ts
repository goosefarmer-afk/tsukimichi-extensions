export interface DailyQuality {
  qualities: Auto | null;
  subtitles: Subtitle | null;
  error: { type: string } | null;
  id: string | null;
}

interface Auto {
  auto: {
    type: string;
    url: string;
  }[];
}

interface Subtitle {
  data: SubtitleItem[];
}

interface SubtitleItem {
  label: string;
  urls: string[];
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
}

export interface VideosFromProtectedUrlOptions {
  url: string;
  prefix: string;
  videoId: string;
  html: string;
  ts: string;
  v1st: string;
  baseUrl: string;
  password?: string | null;
}

export interface ProtectedResponse {
  data: {
    video: {
      id: string;
      xid: string;
    };
  };
}

export function serializeSubtitle(element: unknown): SubtitleItem[] {
  if (Array.isArray(element)) return element as SubtitleItem[];
  if (typeof element === "object" && element !== null) {
    return Object.values(element) as SubtitleItem[];
  }

  return [];
}
