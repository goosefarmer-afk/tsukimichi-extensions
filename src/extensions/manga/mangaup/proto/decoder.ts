import type { Type } from "protobufjs";
import type { SeriesResponseData, MangaDetails, ViewerResponse } from "../types";

import {
  SeriesResponseSchema,
  SearchResponseSchema,
  MangaDetailsResponseSchema,
  ViewerResponseSchema,
} from "./schema";

function decode<T>(schema: Type, buffer: Buffer): T {
  const message = schema.decode(buffer);

  return schema.toObject(message, {
    defaults: false,
    arrays: true,
    longs: String,
    enums: String,
    bytes: String,
  }) as T;
}

export function decodeSeriesResponse(buffer: Buffer, search = false) {
  if (search) {
    return decode<SeriesResponseData>(SearchResponseSchema, buffer);
  }
  return decode<SeriesResponseData>(SeriesResponseSchema, buffer);
}

export function decodeMangaDetails(buffer: Buffer): MangaDetails {
  return decode<MangaDetails>(MangaDetailsResponseSchema, buffer);
}

export function decodeViewerResponse(buffer: Buffer): ViewerResponse {
  return decode<ViewerResponse>(ViewerResponseSchema, buffer);
}
