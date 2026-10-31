export interface AnimeListResponse {
  data: AnimeObject[];
  pagination: Pagination;
}

export interface RecentEpisodesResponse {
  data: { origin: AnimeObject }[];
  pagination: Pagination;
}

interface Pagination {
  hasNext: boolean;
}

export interface AnimeObject {
  _id: string;
  title: string;
  link: string;
  posterImage: ImageObject;
  alternativeTitle?: AlternativeTitle;
}

interface AlternativeTitle {
  english: string | null;
  native: string | null;
}

interface ImageObject {
  original?: string | null;
  large?: string | null;
  medium?: string | null;
  small?: string | null;
}

export interface AnimeDetailsResponse {
  data: AnimeDetails;
}

interface AnimeDetails {
  _id: string;
  title: string;
  link: string;
  posterImage: ImageObject;
  genres?: string[];
  alternativeTitle?: AlternativeTitle;
  synopsys?: string;
  tags?: string[];
  type?: string;
  animeSeason?: {
    season?: string;
    year?: number;
  };
}

interface EpisodeObject {
  uid: string;
  origin: string;
  title?: string;
  number?: string;
}

export interface EpisodeListResponse {
  data: EpisodeObject[];
}

export interface EpisodeDataResponse {
  data: {
    episode: StreamEpisode;
  };
}

interface StreamEpisode {
  streamLink: string | null;
  subData: Subtitle[] | null;
}

interface Subtitle {
  src: string;
  label: string;
  type: string;
}
