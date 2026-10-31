export interface PopularResponse {
  page_count: number;
  result: PopularItem[];
}

interface PopularItem {
  title: string;
  title_en: string | null;
  slug: string;
  poster: Poster;
}

interface Poster {
  hq: string;
}

export interface RecentResponse {
  result: PopularItem[];
  hadNext: boolean;
}

export interface SearchResponse {
  result: PopularItem[];
  maxPage: number;
}

export interface AnimeDetailsResponse {
  slug: string;
  genres: string[] | null;
  poster: Poster;
  season: string | null;
  status: string;
  synopsis: string | null;
  title: string;
  title_en: string | null;
  year: number | null;
  rating: string | null;
  type: string | null;
}

export interface EpisodeResponse {
  pages: Record<string, unknown>[]; // We don't care about it's content, only the length
  result: EpisodeDto[];
}

interface EpisodeDto {
  slug: string;
  title: string | null;
  episode_string: string;
}

export interface LanguagesResponse {
  result: string[];
}

export interface VideoDto {
  hls: string;
  dash: string;
  subtitles: {
    name: string;
    language: string;
    src: string;
  }[];
}

export interface VideoServerResponse {
  servers: {
    name: string;
    src: string;
  }[];
}
