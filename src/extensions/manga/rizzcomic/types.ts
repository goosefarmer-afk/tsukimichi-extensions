import type { ExtensionMetadata, Manga } from "@tsukimichi/common";
import { GenreOptions } from "./filters";

export interface Comic {
  title: string;
  id: string;
  image_url: string | null;
  long_description: string | null;
  status: string | null;
  artist: string | null;
  author: string | null;
  serialization: string | null;
  genre_id: string | null;
  type: string | null;
}

const SLUG_REGEX = /[^a-z0-9]+/g;

export function toManga(options: {
  comic: Comic;
  extensionMetadata: ExtensionMetadata;
  mangaUrlDirectory: string;
  parseStatus: (input?: string | null) => Manga["status"];
}): Manga {
  const { comic, extensionMetadata, mangaUrlDirectory, parseStatus } = options;

  const slug = comic.title
    .trim()
    .toLowerCase()
    .replace(/'/g, "")
    .replace(SLUG_REGEX, "-")
    .replace("-s-", "s-")
    .replace("-ll-", "ll-");

  const genreIds = comic.genre_id?.split(",") ?? [];
  const genres: string[] = [];

  if (comic.type) {
    genres.push(comic.type.toUpperCase());
  }

  GenreOptions.filter((genre) => genreIds.includes(genre.value)).forEach((genre) => {
    genres.push(genre.label);
  });

  return {
    title: comic.title,
    genres,
    coverImageUrl: comic.image_url
      ? new URL(`assets/images/${comic.image_url}`, extensionMetadata.url).href
      : null,
    isNsfw: null,
    url: `${mangaUrlDirectory}/${slug}#${comic.id}`,
    status: parseStatus(comic.status),
    artists: comic.artist?.split(",").filter(Boolean),
    authors: [comic.author || "", comic.serialization || ""].filter(Boolean),
    description: comic.long_description?.replaceAll("\r\n", "<br>"),
  };
}
