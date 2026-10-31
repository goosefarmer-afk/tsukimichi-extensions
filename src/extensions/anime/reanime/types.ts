import type { Anime } from "@tsukimichi/common";

interface Title {
  english: string | null;
  native: string | null;
  romaji: string | null;
}

interface Cover {
  extra_large: string | null;
  large: string | null;
  medium: string | null;
}

interface SearchAnime {
  anime_id: string;
  title: Title;
  cover_image: Cover | null;
  format: string | null;
  status: string | null;
  genres: string[] | null;
  season: string | null;
  season_year: number | null;
  rating: string | null;
  average_score: number | null;
}

export interface SearchResponse {
  total: number;
  offset: number;
  limit: number;
  results: SearchAnime[];
}

export interface LatestResponse {
  data: SearchAnime[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface AnimeDetailsResponse extends SearchAnime {
  description?: string | null;
  duration?: number | null;
  is_adult?: boolean;
  studios?: { name: string }[] | null;
  synonyms?: string[] | null;
  mean_score?: number | null;
  episodes_total?: number | null;
  anilist_id?: number | null;
  mal_id?: number | null;
  kitsu_id?: number | null;
  anidb_id?: number | null;
  anime_planet_id?: number | null;
  animenewsnetwork_id?: number | null;
  simkl_id?: number | null;
  anisearch_id?: number | null;
  themoviedb_id?: number | null;
  subbed?: number | null;
  dubbed?: number | null;
  external_seasons?: ExternalSeasons | null;
}

interface ExternalSeasons {
  tmdb?: number | null;
  tvdb?: number | null;
}

export function toAnime(anime: AnimeDetailsResponse): Anime {
  let description = `${anime.description ? `${anime.description}<br><br>` : ""}`;
  if (anime.format) description += `Format: ${anime.format}<br>`;
  if (anime.season) description += `Season: ${anime.season}<br>`;
  if (anime.season_year) description += `Season year: ${anime.season_year}<br>`;
  if (anime.episodes_total) description += `Episodes: ${anime.episodes_total}<br>`;
  if (anime.duration) description += `Duration: ${anime.duration}<br>`;

  return {
    title: anime.title.english || anime.title.romaji || anime.title.native || "",
    coverImageUrl:
      anime.cover_image?.extra_large ||
      anime.cover_image?.large ||
      anime.cover_image?.medium ||
      null,
    isNsfw: anime.is_adult ?? null,
    status: "unknown",
    url: anime.anime_id,
    alternateTitles: anime.synonyms ?? [],
    description,
    genres: anime.genres ?? [],
    studios: anime.studios?.map((s) => s.name) ?? [],
    rating: anime.mean_score ? anime.mean_score / 10 : null,
  };
}

interface EpisodeItem {
  episodeId: string;
  title: string;
  episode_number: number | null;
  is_filler: boolean;
  is_recap: boolean;
  title_japanese: string | null;
  title_romaji: string | null;
  aired: string | null;
  url: string;
}

export interface EpisodeListResponse {
  total: number;
  totalPages: number;
  data: EpisodeItem[];
}

export interface VideoResponse {
  success: boolean;
  servers: VideoServer[] | null;
}

interface VideoServer {
  serverName: string | null;
  dataLink: string | null;
  dataType: string | null;
  softsub: boolean;
}

export interface AnimeMeta {
  anilistId: number;
  tmdbId: number;
  seasonNumber: number;
  subbed: number;
  dubbed: number;
}

export interface FlixcloudSubtitle {
  url: string;
  language: string | null;
  default?: boolean;
  format: string | null;
}

export interface FlixcloudChapter {
  start?: number | null;
  end?: number | null;
  title?: string | null;
}

export interface FlixcloudEmbedData {
  subtitles: FlixcloudSubtitle[] | null;
  intro_chapter: FlixcloudChapter | null;
  outro_chapter: FlixcloudChapter | null;
  chapters: FlixcloudChapter[] | null;
}

export interface SkipTimes {
  introStart?: number | null;
  introEnd?: number | null;
  outroStart?: number | null;
  outroEnd?: number | null;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface DecFlixCloudTokenResponse {
  status: number;
  result: DecFlixCloudTokenResult | null;
}

interface DecFlixCloudTokenResult {
  token: string;
  context: { [key: string]: JsonValue };
}

export interface DecFlixCloudStreamResponse {
  status: number;
  result: DecFlixCloudStreamResult | null;
}

interface DecFlixCloudStreamResult {
  stream: string;
  context: { [key: string]: JsonValue };
}
