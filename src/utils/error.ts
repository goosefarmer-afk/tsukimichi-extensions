export const runCatching = async <T>(cb: T | Promise<T>): Promise<T | null> => {
  try {
    return await cb;
  } catch {
    return null;
  }
};
