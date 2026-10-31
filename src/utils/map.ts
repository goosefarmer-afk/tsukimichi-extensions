interface ParallelCatchingMapOptions<T> {
  onError?: (error: Error, item: T, index: number) => void;
}

type MaybePromise<T> = Promise<T> | T;

type MapperType = "map" | "flatMap";

type MapperCallback<T, R, M extends MapperType> = (
  item: T,
  index: number,
) => MaybePromise<M extends "map" ? R : M extends "flatMap" ? R[] : never>;

export async function parallelCatchingMap<T, R>(
  items: T[],
  mapper: MapperCallback<T, R, "map">,
  options: ParallelCatchingMapOptions<T> = {},
): Promise<R[]> {
  const results = await Promise.allSettled(items.map(mapper));

  const values: R[] = [];

  results.forEach((result, index) => {
    if (result.status === "fulfilled") values.push(result.value);
    else {
      const item = items[index]!;
      const error = Error.isError(result.reason) ? result.reason : new Error(result.reason);

      options.onError?.(error, item, index);
    }
  });

  return values;
}

export async function parallelCatchingFlatMap<T, R>(
  items: T[],
  mapper: MapperCallback<T, R, "flatMap">,
  options: ParallelCatchingMapOptions<T> = {},
): Promise<R[]> {
  const results = await Promise.allSettled(items.map(mapper));

  const values: R[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") values.push(...result.value);
    else {
      const item = items[index];
      const error = Error.isError(result.reason) ? result.reason : new Error(result.reason);
      options.onError?.(error, item!, index);
    }
  });

  return values;
}
