import { parseSeriesDate } from "@/utils/date";
import { getLanguageInfo } from "@/utils/language";
import type { Chapter, ExtensionMetadata, Manga } from "@tsukimichi/common";

export interface PhiliaSeriesResponse {
  items: Item[];
  page: number;
  totalPages: number;
}

interface Item {
  id: number;
  slug: string;
  title: string;
  coverImageUrl: string | null;
}

export interface PhiliaMangaDetailsResponse {
  id: string;
  title: string;
  alternativeTitles: string[] | null;
  synopsis: string | null;
  coverImageUrl: string | null;
  status: string | null;
  genres: Info[] | null;
  authors: Info[] | null;
  artists: Info[] | null;
  dateModified: string | null;
  datePublished: string | null;
  externalLinks: ExternalLink[] | null;
  ratingAvg: string | null;
  contentRating: string | null;
  type: string | null;
}

interface Info {
  name: string;
}

interface ExternalLink {
  name: string;
  url: string;
}

export function toManga(options: {
  manga: PhiliaMangaDetailsResponse;
  metadata: ExtensionMetadata;
  query: string;
  toNumberOrNull: (input: unknown, float?: boolean) => number | null;
}): Manga {
  const { manga, metadata, toNumberOrNull, query } = options;
  const coverImageUrl = manga.coverImageUrl?.startsWith("http")
    ? manga.coverImageUrl
    : manga.coverImageUrl
      ? `${metadata.url}/${manga.coverImageUrl}`
      : null;

  let status: Manga["status"] = "unknown";
  if (manga.status === "ON_GOING") status = "ongoing";
  if (manga.status === "COMPLETED") status = "completed";

  let description = "";
  if (manga.synopsis?.length) description = manga.synopsis?.replaceAll("\n", "<br>");
  if (manga.externalLinks?.length) {
    if (description.length > 0) description += `<br/><br/>External Links:<br/>`;
    for (const { name, url } of manga.externalLinks) {
      description += `[${name}](${url})<br/>`;
    }
  }

  const genres = new Set<string>();
  if (manga.genres?.length) manga.genres.forEach((g) => genres.add(g.name));
  if (manga.type) genres.add(manga.type.toUpperCase());

  return {
    title: manga.title,
    url: query,
    coverImageUrl,
    isNsfw: ["mature", "erotica"].includes(manga.contentRating?.toLowerCase() || ""),
    status,
    description,
    alternateTitles: manga.alternativeTitles?.filter(Boolean) || [],
    genres: Array.from(genres),
    artists: manga.artists?.map((a) => a.name) || [],
    authors: manga.authors?.map((a) => a.name) || [],
    lastUpdated: parseSeriesDate(manga.dateModified || manga.datePublished),
    rating: toNumberOrNull(manga.ratingAvg, true),
  };
}

export interface PhiliaChapterResponse {
  items: PhiliaChapterItem[];
}

interface PhiliaChapterItem {
  slug: string;
  number: string;
  title: string | null;
  lang: string;
  publishedAt: string | null;
  coinPrice: number | null;
}

export function toChapter(chapter: PhiliaChapterItem, mangaUrl: string): Chapter {
  const url = `${mangaUrl}/${chapter.slug}`;
  let title = "";
  const validTitle =
    chapter.title?.trim() !== "" || chapter.title !== "null" || chapter.title !== chapter.number
      ? chapter.title
      : null;

  title = `Ch. ${chapter.number}`;
  if (validTitle) title += ` - ${validTitle}`;

  return {
    title,
    url,
    languageKey: getLanguageInfo(chapter.lang)?.key || null,
    lastUpdated: parseSeriesDate(chapter.publishedAt),
  };
}

export interface TokenResponse {
  token: string;
  expiresAt: number;
}

export interface ViewerResponse {
  chapter: PhiliaChapter;
  hasAccess: boolean;
}

export interface PhiliaChapter {
  id: number;
  scrambled: boolean;
  pages: Page[];
}

interface Page {
  position: number;
  url: string;
  mime: string;
}

export interface PageKeys {
  chapterKeyB64: string;
  gridSize: number;
  sessionDefault: boolean;
}

export interface OpenResponse {
  sessionId: string;
  payloadA: string;
}

export interface DrmResponse {
  payloadB: string;
}
