export function substringAfter(
  str: string,
  delimiter: string,
  missingDelimiterValue?: string,
): string {
  missingDelimiterValue ??= str;

  const index = str.indexOf(delimiter);
  return index === -1 ? missingDelimiterValue : str.substring(index + delimiter.length);
}

export function substringAfterLast(
  str: string,
  delimiter: string,
  missingDelimiterValue?: string,
): string {
  missingDelimiterValue ??= str;

  const index = str.lastIndexOf(delimiter);
  return index === -1 ? missingDelimiterValue : str.substring(index + delimiter.length);
}

export function substringBefore(
  str: string,
  delimiter: string,
  missingDelimiterValue?: string,
): string {
  missingDelimiterValue ??= str;

  const index = str.indexOf(delimiter);
  return index === -1 ? missingDelimiterValue : str.substring(0, index);
}

export function substringBeforeLast(
  str: string,
  delimiter: string,
  missingDelimiterValue?: string,
): string {
  missingDelimiterValue ??= str;

  const index = str.lastIndexOf(delimiter);
  return index === -1 ? missingDelimiterValue : str.substring(0, index);
}

export function substringBetween(
  str: string,
  start: string,
  end: string,
  missingDelimiterValue?: string,
): string {
  missingDelimiterValue ??= str;

  const startIndex = str.indexOf(start);
  const endIndex = str.indexOf(end, startIndex + start.length);

  return startIndex === -1 || endIndex === -1
    ? missingDelimiterValue
    : str.substring(startIndex + start.length, endIndex);
}

export class StringUtils {
  static removePrefix(str: string, prefix: string, ignoreCase = false): string {
    if (ignoreCase) {
      return str.toLowerCase().startsWith(prefix.toLowerCase()) ? str.slice(prefix.length) : str;
    }

    return str.startsWith(prefix) ? str.slice(prefix.length) : str;
  }

  static removeSuffix(str: string, suffix: string, ignoreCase = false): string {
    if (ignoreCase) {
      return str.toLowerCase().endsWith(suffix.toLowerCase()) ? str.slice(0, -suffix.length) : str;
    }

    return str.endsWith(suffix) ? str.slice(0, -suffix.length) : str;
  }

  static substringAfter(str: string, delimiter: string, missingDelimiterValue?: string): string {
    missingDelimiterValue ??= str;

    const index = str.indexOf(delimiter);
    return index === -1 ? missingDelimiterValue : str.substring(index + delimiter.length);
  }

  static substringAfterLast(
    str: string,
    delimiter: string,
    missingDelimiterValue?: string,
  ): string {
    missingDelimiterValue ??= str;

    const index = str.lastIndexOf(delimiter);
    return index === -1 ? missingDelimiterValue : str.substring(index + delimiter.length);
  }

  static substringBefore(str: string, delimiter: string, missingDelimiterValue?: string): string {
    missingDelimiterValue ??= str;

    const index = str.indexOf(delimiter);
    return index === -1 ? missingDelimiterValue : str.substring(0, index);
  }

  static substringBeforeLast(
    str: string,
    delimiter: string,
    missingDelimiterValue?: string,
  ): string {
    missingDelimiterValue ??= str;

    const index = str.lastIndexOf(delimiter);
    return index === -1 ? missingDelimiterValue : str.substring(0, index);
  }

  static substringBetween(
    str: string,
    start: string,
    end: string,
    missingDelimiterValue?: string,
  ): string {
    missingDelimiterValue ??= str;

    const startIndex = str.indexOf(start);
    const endIndex = str.indexOf(end, startIndex + start.length);

    return startIndex === -1 || endIndex === -1
      ? missingDelimiterValue
      : str.substring(startIndex + start.length, endIndex);
  }
}
