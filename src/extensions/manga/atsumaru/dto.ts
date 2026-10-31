import type { Chapter, ExtensionMetadata, Manga } from "@tsukimichi/common";

export interface AtsumaruSearchResponse {
  found: number;
  pages: number;
  hits: {
    document: AtsumaruManga;
  }[];
  request_params: {
    per_page: number;
  };
}

export interface AtsumaruBrowseMangaResponse {
  items: AtsumaruManga[];
}

interface Poster {
  image: string | null;
  smallImage: string | null;
  largeImage: string | null;
}

export interface AtsumaruManga {
  id: string;
  title: string;
  status?: string | null;
  image?: string | null;
  poster?: Poster | null;
  isAdult: boolean;
  type: string;
  otherNames?: string[] | null;
  tag?: Tag[] | null;
  authors?: Author[] | null;
  synopsis?: string | null;
  scanlators: Scanlator[] | null;
  genres?: Tag[] | null;
  avgRating?: number | null;
}

interface Scanlator {
  id: string;
  name: string;
}

interface Tag {
  name: string;
}

interface Author {
  name: string;
  type: string;
}

export interface AtsumaruMangaPage {
  mangaPage: AtsumaruManga;
}

export interface AllChaptersResponse {
  chapters: AtsumaruChapter[];
}

interface AtsumaruChapter {
  id: string;
  title: string;
  number: number;
  createdAt?: unknown;
  scanlationMangaId: string | null;
}

interface AtsumaruPageData {
  image: string;
}

export interface AtsumaruChapterPagesResponse {
  readChapter: {
    pages: AtsumaruPageData[];
  };
}

export function toManga(options: {
  manga: AtsumaruManga;
  extensionMetadata: ExtensionMetadata;
}): Manga {
  const { manga, extensionMetadata } = options;

  const getStatus = (input?: string | null): Manga["status"] => {
    switch (input?.toLowerCase()) {
      case "completed":
        return "completed";
      case "ongoing":
        return "ongoing";
      case "hiatus":
        return "hiatus";
      case "canceled":
        return "cancelled";
      default:
        return "unknown";
    }
  };

  const getImagePath = (image: string | Poster | null | undefined): string | null => {
    if (!image) return null;

    if (typeof image === "string") {
      return normalizePath(image);
    }

    const path = image.largeImage || image.image || image.smallImage;

    return path ? normalizePath(path) : null;
  };

  const authorsList = manga.authors?.filter((a) => a.name && a.type).filter(Boolean) ?? [];

  return {
    title: manga.title,
    genres: manga.genres?.map((g) => g.name) ?? manga.tag?.map((t) => t.name) ?? [],
    authors: authorsList.filter((a) => a.type === "Author").map((a) => a.name),
    artists: authorsList.filter((a) => a.type === "Artist").map((a) => a.name),
    description: manga.synopsis,
    isNsfw: manga.isAdult,
    status: getStatus(manga.status),
    coverImageUrl: `${extensionMetadata.url}/static/${getImagePath(manga.image || manga.poster)}`,
    url: manga.id,
    rating: manga.avgRating,
    alternateTitles: manga.otherNames || [],
  };
}

export function toChapter(options: {
  chapter: AtsumaruChapter;
  mangaId: string;
  getSanlationName: (id: string | null) => string | undefined;
}): Chapter {
  const { chapter, mangaId, getSanlationName } = options;

  return {
    title: chapter.title,
    chapterNumber: chapter.number,
    volumeNumber: null,
    lastUpdated:
      typeof chapter.createdAt === "number" ? new Date(chapter.createdAt).toISOString() : null,
    url: `${mangaId}/${chapter.id}`,
    languageKey: "multi",
    groupName: getSanlationName(chapter.scanlationMangaId),
  };
}

function normalizePath(path: string): string {
  let result = path;

  if (result.startsWith("/")) result = result.slice(1);
  if (result.startsWith("static/")) result = result.slice("static/".length);

  return result;
}
